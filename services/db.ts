import initSqlJs from 'sql.js';
import localforage from 'localforage';
import { LexiconEntry } from '../types';

const DB_NAME = 'hebrew_lexicon_db';
const STORE_KEY = 'sqlite_binary';
const SQLITE_HEADER = 'SQLite format 3\u0000';

// Server endpoint for lexicon.sqlite (run `npm run start:server`)
const SERVER_URL = import.meta.env.VITE_LEXICON_SERVER || 'http://localhost:4000';

type DatabaseLoadSource = 'server' | 'indexedDB' | 'prebuilt-file' | 'fresh' | 'invalid-cache' | null;

const isSqliteFile = (buffer: ArrayBuffer | Uint8Array | null | undefined): boolean => {
  if (!buffer) return false;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < SQLITE_HEADER.length) return false;
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, SQLITE_HEADER.length));
  return header === SQLITE_HEADER;
};

class DatabaseService {
  private db: any = null;
  private SQL: any;
  private isReady: boolean = false;
  private loadSource: DatabaseLoadSource = null;
  private strongsDb: any = null;
  private serverAvailable: boolean = false;

  constructor() {
    localforage.config({
      name: DB_NAME
    });
  }

  /** Check if the local Node server is running */
  private async checkServer(): Promise<boolean> {
    try {
      const resp = await fetch(`${SERVER_URL}/status`, { method: 'GET' });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Attempt to load lexicon.sqlite from the local server */
  private async loadFromServer(): Promise<boolean> {
    try {
      const resp = await fetch(`${SERVER_URL}/lexicon.sqlite`);
      if (!resp.ok) return false;
      const buf = await resp.arrayBuffer();
      if (!isSqliteFile(buf)) {
        console.warn('Server returned invalid SQLite file');
        return false;
      }
      this.db = new this.SQL.Database(new Uint8Array(buf));
      this.loadSource = 'server';
      console.info('Loaded lexicon.sqlite from server');
      return true;
    } catch (e) {
      console.debug('Failed to load from server:', e);
      return false;
    }
  }

  /** Push the current DB binary to the server */
  async pushToServer(): Promise<boolean> {
    if (!this.db || !this.serverAvailable) return false;
    try {
      const binary = this.db.export();
      const resp = await fetch(`${SERVER_URL}/lexicon.sqlite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: binary
      });
      return resp.ok;
    } catch (e) {
      console.debug('Failed to push to server:', e);
      return false;
    }
  }

  isServerAvailable(): boolean {
    return this.serverAvailable;
  }

  getLoadSource(): DatabaseLoadSource {
    return this.loadSource;
  }

  async resetDatabase() {
    await localforage.removeItem(STORE_KEY);
    this.db = null;
    this.loadSource = null;
    this.isReady = false;
  }

  async loadStrongNumbersDb() {
    if (this.strongsDb) return;
    try {
      const resp = await fetch('/strongs.sqlite');
      if (!resp || !resp.ok) return;
      const buf = await resp.arrayBuffer();
      if (!isSqliteFile(buf)) {
        console.warn('Skipping strongs.sqlite: invalid SQLite file');
        return;
      }
      this.strongsDb = new this.SQL.Database(new Uint8Array(buf));
    } catch (e) {
      console.debug('Failed to load strongs.sqlite:', e);
    }
  }

  async init() {
    if (this.isReady) return;

    try {
      // Load SQL.js WebAssembly
      this.SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/${file}`
      });

      // 1. Check if the local server is running
      this.serverAvailable = await this.checkServer();

      // 2. If server is available, try to load from it first
      if (this.serverAvailable) {
        const loaded = await this.loadFromServer();
        if (loaded) {
          // Successfully loaded from server - skip other sources
          console.info('Using server-backed lexicon.sqlite');
        }
      }

      // 3. Fallback: try IndexedDB cache
      if (!this.db) {
        const savedDb = await localforage.getItem<Uint8Array>(STORE_KEY);
        if (savedDb) {
          if (isSqliteFile(savedDb)) {
            this.db = new this.SQL.Database(savedDb);
            this.loadSource = 'indexedDB';
          } else {
            console.warn('Stored sqlite binary is invalid. Clearing cache.');
            this.loadSource = 'invalid-cache';
            await localforage.removeItem(STORE_KEY);
          }
        }
      }

      // 4. Fallback: try prebuilt file in public/
      if (!this.db) {
        let loadedFromFile = false;
        const tryPaths = ['/lexicon.sqlite', '/prebuilt/lexicon.sqlite'];
        for (const path of tryPaths) {
          try {
            const resp = await fetch(path);
            if (!resp || !resp.ok) continue;

            const buf = await resp.arrayBuffer();
            if (!isSqliteFile(buf)) {
              console.warn(`Skipping ${path}: not a valid SQLite file`);
              continue;
            }

            this.db = new this.SQL.Database(new Uint8Array(buf));
            this.loadSource = 'prebuilt-file';
            await this.save();
            loadedFromFile = true;
            console.info(`Loaded database from ${path}`);
            break;
          } catch (e) {
            console.debug(`Failed fetching ${path}:`, e);
          }
        }

        // 5. Last resort: create fresh database
        if (!loadedFromFile) {
          this.db = new this.SQL.Database();
          this.loadSource = 'fresh';
          this.initSchema();

          // If server is available, push the fresh DB there immediately
          if (this.serverAvailable) {
            await this.pushToServer();
            console.info('Fresh database pushed to server');
          } else {
            // Trigger download for manual placement
            try {
              if (typeof window !== 'undefined' && this.db) {
                const binary = this.db.export();
                const blob = new Blob([binary], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'lexicon.sqlite';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                console.info('A new lexicon.sqlite file was generated and downloaded.');
              }
            } catch (e) {
              console.debug('Automatic lexicon.sqlite download failed:', e);
            }
          }
        }
      }

        if (this.db) {
          const rootColumnsAdded = this.ensureIsRootColumn();
          const strongsColumnAdded = this.ensureStrongsColumn();
          if (rootColumnsAdded || strongsColumnAdded) {
            await this.save();
          }
        }

        await this.loadStrongNumbersDb();

      this.isReady = true;
    } catch (error) {
      console.error("DatabaseService init error:", error);
      throw error;
    }
  }

  private initSchema() {
    if (!this.db) return;
      const schema = `
        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          hebrewWord TEXT,
          hebrewConsonantal TEXT,
          transliteration TEXT,
          partOfSpeech TEXT,
          definition TEXT,
          root TEXT,
          isRoot INTEGER NOT NULL DEFAULT 0,
          strongsNumbers TEXT DEFAULT '',
          sourcePage TEXT,
          sourceUrl TEXT,
          dateAdded INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_hebrew ON entries(hebrewWord);
        CREATE INDEX IF NOT EXISTS idx_consonantal ON entries(hebrewConsonantal);
      `;
    this.db.run(schema);
    this.save();
  }

  private ensureColumn(columnName: string, columnDef: string): boolean {
    if (!this.db) return false;
    const info = this.db.exec("PRAGMA table_info(entries)");
    if (!info || info.length === 0) return false;
    const columnNames = info[0].values.map((row: any[]) => row[1]);
    if (columnNames.includes(columnName)) return false;
    this.db.run(`ALTER TABLE entries ADD COLUMN ${columnName} ${columnDef};`);
    return true;
  }

  private ensureIsRootColumn(): boolean {
    return this.ensureColumn('isRoot', 'INTEGER NOT NULL DEFAULT 0');
  }

  private ensureStrongsColumn(): boolean {
    return this.ensureColumn('strongsNumbers', "TEXT DEFAULT ''");
  }
  /**
   * Persist the database binary to IndexedDB and optionally to the server
   */
  private async save() {
    if (!this.db) return;
    const data = this.db.export();
    await localforage.setItem(STORE_KEY, data);
    // Also push to server if it's available
    if (this.serverAvailable) {
      await this.pushToServer();
    }
  }

  addEntries(entries: LexiconEntry[]) {
    if (!this.db) return;
    
    try {
      // Use a transaction for bulk inserts
      this.db.run("BEGIN TRANSACTION");
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO entries (
            id, hebrewWord, hebrewConsonantal, transliteration, partOfSpeech, definition, root, isRoot, strongsNumbers, sourcePage, sourceUrl, dateAdded
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

      const now = Date.now();
      for (const entry of entries) {
        stmt.run([
          entry.id,
          entry.hebrewWord,
          entry.hebrewConsonantal || '',
          entry.transliteration || '',
          entry.partOfSpeech,
          entry.definition,
          entry.root || '',
          entry.isRoot ? 1 : 0,
          entry.strongsNumbers || '',
          entry.sourcePage || '',
          entry.sourceUrl || '',
          now
        ]);
      }
      stmt.free();
      this.db.run("COMMIT");
      this.save();
    } catch (e) {
      console.error("Error adding entries:", e);
      try { this.db.run("ROLLBACK"); } catch {}
    }
  }

  getStrongNumbersFor(lemma: string): string[] {
    if (!this.strongsDb || !lemma) return [];
    try {
      const stmt = this.strongsDb.prepare('SELECT number FROM strongs WHERE lemma = ?');
      stmt.bind([lemma]);
      const result: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row && row.number) {
          result.push(row.number);
        }
      }
      stmt.free();
      return result;
    } catch (e) {
      console.debug('Strong lookup failed:', e);
      return [];
    }
  }

  deleteEntries(ids: string[]) {
    if (!this.db || ids.length === 0) return;
    
    try {
      const placeholders = ids.map(() => '?').join(',');
      this.db.run(`DELETE FROM entries WHERE id IN (${placeholders})`, ids);
      this.save();
    } catch (e) {
      console.error("Error deleting entries:", e);
    }
  }

  getAllEntries(): LexiconEntry[] {
    if (!this.db) return [];
    
    try {
      const result = this.db.exec("SELECT * FROM entries ORDER BY dateAdded DESC");
      if (result.length === 0) return [];

      return this.mapResults(result[0]);
    } catch (e) {
      console.error("Error fetching all entries:", e);
      return [];
    }
  }

  getEntriesByLetter(letter: string): LexiconEntry[] {
    if (!this.db) return [];
    
    try {
      // LIKE query for both hebrewWord and hebrewConsonantal
      // Using 'letter%' matches words starting with that letter
      const stmt = this.db.prepare(`
        SELECT * FROM entries 
        WHERE hebrewWord LIKE ? OR hebrewConsonantal LIKE ? 
        ORDER BY hebrewWord ASC
      `);
      stmt.bind([`${letter}%`, `${letter}%`]);
      
      const rows: LexiconEntry[] = [];
      while (stmt.step()) {
        rows.push(this.mapRow(stmt.getAsObject()));
      }
      stmt.free();
      return rows;
    } catch (e) {
      console.error("Error fetching entries by letter:", e);
      return [];
    }
  }

  private mapResults(res: any): LexiconEntry[] {
    const columns = res.columns;
    return res.values.map((row: any[]) => {
      const obj: any = {};
      columns.forEach((col: string, i: number) => {
        if (col === 'isRoot') {
          obj.isRoot = Boolean(row[i]);
        } else if (col === 'strongsNumbers') {
          obj.strongsNumbers = row[i];
        } else {
          obj[col] = row[i];
        }
      });
      return obj as LexiconEntry;
    });
  }

  private mapRow(row: any): LexiconEntry {
    if (row && 'isRoot' in row) {
      row.isRoot = Boolean(row.isRoot);
    }
    if (row && 'strongsNumbers' in row) {
      row.strongsNumbers = row.strongsNumbers || '';
    }
    return row as LexiconEntry;
  }
}

export const dbService = new DatabaseService();