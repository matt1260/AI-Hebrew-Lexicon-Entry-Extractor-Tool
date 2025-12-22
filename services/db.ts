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

  /**
   * Export the current database binary as a Uint8Array for download or backup.
   */
  exportDatabase(): Uint8Array | null {
    if (!this.db) return null;
    try {
      return this.db.export();
    } catch (e) {
      console.error('Failed to export database binary', e);
      return null;
    }
  }

  /**
   * Return whether a DB is currently loaded in memory.
   */
  hasDatabase(): boolean {
    return Boolean(this.db);
  }

  async init(): Promise<{ loadedFromExisting: boolean }> {
    if (this.isReady) {
      return { loadedFromExisting: this.loadSource !== 'fresh' };
    }

    try {
      // Load SQL.js WebAssembly
      this.SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/${file}`
      });

      // 1. Check if the local server is running
      this.serverAvailable = await this.checkServer();

      let loadedFromExisting = false;

      // 2. If server is available, try to load from it first
      if (this.serverAvailable) {
        const loaded = await this.loadFromServer();
        if (loaded) {
          loadedFromExisting = true;
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
            loadedFromExisting = true;
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
            loadedFromExisting = true;
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
          const validationColumnsAdded = this.ensureValidationColumns();
          if (rootColumnsAdded || strongsColumnAdded || validationColumnsAdded) {
            await this.save();
          }
        }

        await this.loadStrongNumbersDb();

      this.isReady = true;
      return { loadedFromExisting };
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
          dateAdded INTEGER,
          status TEXT DEFAULT 'unchecked',
          validationIssue TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_hebrew ON entries(hebrewWord);
        CREATE INDEX IF NOT EXISTS idx_consonantal ON entries(hebrewConsonantal);
      `;
    this.db.run(schema);
    this.save();

    // Ensure new columns exist for older DBs (migrations)
    this.ensureColumn('status', "TEXT DEFAULT 'unchecked'");
    this.ensureColumn('validationIssue', 'TEXT');
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

  private ensureValidationColumns(): boolean {
    const statusAdded = this.ensureColumn('status', "TEXT DEFAULT 'unchecked'");
    const issueAdded = this.ensureColumn('validationIssue', 'TEXT');
    return statusAdded || issueAdded;
  }

  /**
   * Fetch entries for a given source page (flexible match).
   */
  getEntriesByPage(page: string, limit?: number, offset?: number, sortBy: 'default' | 'id' | 'hebrew' | 'consonantal' | 'source' = 'default', sortDir: 'asc' | 'desc' = 'asc'): LexiconEntry[] {
    if (!this.db) return [];
    try {
      const dir = sortDir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      let order = 'dateAdded DESC';
      switch (sortBy) {
        case 'id':
          order = `CAST(REPLACE(id, 'F', '') AS INTEGER) ${dir}`;
          break;
        case 'hebrew':
          order = `hebrewWord ${dir}`;
          break;
        case 'consonantal':
          order = `hebrewConsonantal ${dir}`;
          break;
        case 'source':
          order = `sourcePage ${dir}`;
          break;
        default:
          order = `dateAdded ${dir}`;
      }

      let sql = "SELECT * FROM entries WHERE sourcePage LIKE ? ORDER BY " + order;
      if (limit !== undefined) {
        sql += ` LIMIT ${limit}`;
        if (offset !== undefined) {
          sql += ` OFFSET ${offset}`;
        }
      }
      const stmt = this.db.prepare(sql);
      stmt.bind([`%${page}%`]);
      
      const rows: LexiconEntry[] = [];
      while (stmt.step()) {
        rows.push(this.mapRow(stmt.getAsObject()));
      }
      stmt.free();
      return rows;
    } catch (e) {
      console.error("Error fetching entries by page", page, e);
      return [];
    }
  }

  /**
   * Fetch entries for a given source page.
   */
  getEntriesBySourcePage(sourcePage: string, limit?: number, offset?: number): LexiconEntry[] {
    if (!this.db) return [];
    try {
      let sql = "SELECT * FROM entries WHERE sourcePage = ? ORDER BY id";
      if (limit !== undefined) {
        sql += ` LIMIT ${limit}`;
        if (offset !== undefined) {
          sql += ` OFFSET ${offset}`;
        }
      }
      const result = this.db.exec(sql, [sourcePage]);
      if (result.length === 0) return [];
      return this.mapResults(result[0]);
    } catch (e) {
      console.error("Error fetching entries by sourcePage", sourcePage, e);
      return [];
    }
  }

  /**
   * Fetch invalid entries for a given source page.
   */
  getInvalidEntriesBySourcePage(sourcePage: string): LexiconEntry[] {
    if (!this.db) return [];
    try {
      const result = this.db.exec(
        "SELECT * FROM entries WHERE sourcePage = ? AND status = 'invalid'",
        [sourcePage]
      );
      if (result.length === 0) return [];
      return this.mapResults(result[0]);
    } catch (e) {
      console.error("Error fetching invalid entries by sourcePage", sourcePage, e);
      return [];
    }
  }

  /**
   * Get list of pages that currently have invalid entries.
   */
  getPagesWithInvalid(): string[] {
    if (!this.db) return [];
    try {
      const result = this.db.exec(
        "SELECT DISTINCT sourcePage FROM entries WHERE status = 'invalid' AND sourcePage IS NOT NULL ORDER BY sourcePage"
      );
      if (result.length === 0) return [];
      return result[0].values.map((row: any[]) => row[0] as string);
    } catch (e) {
      console.error("Error fetching pages with invalid entries", e);
      return [];
    }
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
        // Ensure no undefined values - SQL.js cannot bind undefined
        stmt.run([
          entry.id ?? '',
          entry.hebrewWord ?? '',
          entry.hebrewConsonantal ?? '',
          entry.transliteration ?? '',
          entry.partOfSpeech ?? '',
          entry.definition ?? '',
          entry.root ?? '',
          entry.isRoot ? 1 : 0,
          entry.strongsNumbers ?? '',
          entry.sourcePage ?? '',
          entry.sourceUrl ?? '',
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
      // Remove Hebrew maqaf (־) for lookup - compound words like הֲדַד־רִמּוֹן become הֲדַדרִמּוֹן
      const normalizedLemma = lemma.replace(/\u05BE/g, '');
      
      const stmt = this.strongsDb.prepare('SELECT number FROM strongs WHERE lemma = ?');
      stmt.bind([normalizedLemma]);
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

  /**
   * Delete all entries from a specific source page
   * @param sourcePage - The source page filename (e.g., 'fuerst_lex_0512.jpg')
   * @returns Number of entries deleted
   */
  deleteEntriesBySourcePage(sourcePage: string): number {
    if (!this.db || !sourcePage) return 0;
    
    try {
      // First count how many will be deleted
      const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM entries WHERE sourcePage = ?");
      countStmt.bind([sourcePage]);
      let count = 0;
      if (countStmt.step()) {
        count = countStmt.getAsObject().count as number;
      }
      countStmt.free();
      
      // Delete the entries
      const deleteStmt = this.db.prepare("DELETE FROM entries WHERE sourcePage = ?");
      deleteStmt.run([sourcePage]);
      deleteStmt.free();
      
      this.save();
      console.info(`Deleted ${count} entries from source page: ${sourcePage}`);
      return count;
    } catch (e) {
      console.error("Error deleting entries by source page:", e);
      return 0;
    }
  }

  /**
   * Re-process all entries to update Strong's numbers.
   * Useful after fixing lookup logic (e.g., hyphen removal).
   * Returns count of updated entries.
   */
  async reprocessStrongsNumbers(): Promise<{ total: number; updated: number }> {
    if (!this.db || !this.strongsDb) {
      console.warn('Cannot reprocess: database or strongs DB not loaded');
      return { total: 0, updated: 0 };
    }

    const allEntries = this.getAllEntries();
    let updatedCount = 0;

    try {
      this.db.run("BEGIN TRANSACTION");
      const stmt = this.db.prepare(`UPDATE entries SET strongsNumbers = ? WHERE id = ?`);

      for (const entry of allEntries) {
        const newStrongs = this.getStrongNumbersFor(entry.hebrewWord);
        const newStrongsStr = newStrongs.length > 0 ? newStrongs.join('/') : '';
        
        // Only update if different
        if (newStrongsStr !== (entry.strongsNumbers || '')) {
          stmt.run([newStrongsStr, entry.id]);
          updatedCount++;
        }
      }

      stmt.free();
      this.db.run("COMMIT");
      await this.save();

      console.info(`Reprocessed Strong's numbers: ${updatedCount}/${allEntries.length} entries updated`);
      return { total: allEntries.length, updated: updatedCount };
    } catch (e) {
      console.error("Error reprocessing Strong's numbers:", e);
      try { this.db.run("ROLLBACK"); } catch {}
      return { total: allEntries.length, updated: 0 };
    }
  }

  /**
   * Rebuild all entry IDs with F-prefix sequential numbering (F1, F2, ... F1234)
   * sorted alphabetically by hebrewConsonantal (without vowels) for proper Hebrew order.
   * Returns count of entries renumbered.
   */
  async rebuildLexiconIds(opts?: {
    prefix?: string;
    startAt?: number;
    padWidth?: number;
    sortBy?: 'consonantal' | 'word' | 'source' | 'date';
    sortDir?: 'asc' | 'desc';
  }): Promise<{ total: number }> {
    if (!this.db) {
      console.warn('Cannot rebuild IDs: database not loaded');
      return { total: 0 };
    }

    try {
      // Get all entries - we'll sort in JS for proper Hebrew ordering
      const result = this.db.exec("SELECT * FROM entries");
      if (result.length === 0) return { total: 0 };

      const entries = this.mapResults(result[0]);
      
      // Determine sorting options
      const prefix = (opts && opts.prefix) ? String(opts.prefix) : 'F';
      const startAt = (opts && typeof opts.startAt === 'number') ? Math.floor(opts.startAt) : 1;
      const padWidth = (opts && typeof opts.padWidth === 'number') ? Math.max(0, Math.floor(opts.padWidth)) : 0;
      const sortBy = (opts && opts.sortBy) ? opts.sortBy : 'consonantal';
      const sortDir = (opts && opts.sortDir === 'desc') ? 'desc' : 'asc';

      // Sort entries according to requested criteria
      entries.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'consonantal') {
          const aCon = a.hebrewConsonantal || a.hebrewWord || '';
          const bCon = b.hebrewConsonantal || b.hebrewWord || '';
          cmp = aCon.localeCompare(bCon, 'he');
          if (cmp === 0) cmp = (a.hebrewWord || '').localeCompare(b.hebrewWord || '', 'he');
        } else if (sortBy === 'word') {
          cmp = (a.hebrewWord || '').localeCompare(b.hebrewWord || '', 'he');
        } else if (sortBy === 'source') {
          cmp = (a.sourcePage || '').localeCompare(b.sourcePage || '');
          if (cmp === 0) cmp = (a.id || '').localeCompare(b.id || '');
        } else if (sortBy === 'date') {
          const ad = Number(a.dateAdded || 0);
          const bd = Number(b.dateAdded || 0);
          cmp = ad < bd ? -1 : ad > bd ? 1 : 0;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
      
      this.db.run("BEGIN TRANSACTION");
      
      // First, update all IDs to temporary values to avoid conflicts
      const tempStmt = this.db.prepare(`UPDATE entries SET id = ? WHERE id = ?`);
      for (let i = 0; i < entries.length; i++) {
        tempStmt.run([`__TEMP_${i}__`, entries[i].id]);
      }
      tempStmt.free();
      
      // Now assign final IDs with requested format
      const finalStmt = this.db.prepare(`UPDATE entries SET id = ? WHERE id = ?`);
      for (let i = 0; i < entries.length; i++) {
        const idx = startAt + i;
        const numStr = padWidth > 0 ? String(idx).padStart(padWidth, '0') : String(idx);
        const newId = `${prefix}${numStr}`;
        finalStmt.run([newId, `__TEMP_${i}__`]);
      }
      finalStmt.free();
      
      this.db.run("COMMIT");
      await this.save();

      console.info(`Rebuilt lexicon IDs: ${entries.length} entries renumbered (F1 to F${entries.length})`);
      return { total: entries.length };
    } catch (e) {
      console.error("Error rebuilding lexicon IDs:", e);
      try { this.db.run("ROLLBACK"); } catch {}
      return { total: 0 };
    }
  }

  /**
   * Move Roman numerals from Hebrew word to definition
   * e.g. "חָפָה I" becomes "חָפָה" with definition "I. original definition..."
   * e.g. "בַּת II." becomes "בַּת" with definition "II. original definition..."
   */
  async moveRomanNumeralsToDefinition(): Promise<{ total: number; updated: number }> {
    if (!this.db) {
      console.warn('Cannot move Roman numerals: database not loaded');
      return { total: 0, updated: 0 };
    }

    try {
      const result = this.db.exec("SELECT * FROM entries");
      if (result.length === 0) return { total: 0, updated: 0 };

      const entries = this.mapResults(result[0]);
      
      // Pattern to match Roman numerals at the end of Hebrew word
      // Matches: I, II, III, IV, V, VI, VII, VIII, IX, X, etc.
      // Also handles optional trailing period (e.g., "II." or "II")
      const romanNumeralPattern = /\s+((?:X{0,3})(?:IX|IV|V?I{0,3}))\.?$/;
      
      this.db.run("BEGIN TRANSACTION");
      
      const stmt = this.db.prepare(`
        UPDATE entries SET hebrewWord = ?, definition = ? WHERE id = ?
      `);
      
      let updated = 0;
      for (const entry of entries) {
        const match = entry.hebrewWord.match(romanNumeralPattern);
        if (match) {
          const romanNumeral = match[1];
          const cleanedHebrewWord = entry.hebrewWord.replace(romanNumeralPattern, '').trim();
          // Check if definition already starts with the Roman numeral to avoid duplication
          const defStartsWithNumeral = entry.definition.match(/^[IVX]+\.\s/);
          const newDefinition = defStartsWithNumeral 
            ? entry.definition 
            : `${romanNumeral}. ${entry.definition}`;
          
          stmt.run([cleanedHebrewWord, newDefinition, entry.id]);
          updated++;
        }
      }
      
      stmt.free();
      this.db.run("COMMIT");
      await this.save();

      console.info(`Moved Roman numerals: ${updated} of ${entries.length} entries updated`);
      return { total: entries.length, updated };
    } catch (e) {
      console.error("Error moving Roman numerals:", e);
      try { this.db.run("ROLLBACK"); } catch {}
      return { total: 0, updated: 0 };
    }
  }

  /**
   * Clean root field to only contain Hebrew consonantal letters and commas (for multiple roots)
   * Removes Roman numerals, numbers, niqqud (vowel marks), and any other non-consonant characters
   * e.g. "יָדַע I." becomes "ידע", "חול 2" becomes "חול", "חיץ, חצה" stays "חיץ, חצה"
   */
  async cleanRomanNumeralsFromRoot(): Promise<{ total: number; updated: number }> {
    if (!this.db) {
      console.warn('Cannot clean roots: database not loaded');
      return { total: 0, updated: 0 };
    }

    try {
      const result = this.db.exec("SELECT * FROM entries WHERE root IS NOT NULL AND root != ''");
      if (result.length === 0) return { total: 0, updated: 0 };

      const entries = this.mapResults(result[0]);
      
      // Only keep Hebrew consonantal letters (א-ת): U+05D0 to U+05EA, plus comma and space
      const keepPattern = /[^\u05D0-\u05EA, ]/g;
      
      this.db.run("BEGIN TRANSACTION");
      
      const stmt = this.db.prepare(`
        UPDATE entries SET root = ? WHERE id = ?
      `);
      
      let updated = 0;
      for (const entry of entries) {
        if (entry.root) {
          // Remove everything except Hebrew consonants, commas, and spaces
          let cleanedRoot = entry.root.replace(keepPattern, '').trim();
          // Clean up multiple spaces
          cleanedRoot = cleanedRoot.replace(/\s+/g, ' ');
          
          // Only update if something changed
          if (cleanedRoot !== entry.root) {
            stmt.run([cleanedRoot, entry.id]);
            updated++;
          }
        }
      }
      
      stmt.free();
      this.db.run("COMMIT");
      await this.save();

      console.info(`Cleaned roots: ${updated} of ${entries.length} entries updated`);
      return { total: entries.length, updated };
    } catch (e) {
      console.error("Error cleaning roots:", e);
      try { this.db.run("ROLLBACK"); } catch {}
      return { total: 0, updated: 0 };
    }
  }

  /**
   * Get entries by range for validation
   * @param startIndex - Starting index (0-based)
   * @param count - Number of entries to return
   * @param letter - Optional letter filter
   */
  getEntriesForValidation(startIndex: number, count: number, letter?: string): { entries: LexiconEntry[]; total: number } {
    if (!this.db) return { entries: [], total: 0 };
    
    try {
      let countSql = 'SELECT COUNT(*) as count FROM entries';
      let sql = 'SELECT id, hebrewWord, hebrewConsonantal, transliteration, partOfSpeech, definition, root, isRoot, strongsNumbers, sourcePage, sourceUrl, dateAdded, status, validationIssue FROM entries';
      const params: (string | number)[] = [];
      
      if (letter) {
        const whereClause = ' WHERE hebrewWord LIKE ?';
        countSql += whereClause;
        sql += whereClause;
        params.push(letter + '%');
      }
      
      sql += ' ORDER BY hebrewWord COLLATE NOCASE LIMIT ? OFFSET ?';
      
      // Get total count
      const countResult = this.db.exec(countSql, letter ? [letter + '%'] : []);
      const total = countResult.length > 0 ? countResult[0].values[0][0] as number : 0;
      
      // Get entries
      params.push(count, startIndex);
      const result = this.db.exec(sql, params);
      
      if (result.length === 0) return { entries: [], total };
      return { entries: this.mapResults(result[0]), total };
    } catch (e) {
      console.error("Error getting entries for validation:", e);
      return { entries: [], total: 0 };
    }
  }

  /**
   * Mark entries as needing rescan by setting a flag
   */
  markForRescan(entryIds: string[]): number {
    if (!this.db || entryIds.length === 0) return 0;
    
    try {
      // Add needsRescan column if it doesn't exist
      try {
        this.db.run("ALTER TABLE entries ADD COLUMN needsRescan INTEGER DEFAULT 0");
      } catch {
        // Column already exists, ignore
      }
      
      const placeholders = entryIds.map(() => '?').join(',');
      this.db.run(`UPDATE entries SET needsRescan = 1 WHERE id IN (${placeholders})`, entryIds);
      this.save();
      return entryIds.length;
    } catch (e) {
      console.error("Error marking entries for rescan:", e);
      return 0;
    }
  }

  /**
   * Get entries marked for rescan
   */
  getEntriesNeedingRescan(): LexiconEntry[] {
    if (!this.db) return [];
    
    try {
      const result = this.db.exec("SELECT * FROM entries WHERE needsRescan = 1");
      if (result.length === 0) return [];
      return this.mapResults(result[0]);
    } catch (e) {
      console.error("Error getting entries needing rescan:", e);
      return [];
    }
  }

  /**
   * Clear rescan flag for entries
   */
  clearRescanFlag(entryIds: string[]): void {
    if (!this.db || entryIds.length === 0) return;
    
    try {
      const placeholders = entryIds.map(() => '?').join(',');
      this.db.run(`UPDATE entries SET needsRescan = 0 WHERE id IN (${placeholders})`, entryIds);
      this.save();
    } catch (e) {
      console.error("Error clearing rescan flag:", e);
    }
  }

  /**
   * Get total count of entries (optionally filtered)
   */
  getTotalCount(filter?: { letter?: string; query?: string; consonantal?: string; page?: string }): number {
    if (!this.db) return 0;
    
    try {
      let sql = 'SELECT COUNT(*) as count FROM entries';
      const params: string[] = [];
      
      if (filter?.page) {
        sql += ' WHERE sourcePage LIKE ?';
        params.push(`%${filter.page}%`);
      } else if (filter?.consonantal) {
        sql += ' WHERE hebrewConsonantal = ?';
        params.push(filter.consonantal);
      } else if (filter?.query) {
        sql += ' WHERE hebrewWord LIKE ? OR hebrewConsonantal LIKE ? OR transliteration LIKE ? OR definition LIKE ?';
        const pattern = `%${filter.query}%`;
        params.push(pattern, pattern, pattern, pattern);
      } else if (filter?.letter) {
        sql += ' WHERE hebrewWord LIKE ? OR hebrewConsonantal LIKE ?';
        params.push(`${filter.letter}%`, `${filter.letter}%`);
      }
      
      const stmt = this.db.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      
      let count = 0;
      if (stmt.step()) {
        count = stmt.getAsObject().count as number;
      }
      stmt.free();
      return count;
    } catch (e) {
      console.error("Error getting total count:", e);
      return 0;
    }
  }

  getAllEntries(limit?: number, offset?: number, sortBy: 'default' | 'id' | 'hebrew' | 'consonantal' | 'source' = 'default', sortDir: 'asc' | 'desc' = 'asc'): LexiconEntry[] {
    if (!this.db) return [];
    
    try {
      let order = 'dateAdded DESC';
      const dir = sortDir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      switch (sortBy) {
        case 'id':
          // Sort numerically by numeric part of the ID (e.g., F12 -> 12)
          order = `CAST(REPLACE(id, 'F', '') AS INTEGER) ${dir}`;
          break;
        case 'hebrew':
          order = `hebrewWord ${dir}`;
          break;
        case 'consonantal':
          order = `hebrewConsonantal ${dir}`;
          break;
        case 'source':
          order = `sourcePage ${dir}`;
          break;
        default:
          order = `dateAdded ${dir}`;
      }
      let sql = `SELECT * FROM entries ORDER BY ${order}`;
      if (limit !== undefined) {
        sql += ` LIMIT ${limit}`;
        if (offset !== undefined) {
          sql += ` OFFSET ${offset}`;
        }
      }
      const result = this.db.exec(sql);
      if (result.length === 0) return [];

      return this.mapResults(result[0]);
    } catch (e) {
      console.error("Error fetching all entries:", e);
      return [];
    }
  }

  getEntriesByLetter(letter: string, limit?: number, offset?: number, sortBy: 'default' | 'id' | 'hebrew' | 'consonantal' | 'source' = 'hebrew', sortDir: 'asc' | 'desc' = 'asc'): LexiconEntry[] {
    if (!this.db) return [];
    
    try {
      // LIKE query for both hebrewWord and hebrewConsonantal
      // Using 'letter%' matches words starting with that letter
      const dir = sortDir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      let order = 'hebrewWord ' + dir;
      switch (sortBy) {
        case 'id':
          order = `CAST(REPLACE(id, 'F', '') AS INTEGER) ${dir}`;
          break;
        case 'hebrew':
          order = `hebrewWord ${dir}`;
          break;
        case 'consonantal':
          order = `hebrewConsonantal ${dir}`;
          break;
        case 'source':
          order = `sourcePage ${dir}`;
          break;
        default:
          order = `hebrewWord ${dir}`;
      }
      let sql = `
        SELECT * FROM entries 
        WHERE hebrewWord LIKE ? OR hebrewConsonantal LIKE ? 
        ORDER BY ${order}
      `;
      if (limit !== undefined) {
        sql += ` LIMIT ${limit}`;
        if (offset !== undefined) {
          sql += ` OFFSET ${offset}`;
        }
      }
      const stmt = this.db.prepare(sql);
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

  searchEntries(query: string, limit?: number, offset?: number, sortBy: 'default' | 'id' | 'hebrew' | 'consonantal' | 'source' = 'hebrew', sortDir: 'asc' | 'desc' = 'asc'): LexiconEntry[] {
    if (!this.db || !query) return [];
    
    try {
      // Search in hebrewWord, hebrewConsonantal, transliteration, and definition
      const dir = sortDir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      let order = `hebrewWord ${dir}`;
      switch (sortBy) {
        case 'id':
          order = `CAST(REPLACE(id, 'F', '') AS INTEGER) ${dir}`;
          break;
        case 'hebrew':
          order = `hebrewWord ${dir}`;
          break;
        case 'consonantal':
          order = `hebrewConsonantal ${dir}`;
          break;
        case 'source':
          order = `sourcePage ${dir}`;
          break;
        default:
          order = `hebrewWord ${dir}`;
      }
      let sql = `
        SELECT * FROM entries 
        WHERE hebrewWord LIKE ? 
           OR hebrewConsonantal LIKE ? 
           OR transliteration LIKE ? 
           OR definition LIKE ?
        ORDER BY ${order}
      `;
      if (limit !== undefined) {
        sql += ` LIMIT ${limit}`;
        if (offset !== undefined) {
          sql += ` OFFSET ${offset}`;
        }
      }
      const stmt = this.db.prepare(sql);
      const pattern = `%${query}%`;
      stmt.bind([pattern, pattern, pattern, pattern]);
      
      const rows: LexiconEntry[] = [];
      while (stmt.step()) {
        rows.push(this.mapRow(stmt.getAsObject()));
      }
      stmt.free();
      return rows;
    } catch (e) {
      console.error("Error searching entries:", e);
      return [];
    }
  }

  getEntriesByConsonantal(consonantal: string, limit?: number, offset?: number, sortBy: 'default' | 'id' | 'hebrew' | 'consonantal' | 'source' = 'hebrew', sortDir: 'asc' | 'desc' = 'asc'): LexiconEntry[] {
    if (!this.db || !consonantal) return [];
    
    try {
      const dir = sortDir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      let order = `hebrewWord ${dir}`;
      switch (sortBy) {
        case 'id':
          order = `CAST(REPLACE(id, 'F', '') AS INTEGER) ${dir}`;
          break;
        case 'hebrew':
          order = `hebrewWord ${dir}`;
          break;
        case 'consonantal':
          order = `hebrewConsonantal ${dir}`;
          break;
        case 'source':
          order = `sourcePage ${dir}`;
          break;
        default:
          order = `hebrewWord ${dir}`;
      }
      let sql = `
        SELECT * FROM entries 
        WHERE hebrewConsonantal = ? 
        ORDER BY ${order}
      `;
      if (limit !== undefined) {
        sql += ` LIMIT ${limit}`;
        if (offset !== undefined) {
          sql += ` OFFSET ${offset}`;
        }
      }
      const stmt = this.db.prepare(sql);
      stmt.bind([consonantal]);
      
      const rows: LexiconEntry[] = [];
      while (stmt.step()) {
        rows.push(this.mapRow(stmt.getAsObject()));
      }
      stmt.free();
      return rows;
    } catch (e) {
      console.error("Error fetching entries by consonantal:", e);
      return [];
    }
  }

  /**
   * Get entries where the root contains letters not found in the Hebrew word
   * A mismatch is when the root has any letter that doesn't appear in the word
   * (or appears fewer times than needed)
   */
  getRootMismatches(): LexiconEntry[] {
    if (!this.db) return [];
    
    try {
      const result = this.db.exec("SELECT * FROM entries WHERE root IS NOT NULL AND root != ''");
      if (result.length === 0) return [];

      const entries = this.mapResults(result[0]);
      
      // Helper to count letter occurrences
      const countLetters = (str: string): Map<string, number> => {
        const counts = new Map<string, number>();
        // Strip vowels/cantillation to get only consonants
        const consonants = str.replace(/[\u0591-\u05C7]/g, '').trim();
        for (const char of consonants) {
          counts.set(char, (counts.get(char) || 0) + 1);
        }
        return counts;
      };
      
      // Filter to entries where root has letters not found (or not enough) in the word
      return entries.filter(entry => {
        if (!entry.root || !entry.hebrewWord) return false;
        
        const rootCounts = countLetters(entry.root);
        const wordCounts = countLetters(entry.hebrewWord);
        
        // Check if every letter in root exists in word with sufficient count
        for (const [letter, count] of rootCounts) {
          const wordCount = wordCounts.get(letter) || 0;
          if (wordCount < count) {
            // Root has a letter that appears more times than in the word
            return true;
          }
        }
        
        return false;
      });
    } catch (e) {
      console.error("Error fetching root mismatches:", e);
      return [];
    }
  }

  /**
   * Update a single entry's root field
   */
  async updateEntryRoot(id: string, newRoot: string): Promise<boolean> {
    if (!this.db) return false;
    
    try {
      const stmt = this.db.prepare("UPDATE entries SET root = ? WHERE id = ?");
      stmt.run([newRoot, id]);
      stmt.free();
      await this.save();
      return true;
    } catch (e) {
      console.error("Error updating entry root:", e);
      return false;
    }
  }

  /**
   * Update a single entry with multiple fields
   */
  async updateEntry(id: string, updates: Partial<LexiconEntry>): Promise<boolean> {
    if (!this.db) return false;
    
    try {
      // Build dynamic update query
      const fields: string[] = [];
      const values: any[] = [];
      
      if (updates.hebrewWord !== undefined) { fields.push('hebrewWord = ?'); values.push(updates.hebrewWord); }
      if (updates.hebrewConsonantal !== undefined) { fields.push('hebrewConsonantal = ?'); values.push(updates.hebrewConsonantal); }
      if (updates.transliteration !== undefined) { fields.push('transliteration = ?'); values.push(updates.transliteration); }
      if (updates.partOfSpeech !== undefined) { fields.push('partOfSpeech = ?'); values.push(updates.partOfSpeech); }
      if (updates.definition !== undefined) { fields.push('definition = ?'); values.push(updates.definition); }
      if (updates.root !== undefined) { fields.push('root = ?'); values.push(updates.root); }
      if (updates.isRoot !== undefined) { fields.push('isRoot = ?'); values.push(updates.isRoot ? 1 : 0); }
      if (updates.strongsNumbers !== undefined) { fields.push('strongsNumbers = ?'); values.push(updates.strongsNumbers); }
      
      if (fields.length === 0) return false;
      
      values.push(id);
      const sql = `UPDATE entries SET ${fields.join(', ')} WHERE id = ?`;
      
      const stmt = this.db.prepare(sql);
      stmt.run(values);
      stmt.free();
      await this.save();
      return true;
    } catch (e) {
      console.error("Error updating entry:", e);
      return false;
    }
  }

  /**
   * Get a single entry by ID
   */
  getEntryById(id: string): LexiconEntry | null {
    if (!this.db) return null;
    
    try {
      const stmt = this.db.prepare("SELECT * FROM entries WHERE id = ?");
      stmt.bind([id]);
      
      if (stmt.step()) {
        const entry = this.mapRow(stmt.getAsObject());
        stmt.free();
        return entry;
      }
      stmt.free();
      return null;
    } catch (e) {
      console.error("Error fetching entry by id:", e);
      return null;
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

  /**
   * Get all distinct partOfSpeech values in the database
   */
  getDistinctPartOfSpeech(): string[] {
    if (!this.db) return [];
    
    try {
      const result = this.db.exec("SELECT DISTINCT partOfSpeech FROM entries WHERE partOfSpeech IS NOT NULL AND partOfSpeech != '' ORDER BY partOfSpeech");
      if (result.length === 0) return [];
      
      return result[0].values.map((row: any[]) => row[0] as string);
    } catch (e) {
      console.error("Error getting distinct partOfSpeech:", e);
      return [];
    }
  }

  /**
   * Find and replace partOfSpeech values
   * @param find - The value to find (exact match)
   * @param replace - The value to replace with
   * @returns Number of entries updated
   */
  async findReplacePartOfSpeech(find: string, replace: string): Promise<number> {
    if (!this.db) return 0;
    
    try {
      // First count how many will be updated
      const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM entries WHERE partOfSpeech = ?");
      countStmt.bind([find]);
      let count = 0;
      if (countStmt.step()) {
        count = countStmt.getAsObject().count as number;
      }
      countStmt.free();
      
      if (count === 0) return 0;
      
      // Perform the update
      const updateStmt = this.db.prepare("UPDATE entries SET partOfSpeech = ? WHERE partOfSpeech = ?");
      updateStmt.run([replace, find]);
      updateStmt.free();
      
      await this.save();
      console.info(`Replaced partOfSpeech: "${find}" → "${replace}" (${count} entries)`);
      return count;
    } catch (e) {
      console.error("Error in find/replace partOfSpeech:", e);
      return 0;
    }
  }

  /**
   * Get all distinct source pages in the database
   */
  getDistinctSourcePages(): string[] {
    if (!this.db) return [];
    
    try {
      const result = this.db.exec("SELECT DISTINCT sourcePage FROM entries WHERE sourcePage IS NOT NULL AND sourcePage != '' ORDER BY sourcePage");
      if (result.length === 0) return [];
      
      return result[0].values.map((row: any[]) => row[0] as string);
    } catch (e) {
      console.error("Error getting distinct source pages:", e);
      return [];
    }
  }

  /**
   * Find missing page numbers in a range
   * @param prefix - The prefix of the page filenames (e.g., "fuerst_lex_")
   * @param suffix - The suffix of the page filenames (e.g., ".jpg")
   * @param startNum - The starting page number
   * @param endNum - The ending page number
   * @returns Array of missing page numbers
   */
  getMissingPages(prefix: string, suffix: string, startNum: number, endNum: number): number[] {
    const existingPages = this.getDistinctSourcePages();
    
    // Extract page numbers from existing pages
    const existingNumbers = new Set<number>();
    const pattern = new RegExp(`^${prefix}(\\d+)${suffix.replace('.', '\\.')}$`);
    
    for (const page of existingPages) {
      const match = page.match(pattern);
      if (match) {
        existingNumbers.add(parseInt(match[1], 10));
      }
    }
    
    // Find missing numbers in range
    const missing: number[] = [];
    for (let i = startNum; i <= endNum; i++) {
      if (!existingNumbers.has(i)) {
        missing.push(i);
      }
    }
    
    return missing;
  }

  updateValidationStatus(entryId: string, status: string, issue?: string): void {
    if (!this.db) return;
    const sql = `UPDATE entries SET status = ?, validationIssue = ? WHERE id = ?`;
    try {
      this.db.run(sql, [status, issue || null, entryId]);
      // Persist immediately to ensure changes survive reloads
      this.save();
    } catch (e) {
      console.error('Failed to update validation status for', entryId, e);
    }
  }

  /**
   * Update multiple validation statuses in a single transaction and save once.
   */
  async updateValidationStatuses(items: { id: string; status: string; issue?: string }[]): Promise<number> {
    if (!this.db || !items || items.length === 0) return 0;
    try {
      this.db.run('BEGIN TRANSACTION');
      const stmt = this.db.prepare('UPDATE entries SET status = ?, validationIssue = ? WHERE id = ?');
      for (const it of items) {
        stmt.bind([it.status, it.issue || null, it.id]);
        stmt.step();
        stmt.reset();
      }
      stmt.free();
      this.db.run('COMMIT');
      await this.save();
      return items.length;
    } catch (e) {
      try { this.db.run('ROLLBACK'); } catch (e2) { /* ignore */ }
      console.error('Failed to update validation statuses batch:', e);
      return 0;
    }
  }
}

export const dbService = new DatabaseService();