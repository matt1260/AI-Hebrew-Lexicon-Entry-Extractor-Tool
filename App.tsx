import React, { useState, useCallback, useEffect, useRef } from 'react';
import FileUploader from './components/FileUploader';
import ResultsDisplay from './components/ResultsDisplay';
import ProcessingQueue from './components/ProcessingQueue';
import AlphabetFilter from './components/AlphabetFilter';
import { ProcessedPage, LexiconEntry } from './types';
import {
  buildValidationBatchJsonl,
  buildCorrectionBatchJsonl,
  buildExtractionBatchJsonl,
  downloadBatchJsonl,
  extractEntriesFromImage,
  validateEntries,
  correctEntries,
  EntryValidationResult,
  EntryCorrectionResult,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_EXTRACTION_PROMPT,
  GeminiModelId
} from './services/geminiService';
import { dbService } from './services/db';

const HEBREW_LETTER_REGEX = /[\u05D0-\u05EA]/g;

const countHebrewLetters = (value?: string) => {
  if (!value) return 0;
  return (value.match(HEBREW_LETTER_REGEX) || []).length;
};

const dbLoadSourceMeta: Record<string, { text: string; color: string }> = {
  server: { text: 'Server synced', color: 'bg-blue-50 text-blue-700 border border-blue-200' },
  indexedDB: { text: 'Cached (IndexedDB)', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  'prebuilt-file': { text: 'Loaded lexicon.sqlite', color: 'bg-slate-50 text-slate-700 border border-slate-200' },
  fresh: { text: 'Fresh database', color: 'bg-amber-50 text-amber-700 border border-amber-200' },
  'invalid-cache': { text: 'Rebuilt (cache invalid)', color: 'bg-red-50 text-red-600 border border-red-200' }
};

const renderLoadSourceBadge = (source: string | null) => {
  if (!source) return null;
  const meta = dbLoadSourceMeta[source];
  if (!meta) return null;
  return (
    <span className={`text-[10px] font-semibold tracking-wide uppercase rounded-full px-2 py-0.5 flex items-center gap-1 ${meta.color}`}>
      {meta.text}
    </span>
  );
};

const parsePageInputValue = (value: string): number | undefined => {
  const digits = (value || '').trim().replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  return parseInt(digits, 10);
};

const extractPageNumberFromId = (value?: string | null): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fourDigit = trimmed.match(/(\d{4})/);
  if (fourDigit) {
    return parseInt(fourDigit[1], 10);
  }
  const anyDigits = trimmed.match(/(\d+)/);
  return anyDigits ? parseInt(anyDigits[1], 10) : null;
};

const App: React.FC = () => {
  const [pages, setPages] = useState<ProcessedPage[]>([]);
  const [dbEntries, setDbEntries] = useState<LexiconEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pageFilter, setPageFilter] = useState<string>('');
  const [isDbReady, setIsDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbLoadSource, setDbLoadSource] = useState<string | null>(null);
  const [isResettingDb, setIsResettingDb] = useState(false);
  const [hasDatabase, setHasDatabase] = useState(false);
  const [initialSetupRequired, setInitialSetupRequired] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);
  const [consonantalFilter, setConsonantalFilter] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<GeminiModelId>(DEFAULT_MODEL);
  const [extractionPrompt, setExtractionPrompt] = useState<string>(DEFAULT_EXTRACTION_PROMPT);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalCount, setTotalCount] = useState(0);
  const [sortBy, setSortBy] = useState<'default' | 'id' | 'hebrew' | 'consonantal' | 'source'>('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  
  // Stop scanning ref
  const stopScanningRef = useRef(false);
  const sweepStopRef = useRef(false);

  // Find/Replace Types modal state
  const [showTypeReplacer, setShowTypeReplacer] = useState(false);
  const [distinctTypes, setDistinctTypes] = useState<string[]>([]);
  const [findType, setFindType] = useState('');
  const [replaceType, setReplaceType] = useState('');

  // Missing pages modal state
  const [showMissingPages, setShowMissingPages] = useState(false);
  const [missingPages, setMissingPages] = useState<number[]>([]);
  const [scannedPagesCount, setScannedPagesCount] = useState(0);
  const [selectedMissingPages, setSelectedMissingPages] = useState<Set<number>>(new Set());
  const [missingPageInstructions, setMissingPageInstructions] = useState<string>('');

  // Delete by page modal state
  const [showDeleteByPage, setShowDeleteByPage] = useState(false);
  const [sourcePages, setSourcePages] = useState<string[]>([]);
  const [selectedDeletePages, setSelectedDeletePages] = useState<Set<string>>(new Set());
  // Invalid pages modal state
  const [showInvalidPages, setShowInvalidPages] = useState(false);
  const [invalidPages, setInvalidPages] = useState<string[]>([]);
  const [selectedInvalidPages, setSelectedInvalidPages] = useState<Set<string>>(new Set());

  // Validation state
  const [validationResults, setValidationResults] = useState<Map<string, EntryValidationResult>>(new Map());
  const [isValidating, setIsValidating] = useState(false);
  const [validationProgress, setValidationProgress] = useState(0);
  const [validatorBatchSize, setValidatorBatchSize] = useState(25);

  // Batch sweeps
  const [sweepStartPage, setSweepStartPage] = useState(0);
  const [sweepEndPage, setSweepEndPage] = useState(0);
  const [sweepStartPageInput, setSweepStartPageInput] = useState('0000');
  const [sweepEndPageInput, setSweepEndPageInput] = useState('0000');
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepMode, setSweepMode] = useState<'validate' | 'correct'>('validate');
  const [sweepProcessedPages, setSweepProcessedPages] = useState(0);
  const [sweepTotalPages, setSweepTotalPages] = useState(0);
  const [sweepInvalidCount, setSweepInvalidCount] = useState(0);
  const [sweepStopRequested, setSweepStopRequested] = useState(false);
  const [maxRequests, setMaxRequests] = useState<number | null>(null);
  const [requestsUsed, setRequestsUsed] = useState(0);
  const [skipValidEntries, setSkipValidEntries] = useState(true);
  const [batchImportType, setBatchImportType] = useState<'validation' | 'correction' | 'extraction'>('validation');
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchImportTotal, setBatchImportTotal] = useState<number | null>(null);
  const [batchImportProcessed, setBatchImportProcessed] = useState(0);
  const [batchImportMessage, setBatchImportMessage] = useState<string | null>(null);
  const batchImportInputRef = useRef<HTMLInputElement | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('darkMode');
      if (saved !== null) return saved === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  // Selected entries for rescan
  const [selectedForRescan, setSelectedForRescan] = useState<Set<string>>(new Set());

  // Check URL for consonantal filter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cFilter = params.get('consonantal');
    if (cFilter) {
      setConsonantalFilter(cFilter);
    }
  }, []);

  // Update page title based on consonantal filter
  useEffect(() => {
    if (consonantalFilter) {
      document.title = `${consonantalFilter} - Hebrew Lexicon`;
    } else {
      document.title = 'Hebrew Lexicon Scanner';
    }
  }, [consonantalFilter]);

  useEffect(() => {
    sweepStopRef.current = sweepStopRequested;
  }, [sweepStopRequested]);

  // Initialize DB on mount
  useEffect(() => {
    const initDb = async () => {
      try {
        const initResult = await dbService.init();
        setDbLoadSource(dbService.getLoadSource());
        setServerConnected(dbService.isServerAvailable());
        setIsDbReady(true);
        setHasDatabase(dbService.hasDatabase());
        setInitialSetupRequired(!initResult.loadedFromExisting);
        // Initialize invalid-page counts so UI reflects DB state immediately
        setSweepInvalidCount(dbService.getPagesWithInvalid().length);
        setInvalidPages(dbService.getPagesWithInvalid());
        // Load initial data based on consonantal filter or letter
        if (consonantalFilter) {
          setTotalCount(dbService.getTotalCount({ consonantal: consonantalFilter }));
          setDbEntries(dbService.getEntriesByConsonantal(consonantalFilter, pageSize, 0, sortBy, sortDir));
        } else {
          refreshEntries(null, '', 1, pageSize);
        }
      } catch (e: any) {
        console.error("Failed to initialize database", e);
        setDbError(e.message || "Failed to load database. Please refresh the page.");
      }
    };
    initDb();
  }, [consonantalFilter]);

  const refreshEntries = useCallback((letter: string | null, query: string = '', page: number = 1, size: number = pageSize, pFilter: string = pageFilter) => {
    const offset = (page - 1) * size;
    
    if (consonantalFilter) {
      setTotalCount(dbService.getTotalCount({ consonantal: consonantalFilter }));
      setDbEntries(dbService.getEntriesByConsonantal(consonantalFilter, size, offset, sortBy, sortDir));
    } else if (pFilter) {
      setTotalCount(dbService.getTotalCount({ page: pFilter }));
      setDbEntries(dbService.getEntriesByPage(pFilter, size, offset, sortBy, sortDir));
    } else if (query) {
      setTotalCount(dbService.getTotalCount({ query }));
      setDbEntries(dbService.searchEntries(query, size, offset, sortBy, sortDir));
    } else if (letter) {
      setTotalCount(dbService.getTotalCount({ letter }));
      setDbEntries(dbService.getEntriesByLetter(letter, size, offset, sortBy, sortDir));
    } else {
      setTotalCount(dbService.getTotalCount());
      setDbEntries(dbService.getAllEntries(size, offset, sortBy, sortDir));
    }
  }, [consonantalFilter, pageSize, sortBy, sortDir, pageFilter]);

  // Update entries when letter filter or search changes
  useEffect(() => {
    if (isDbReady) {
      setCurrentPage(1); // Reset to first page on filter change
      refreshEntries(selectedLetter, searchQuery, 1, pageSize, pageFilter);
    }
  }, [selectedLetter, searchQuery, pageFilter, isDbReady, refreshEntries, pageSize]);

  // Validate a given array of entries (called from ResultsDisplay)
  const validateEntriesFor = useCallback(async (entriesToValidate: LexiconEntry[], batchSize: number = 25) => {
    if (entriesToValidate.length === 0) return;

    setIsValidating(true);
    setValidationProgress(0);
    try {
      const batch = batchSize || 25;
      const results = new Map<string, EntryValidationResult>();

      for (let i = 0; i < entriesToValidate.length; i += batch) {
        const slice = entriesToValidate.slice(i, i + batch);
        const batchResults = await validateEntries(
          slice.map(e => ({ id: e.id, hebrewWord: e.hebrewWord, hebrewConsonantal: e.hebrewConsonantal || '', definition: e.definition, root: e.root, partOfSpeech: e.partOfSpeech })),
          selectedModel
        );

        for (const r of batchResults) {
          results.set(r.id, r);
        }

        // Persist batch updates to DB in one transaction
        try {
          await dbService.updateValidationStatuses(batchResults.map(r => ({ id: r.id, status: r.isValid ? 'valid' : 'invalid', issue: r.issue })));
        } catch (e) {
          console.error('Failed to persist batch validation results:', e);
        }

        setValidationProgress(Math.min(i + batch, entriesToValidate.length));
        setValidationResults(new Map(results));
      }

      // Auto-select invalid entries for rescan
      const invalidIds = new Set<string>();
      for (const [id, res] of results) {
        if (!res.isValid) invalidIds.add(id);
      }
      setSelectedForRescan(invalidIds);

      // Refresh entries to show updated status
      refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    } catch (error: any) {
      console.error('Validation error:', error);
      alert('Error validating entries: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsValidating(false);
    }
  }, [selectedModel, refreshEntries, selectedLetter, searchQuery, currentPage, pageSize]);

  const fetchEntriesBySourcePage = useCallback((pageNumber: number) => {
    const suffix = String(pageNumber).padStart(4, '0');
    const candidates = [
      `fuerst_lex_${suffix}.jpg`,
      `${suffix}.jpg`,
      `fuerst_lex_${suffix}`,
      suffix,
      pageNumber.toString()
    ];

    for (const id of candidates) {
      const entries = dbService.getEntriesBySourcePage(id);
      if (entries.length > 0) {
        return { entries, usedId: id };
      }
    }

    return { entries: [] as LexiconEntry[], usedId: candidates[0] };
  }, []);

  const collectSweepEntries = useCallback(() => {
    const startPage = Math.max(1, sweepStartPage);
    const endPage = Math.max(startPage, sweepEndPage);
    const output: LexiconEntry[] = [];

    for (let p = startPage; p <= endPage; p++) {
      const { entries } = fetchEntriesBySourcePage(p);
      const toValidate = skipValidEntries
        ? entries.filter(e => e.status === 'unchecked')
        : entries;
      output.push(...toValidate);
    }

    return { entries: output, startPage, endPage };
  }, [fetchEntriesBySourcePage, skipValidEntries, sweepEndPage, sweepStartPage]);

  const resetSweepStopFlag = useCallback(() => {
    sweepStopRef.current = false;
    setSweepStopRequested(false);
  }, [setSweepStopRequested]);

  const handleStopSweep = useCallback(() => {
    sweepStopRef.current = true;
    setSweepStopRequested(true);
  }, [setSweepStopRequested]);

  // Run a validation sweep over source page filenames (fuerst_lex_####.jpg)
  const runValidationSweep = useCallback(async () => {
    if (sweepRunning) return;

    const startPage = Math.max(1, sweepStartPage);
    const endPage = Math.max(startPage, sweepEndPage);
    const totalPages = endPage - startPage + 1;

    console.log('Starting validation sweep (source pages)', {
      sweepStartPage,
      sweepEndPage,
      skipValidEntries,
      validatorBatchSize,
      startPage,
      endPage,
    });

    setSweepRunning(true);
    setSweepMode('validate');
    resetSweepStopFlag();
    setSweepTotalPages(totalPages);
    setSweepProcessedPages(0);

    let usedRequests = requestsUsed;

    try {
      for (let p = startPage; p <= endPage; p++) {
        if (sweepStopRef.current) break;

        const { entries: allEntriesOnPage, usedId } = fetchEntriesBySourcePage(p);
        const uncheckedCount = allEntriesOnPage.filter(e => e.status === 'unchecked').length;
        const entriesToValidate = skipValidEntries
          ? allEntriesOnPage.filter(e => e.status === 'unchecked')
          : allEntriesOnPage;

        if (allEntriesOnPage.length === 0) {
          try {
            const distinct = dbService.getDistinctSourcePages();
            const nearby = distinct.filter(pg => pg.includes(String(p)) || pg.includes(String(p).padStart(4, '0'))).slice(0, 10);
            console.warn(`No entries found for page number ${p} (tried ${usedId}). Distinct pages: ${distinct.length}. Nearby:`, nearby);
          } catch (e) {
            console.warn(`No entries found for page number ${p} (tried ${usedId}) and distinct lookup failed`, e);
          }
        }

        console.log(
          `Source page #${p} (using '${usedId}'): total=${allEntriesOnPage.length}, unchecked=${uncheckedCount}, to-validate=${entriesToValidate.length}`
        );

        if (entriesToValidate.length > 0) {
          await validateEntriesFor(entriesToValidate, validatorBatchSize);
          setSweepInvalidCount(dbService.getPagesWithInvalid().length);

          const batchesUsed = Math.ceil(entriesToValidate.length / validatorBatchSize);
          usedRequests += batchesUsed;
          setRequestsUsed(usedRequests);
          if (maxRequests !== null && usedRequests >= maxRequests) {
            handleStopSweep();
            break;
          }
        }

        setSweepProcessedPages((prev) => prev + 1);
      }
      console.log('Validation sweep finished');
      } finally {
        // Ensure invalid-page UI is refreshed after sweep
        setSweepInvalidCount(dbService.getPagesWithInvalid().length);
        setInvalidPages(dbService.getPagesWithInvalid());
        setSweepRunning(false);
      }
  }, [
    sweepRunning,
    sweepStartPage,
    sweepEndPage,
    validatorBatchSize,
    validateEntriesFor,
    skipValidEntries,
    maxRequests,
    requestsUsed,
    fetchEntriesBySourcePage,
    resetSweepStopFlag,
    handleStopSweep,
  ]);

  const handleExportValidationBatch = useCallback(() => {
    const { entries, startPage, endPage } = collectSweepEntries();
    if (entries.length === 0) {
      alert('No entries were selected for this sweep range.');
      return;
    }
    const jsonl = buildValidationBatchJsonl(entries, selectedModel);
    downloadBatchJsonl(jsonl, `validation-${startPage}-${endPage}.jsonl`);
  }, [collectSweepEntries, selectedModel]);

  const handleExportCorrectionBatch = useCallback(() => {
    const startPage = Math.max(1, sweepStartPage);
    const endPage = Math.max(startPage, sweepEndPage);
    const output: LexiconEntry[] = [];

    for (let p = startPage; p <= endPage; p++) {
      const { entries } = fetchEntriesBySourcePage(p);
      // For correction batch, we typically want invalid entries
      const toCorrect = entries.filter(e => e.status === 'invalid');
      output.push(...toCorrect);
    }

    if (output.length === 0) {
      alert('No invalid entries found in the selected range.');
      return;
    }

    const jsonl = buildCorrectionBatchJsonl(output, selectedModel);
    downloadBatchJsonl(jsonl, `correction-${startPage}-${endPage}.jsonl`);
  }, [sweepStartPage, sweepEndPage, fetchEntriesBySourcePage, selectedModel]);

  const tryParseJson = (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };

  const parseBatchResults = useCallback((text: string): any[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const cleanCodeFences = (value: string) => {
      const raw = value.trim();
      if (!raw.startsWith('```')) return raw;
      const firstLineBreak = raw.indexOf('\n');
      let body = raw;
      if (firstLineBreak !== -1) {
        body = raw.slice(firstLineBreak + 1);
      }
      const closingIndex = body.lastIndexOf('```');
      if (closingIndex !== -1) {
        body = body.slice(0, closingIndex);
      }
      return body.trim();
    };

    const parseJsonBlock = (value?: string) => {
      if (!value) return undefined;
      return tryParseJson(cleanCodeFences(value));
    };

    const collected: any[] = [];
    const pushValue = (payload: any, key?: string) => {
      if (payload === undefined || payload === null) return;
      if (Array.isArray(payload)) {
        payload.forEach(item => {
          if (key && typeof item === 'object' && item !== null) {
            item._batchKey = key;
          }
          collected.push(item);
        });
      } else {
        if (key && typeof payload === 'object' && payload !== null) {
          payload._batchKey = key;
        }
        collected.push(payload);
      }
    };

    const handleParts = (parts: any[], key?: string) => {
      if (!Array.isArray(parts)) return false;
      let handled = false;
      for (const part of parts) {
        const parsedPart = parseJsonBlock(part?.text ?? part?.data);
        if (parsedPart !== undefined) {
          pushValue(parsedPart, key);
          handled = true;
        }
      }
      return handled;
    };

    const handleResponseContainer = (response: any, key?: string) => {
      if (!response) return false;
      let handled = false;

      if (Array.isArray(response)) {
        response.forEach(v => pushValue(v, key));
        return true;
      }

      if (Array.isArray(response.candidates)) {
        for (const candidate of response.candidates) {
          const candidateContent = candidate?.content;
          if (candidateContent?.parts) {
            handled = handleParts(candidateContent.parts, key) || handled;
          } else if (Array.isArray(candidateContent)) {
            handled = handleParts(candidateContent, key) || handled;
          }
        }
      }

      if (Array.isArray(response.content)) {
        handled = handleParts(response.content, key) || handled;
      }

      if (typeof response.text === 'string') {
        const parsed = parseJsonBlock(response.text);
        if (parsed !== undefined) {
          pushValue(parsed, key);
          handled = true;
        }
      }

      return handled;
    };

    const direct = tryParseJson(trimmed);
    if (Array.isArray(direct)) return direct;

    const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    for (const line of lines) {
      const parsed = tryParseJson(line);
      if (!parsed) continue;

      const key = parsed.key;

      if (Array.isArray(parsed)) {
        pushValue(parsed, key);
        continue;
      }

      if (handleResponseContainer(parsed.response, key)) {
        continue;
      }

      if (handleResponseContainer(parsed, key)) {
        continue;
      }

      if (key && typeof parsed === 'object') {
        parsed._batchKey = key;
      }
      collected.push(parsed);
    }

    return collected;
  }, []);

  const applyValidationBatchResults = useCallback(async (results: any[]) => {
    const sanitized = results
      .filter(res => res && typeof res.id === 'string')
      .map(res => ({ id: res.id, status: res.isValid ? 'valid' : 'invalid', issue: res.issue }));
    if (sanitized.length === 0) {
      alert('No valid validation entries were found in the batch output.');
      return;
    }

    // Show progress UI
    setBatchImportTotal(sanitized.length);
    setBatchImportProcessed(0);
    setBatchImportMessage('Applying validation records...');

    let applied = 0;
    for (let i = 0; i < sanitized.length; i++) {
      const s = sanitized[i];
      // Write individually so we can show progress (dbService also offers a batch method but it is opaque)
      try {
        await dbService.updateValidationStatus(s.id, s.status, s.issue);
        applied += 1;
      } catch (e) {
        // ignore individual failures but continue progress
      }
      setBatchImportProcessed(i + 1);
    }

    setSweepInvalidCount(dbService.getPagesWithInvalid().length);
    refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    alert(`Imported ${applied} validation records.`);
  }, [refreshEntries, selectedLetter, searchQuery, currentPage, pageSize]);

  const applyExtractionBatchResults = useCallback(async (results: any[]) => {
    const entries: LexiconEntry[] = [];

    // Track progress
    setBatchImportTotal(results.length);
    setBatchImportProcessed(0);
    setBatchImportMessage('Extracting entries from batch output...');

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (!res.hebrewWord || !res.definition) {
        setBatchImportProcessed(i + 1);
        continue;
      }

      // Try to extract sourcePage from _batchKey (e.g. extract-fuerst_lex_0041-jpg-123456789)
      let sourcePage = undefined;
      if (res._batchKey && res._batchKey.startsWith('extract-')) {
        const parts = res._batchKey.split('-');
        // The filename was slugified: file.name.replace(/[^a-zA-Z0-9]/g, '-')
        // We can try to reconstruct it or at least find the fuerst_lex_#### part
        const match = res._batchKey.match(/fuerst_lex_(\d{4})/);
        if (match) {
          sourcePage = `fuerst_lex_${match[1]}.jpg`;
        } else {
          // Fallback: use the part after 'extract-' but before the timestamp
          sourcePage = parts.slice(1, -1).join('-');
          if (!sourcePage.includes('.')) sourcePage += '.jpg';
        }
      }

      const entry: LexiconEntry = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36),
        hebrewWord: res.hebrewWord,
        hebrewConsonantal: res.hebrewConsonantal,
        transliteration: res.transliteration,
        partOfSpeech: res.partOfSpeech || '',
        definition: res.definition,
        root: res.root,
        sourcePage: sourcePage,
        status: 'unchecked',
        dateAdded: Date.now()
      };
      
      // Enrich with Strong's if possible
      const strongsMatches = dbService.getStrongNumbersFor(entry.hebrewWord);
      if (strongsMatches.length > 0) {
        entry.strongsNumbers = strongsMatches.join('/');
      }
      entry.isRoot = countHebrewLetters(entry.hebrewWord) === 3;
      
      entries.push(entry);
      setBatchImportProcessed(i + 1);
    }

    if (entries.length === 0) {
      alert('No valid extraction entries were found in the batch output.');
      return;
    }

    await dbService.addEntries(entries);
    setBatchImportProcessed(results.length);
    refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    alert(`Imported ${entries.length} new entries from batch extraction.`);
  }, [refreshEntries, selectedLetter, searchQuery, currentPage, pageSize]);

  const applyCorrectionBatchResults = useCallback(async (results: any[]) => {
    let updatedCount = 0;
    setBatchImportTotal(results.length);
    setBatchImportProcessed(0);
    setBatchImportMessage('Applying corrections...');

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result?.id) {
        setBatchImportProcessed(i + 1);
        continue;
      }
      const updates: Partial<LexiconEntry> = {};
      if (typeof result.hebrewWord === 'string') updates.hebrewWord = result.hebrewWord;
      if (typeof result.hebrewConsonantal === 'string') updates.hebrewConsonantal = result.hebrewConsonantal;
      if (typeof result.root === 'string') updates.root = result.root;
      if (typeof result.definition === 'string') updates.definition = result.definition;
      if (typeof result.partOfSpeech === 'string') updates.partOfSpeech = result.partOfSpeech;
      if (typeof result.transliteration === 'string') updates.transliteration = result.transliteration;

      if (Object.keys(updates).length > 0) {
        const success = await dbService.updateEntry(result.id, updates);
        if (success) updatedCount += 1;
      }

      if (typeof result.status === 'string') {
        dbService.updateValidationStatus(result.id, result.status, result.validationIssue);
      } else if (typeof result.validationIssue === 'string') {
        dbService.updateValidationStatus(result.id, 'invalid', result.validationIssue);
      }

      setBatchImportProcessed(i + 1);
    }

    setSweepInvalidCount(dbService.getPagesWithInvalid().length);
    refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    alert(`Imported ${updatedCount} corrected entries.`);
  }, [refreshEntries, selectedLetter, searchQuery, currentPage, pageSize]);

  const handleBatchFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBatchImporting(true);
    setBatchImportTotal(null);
    setBatchImportProcessed(0);
    setBatchImportMessage('Preparing to import...');

    try {
      const text = await file.text();
      const parsed = parseBatchResults(text);
      if (parsed.length === 0) {
        alert('Batch file does not contain any recognizable entries.');
        return;
      }
      if (batchImportType === 'validation') {
        await applyValidationBatchResults(parsed);
      } else if (batchImportType === 'extraction') {
        await applyExtractionBatchResults(parsed);
      } else {
        await applyCorrectionBatchResults(parsed);
      }
    } catch (error: any) {
      console.error('Failed to import batch results', error);
      alert('Failed to import batch results: ' + (error?.message || 'Unknown error'));
    } finally {
      setBatchImporting(false);
      setBatchImportTotal(null);
      setBatchImportProcessed(0);
      setBatchImportMessage(null);
      if (batchImportInputRef.current) {
        batchImportInputRef.current.value = '';
      }
    }
  }, [batchImportType, applyCorrectionBatchResults, applyValidationBatchResults, parseBatchResults]);

  // Run correction on pages with invalid entries
  const runCorrectionSweep = useCallback(async () => {
    if (sweepRunning) return;
    setSweepRunning(true);
    setSweepMode('correct');
    resetSweepStopFlag();

    const normalizedStart = Math.max(1, sweepStartPage || 1);
    const normalizedEnd = Math.max(normalizedStart, sweepEndPage || normalizedStart);
    const filterByRange = sweepStartPage > 0 || sweepEndPage > 0;

    const pagesWithInvalid = dbService.getPagesWithInvalid();
    const targetPages = filterByRange
      ? pagesWithInvalid.filter((pageId) => {
          const pageNumber = extractPageNumberFromId(pageId);
          if (pageNumber === null) return false;
          return pageNumber >= normalizedStart && pageNumber <= normalizedEnd;
        })
      : pagesWithInvalid;

    setSweepTotalPages(targetPages.length);
    setSweepProcessedPages(0);

    if (targetPages.length === 0) {
      alert('No invalid pages found in the selected range.');
      setSweepRunning(false);
      return;
    }

    let usedRequests = requestsUsed;

    try {
      for (const pageId of targetPages) {
        if (sweepStopRef.current) break;

        const invalidEntries = dbService.getInvalidEntriesBySourcePage(pageId);
        // Try to fetch the page image once for this page so the model can reference it when correcting
        let pageFile: File | undefined = undefined;
        if (invalidEntries.length > 0) {
          const sample = invalidEntries[0];
          const imageUrl = sample.sourcePage && sample.sourcePage.startsWith('fuerst_lex_') ? `/fuerst_lex/${sample.sourcePage}` : sample.sourceUrl;
          if (imageUrl) {
            try {
              const res = await fetch(imageUrl);
              if (res.ok) {
                const blob = await res.blob();
                const name = sample.sourcePage || `page-${pageId}`;
                pageFile = new File([blob], name, { type: blob.type || 'image/jpeg' });
              }
            } catch (e) {
              console.warn('Failed to fetch page image for corrections:', imageUrl, e);
            }
          }
        }

        // If we couldn't obtain a page image, skip corrections for this page
        if (!pageFile) {
          console.warn(`Skipping corrections for page ${pageId} because the scanned image could not be fetched.`);
          // Still count this page as processed so progress advances
          setSweepProcessedPages((prev) => prev + 1);
          continue;
        }

        if (invalidEntries.length > 0) {
          // Correct in small batches (e.g., 10)
          const batchSize = 10;
          for (let i = 0; i < invalidEntries.length; i += batchSize) {
            const slice = invalidEntries.slice(i, i + batchSize);
            const corrections: EntryCorrectionResult[] = await correctEntries(
              slice.map(e => ({
                id: e.id,
                hebrewWord: e.hebrewWord,
                hebrewConsonantal: e.hebrewConsonantal,
                root: e.root,
                definition: e.definition,
                partOfSpeech: e.partOfSpeech,
                validationIssue: e.validationIssue,
              })),
              selectedModel,
              pageFile
            );

            usedRequests += 1;
            setRequestsUsed(usedRequests);
            if (maxRequests !== null && usedRequests >= maxRequests) {
              handleStopSweep();
              break;
            }

            // Apply corrections
            const updates: { id: string; status: string; issue?: string }[] = [];
            for (const c of corrections) {
              dbService.updateEntry(c.id, {
                hebrewWord: c.hebrewWord,
                hebrewConsonantal: c.hebrewConsonantal,
                root: c.root,
                status: c.status,
                validationIssue: c.validationIssue,
              });
              updates.push({ id: c.id, status: c.status, issue: c.validationIssue });
            }
            if (updates.length > 0) {
              await dbService.updateValidationStatuses(updates);
            }

            if (sweepStopRef.current) {
              break;
            }
          }
        }

        setSweepProcessedPages((prev) => prev + 1);
        setSweepInvalidCount(dbService.getPagesWithInvalid().length);
        if (sweepStopRef.current) {
          break;
        }
      }
    } finally {
      // Refresh view after corrections and update invalid pages
      refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
      setSweepInvalidCount(dbService.getPagesWithInvalid().length);
      setInvalidPages(dbService.getPagesWithInvalid());
      setSweepRunning(false);
    }
  }, [
    sweepRunning,
    selectedModel,
    selectedLetter,
    searchQuery,
    currentPage,
    pageSize,
    refreshEntries,
    maxRequests,
    requestsUsed,
    sweepStartPage,
    sweepEndPage,
    resetSweepStopFlag,
    handleStopSweep,
  ]);

  // Clear consonantal filter and return to main view
  const clearConsonantalFilter = () => {
    setConsonantalFilter(null);
    window.history.replaceState({}, '', window.location.pathname);
    setCurrentPage(1);
    refreshEntries(selectedLetter, searchQuery, 1, pageSize);
  };

  const handleDeleteEntries = useCallback((idsToDelete: string[]) => {
    dbService.deleteEntries(idsToDelete);
    refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    // Keep invalid-page count/list accurate after deletions
    setSweepInvalidCount(dbService.getPagesWithInvalid().length);
    setInvalidPages(dbService.getPagesWithInvalid());
  }, [selectedLetter, searchQuery, currentPage, pageSize, refreshEntries]);

  // Invalid pages modal helpers
  const refreshInvalidPages = useCallback(() => {
    const pages = dbService.getPagesWithInvalid();
    setInvalidPages(pages);
  }, []);

  const toggleInvalidPageSelection = useCallback((pageId: string) => {
    setSelectedInvalidPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  }, []);

  const selectAllInvalidPages = useCallback(() => {
    const all = new Set(invalidPages);
    setSelectedInvalidPages(all);
  }, [invalidPages]);

  const clearInvalidSelection = useCallback(() => setSelectedInvalidPages(new Set()), []);

  const copyInvalidFilenames = useCallback(() => {
    const filenames = invalidPages.map(n => n).join('\n');
    navigator.clipboard.writeText(filenames);
    alert('Copied invalid page ids to clipboard!');
  }, [invalidPages]);

  const exportInvalidFilenames = useCallback(() => {
    const blob = new Blob([invalidPages.map(n => `fuerst_lex_${String(n).padStart(4, '0')}.jpg`).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invalid-pages.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [invalidPages]);

  // Run corrections over a specific array of page ids (sourcePage strings)
  const runCorrectionsOnPages = useCallback(async (pageIds: string[]) => {
    if (pageIds.length === 0) return;
    if (sweepRunning) {
      alert('A sweep is already running. Stop it before starting another.');
      return;
    }

    setSweepRunning(true);
    setSweepMode('correct');
    resetSweepStopFlag();
    setSweepTotalPages(pageIds.length);
    setSweepProcessedPages(0);
    let usedRequests = requestsUsed;

    try {
      for (const pageId of pageIds) {
        if (sweepStopRef.current) break;
        const invalidEntries = dbService.getInvalidEntriesBySourcePage(pageId);
        let pageFile: File | undefined = undefined;
        if (invalidEntries.length > 0) {
          const sample = invalidEntries[0];
          const imageUrl = sample.sourcePage && sample.sourcePage.startsWith('fuerst_lex_') ? `/fuerst_lex/${sample.sourcePage}` : sample.sourceUrl;
          if (imageUrl) {
            try {
              const res = await fetch(imageUrl);
              if (res.ok) {
                const blob = await res.blob();
                const name = sample.sourcePage || `page-${pageId}`;
                pageFile = new File([blob], name, { type: blob.type || 'image/jpeg' });
              }
            } catch (e) {
              console.warn('Failed to fetch page image for corrections:', imageUrl, e);
            }
          }
        }

        if (!pageFile) {
          setSweepProcessedPages((prev) => prev + 1);
          continue;
        }

        if (invalidEntries.length > 0) {
          const batchSize = 10;
          for (let i = 0; i < invalidEntries.length; i += batchSize) {
            const slice = invalidEntries.slice(i, i + batchSize);
            const corrections: EntryCorrectionResult[] = await correctEntries(
              slice.map(e => ({ id: e.id, hebrewWord: e.hebrewWord, hebrewConsonantal: e.hebrewConsonantal, root: e.root, definition: e.definition, partOfSpeech: e.partOfSpeech, validationIssue: e.validationIssue })),
              selectedModel,
              pageFile
            );

            usedRequests += 1;
            setRequestsUsed(usedRequests);
            if (maxRequests !== null && usedRequests >= maxRequests) {
              handleStopSweep();
              break;
            }

            const updates: { id: string; status: string; issue?: string }[] = [];
            for (const c of corrections) {
              dbService.updateEntry(c.id, { hebrewWord: c.hebrewWord, hebrewConsonantal: c.hebrewConsonantal, root: c.root, status: c.status, validationIssue: c.validationIssue });
              updates.push({ id: c.id, status: c.status, issue: c.validationIssue });
            }
            if (updates.length > 0) await dbService.updateValidationStatuses(updates);

            if (sweepStopRef.current) break;
          }
        }

        setSweepProcessedPages((prev) => prev + 1);
        setSweepInvalidCount(dbService.getPagesWithInvalid().length);
        if (sweepStopRef.current) break;
      }
    } finally {
      refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
      setSweepRunning(false);
      refreshInvalidPages();
    }
  }, [resetSweepStopFlag, selectedModel, maxRequests, requestsUsed, selectedLetter, searchQuery, currentPage, pageSize, refreshEntries, refreshInvalidPages]);

  const handleUpdateEntry = useCallback(async (id: string, updates: Partial<LexiconEntry>): Promise<boolean> => {
    const success = await dbService.updateEntry(id, updates);
    if (success) {
      refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    }
    return success;
  }, [selectedLetter, searchQuery, currentPage, pageSize, refreshEntries]);

  const handleSetEntryStatus = useCallback(async (id: string, status: 'valid' | 'invalid' | 'unchecked', issue?: string | null) => {
    try {
      dbService.updateValidationStatus(id, status, issue ?? null);
      // Keep UI in sync
      if (status === 'valid') {
        setSelectedForRescan(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      }
      // Update validationResults map for immediate UI feedback
      setValidationResults(prev => {
        const m = new Map(prev);
        m.set(id, { id, isValid: status === 'valid', issue: issue || undefined });
        return m;
      });
      // Keep invalid pages count and list up to date
      setSweepInvalidCount(dbService.getPagesWithInvalid().length);
      setInvalidPages(dbService.getPagesWithInvalid());
      refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    } catch (e) {
      console.error('Failed to set entry status', e);
      throw e;
    }
  }, [selectedLetter, searchQuery, currentPage, pageSize, refreshEntries]);

  const handleLetterSelect = (letter: string | null) => {
    setSelectedLetter(letter);
    setCurrentPage(1);
    if (letter) {
      setSearchQuery(''); // Clear search when selecting a letter
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
    if (query) {
      setSelectedLetter(null); // Clear letter filter when searching
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    refreshEntries(selectedLetter, searchQuery, page, pageSize);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    refreshEntries(selectedLetter, searchQuery, 1, size);
  };

  const handleFilesSelected = useCallback((files: File[]) => {
    setPendingFiles(files);
  }, []);

  const handleExportExtractionBatch = useCallback(() => {
    if (pendingFiles.length === 0) return;
    const jsonl = buildExtractionBatchJsonl(pendingFiles, selectedModel, extractionPrompt);
    downloadBatchJsonl(jsonl, `extraction-batch-${Date.now()}.jsonl`);
  }, [pendingFiles, selectedModel, extractionPrompt]);

  const handleExportAll = useCallback(async () => {
    try {
      const allEntries = await dbService.getAllEntries();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allEntries, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "lexicon_full_database.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    } catch (error) {
      console.error("Failed to export database:", error);
      alert("Failed to export database. See console for details.");
    }
  }, []);

  const processFiles = useCallback(async (files: File[], extraInstructions: string | undefined = undefined) => {
    // Create initial page objects for status tracking
    const newPages: ProcessedPage[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      fileName: file.name,
      imageUrl: URL.createObjectURL(file),
      status: 'pending',
      entries: []
    }));

    setPages(prev => [...prev, ...newPages]);
    setIsProcessing(true);
    stopScanningRef.current = false;

    // Clear pending files if we are processing them
    setPendingFiles([]);

    for (let i = 0; i < files.length; i++) {
      // Check if scanning was stopped
      if (stopScanningRef.current) {
        // Mark remaining pending pages as cancelled
        setPages(prev => prev.map(p => 
          p.status === 'pending' ? { ...p, status: 'error', error: 'Cancelled by user' } : p
        ));
        break;
      }
      
      const file = files[i];
      const pageId = newPages[i].id;
      const pageUrl = newPages[i].imageUrl;

      setPages(prev => prev.map(p => 
        p.id === pageId ? { ...p, status: 'processing' } : p
      ));

      try {
        // Use the provided extraInstructions (from missing pages modal) or the global extractionPrompt
        const promptToUse = extraInstructions || extractionPrompt;
        const extractedEntries = await extractEntriesFromImage(file, selectedModel, promptToUse);
        
        // Enrich entries with source metadata
        const enrichedEntries: LexiconEntry[] = extractedEntries.map(entry => {
          const strongsMatches = dbService.getStrongNumbersFor(entry.hebrewWord);
          return {
            ...entry,
            isRoot: countHebrewLetters(entry.hebrewWord) === 3,
            strongsNumbers: strongsMatches.length > 0 ? strongsMatches.join('/') : undefined,
            sourcePage: file.name,
            sourceUrl: pageUrl
          };
        });

        // Insert into Database
        dbService.addEntries(enrichedEntries);
        // Update invalid page counts immediately after adding entries
        setSweepInvalidCount(dbService.getPagesWithInvalid().length);
        setInvalidPages(dbService.getPagesWithInvalid());
        
        // Update local status
        setPages(prev => prev.map(p => 
          p.id === pageId ? { 
            ...p, 
            status: 'completed', 
            entries: enrichedEntries 
          } : p
        ));

        // Refresh the view if the new entries are relevant to current filter
        // Simplifying to just refresh view
        refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);

      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isQuotaError = errorMessage.toLowerCase().includes('quota') || errorMessage.includes('429');
        
        setPages(prev => {
          let updatedPages = prev.map((p): ProcessedPage => 
            p.id === pageId ? { 
              ...p, 
              status: 'error', 
              error: errorMessage 
            } : p
          );

          if (isQuotaError) {
             updatedPages = updatedPages.map((p): ProcessedPage => 
               p.status === 'pending' ? {
                 ...p,
                 status: 'error',
                 error: 'Cancelled: API Quota Exceeded'
               } : p
             );
          }
          return updatedPages;
        });

        if (isQuotaError) break;
      }
    }
    
    setIsProcessing(false);
  }, [selectedLetter, searchQuery, refreshEntries, selectedModel, currentPage, pageSize]);

  const handleStopScanning = useCallback(() => {
    stopScanningRef.current = true;
  }, []);

  const handleCreateNewDatabase = useCallback(async () => {
    // Open backup modal instead of creating a new DB
    setShowBackupModal(true);
  }, [refreshEntries]);

  const handleCreateNewDatabaseNow = useCallback(async () => {
    // Only allow creating a new DB if none exists, otherwise confirm overwrite
    if (dbService.hasDatabase()) {
      if (!window.confirm('A database already exists. Creating a new DB now will replace the current working DB. Continue?')) {
        return;
      }
    }
    setIsResettingDb(true);
    setDbError(null);
    try {
      await dbService.resetDatabase();
      await dbService.init();
      setDbLoadSource(dbService.getLoadSource());
      setHasDatabase(dbService.hasDatabase());
      setInitialSetupRequired(false);
      refreshEntries(null);
      setSweepInvalidCount(dbService.getPagesWithInvalid().length);
      setInvalidPages(dbService.getPagesWithInvalid());
      alert('A fresh database has been created and is ready.');
    } catch (error: any) {
      console.error('Failed to create new database', error);
      setDbError(error?.message || 'Failed to create new database.');
    } finally {
      setIsResettingDb(false);
    }
  }, [refreshEntries]);

  const handleReprocessStrongs = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const result = await dbService.reprocessStrongsNumbers();
      alert(`Strong's numbers reprocessed!\n\nTotal entries: ${result.total}\nUpdated: ${result.updated}`);
      refreshEntries(selectedLetter, searchQuery);
    } catch (error: any) {
      console.error('Failed to reprocess Strong\'s numbers', error);
      alert('Failed to reprocess Strong\'s numbers: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, selectedLetter, searchQuery, refreshEntries]);

  // Backup DB modal state
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupFilename, setBackupFilename] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `lexicon-backup-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.sqlite`;
    return name;
  });

  const handleConfirmBackup = useCallback(() => {
    const data = dbService.exportDatabase();
    if (!data) {
      alert('No database is loaded or export failed.');
      setShowBackupModal(false);
      return;
    }
    try {
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const blob = new Blob([arrayBuffer as ArrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFilename || 'lexicon-backup.sqlite';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowBackupModal(false);
      alert('Backup saved as ' + (backupFilename || 'lexicon-backup.sqlite'));
    } catch (e) {
      console.error('Failed to save backup', e);
      alert('Failed to save backup: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [backupFilename]);

  const handleRebuildIds = useCallback(async () => {
    // Open the modal with default settings
    if (isProcessing) return;
    setShowRebuildIdsModal(true);
  }, [isProcessing, selectedLetter, searchQuery, refreshEntries]);

  const handleMoveRomanNumerals = useCallback(async () => {
    if (isProcessing) return;
    if (!window.confirm('This will move Roman numerals (I, II, III, etc.) from Hebrew words to the beginning of definitions.\n\nExample: "חָפָה I" → "חָפָה" with definition "I. original definition..."\n\nContinue?')) {
      return;
    }
    setIsProcessing(true);
    try {
      const result = await dbService.moveRomanNumeralsToDefinition();
      alert(`Roman numerals moved!\n\nTotal entries: ${result.total}\nUpdated: ${result.updated}`);
      refreshEntries(selectedLetter, searchQuery);
    } catch (error: any) {
      console.error('Failed to move Roman numerals', error);
      alert('Failed to move Roman numerals: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, selectedLetter, searchQuery, refreshEntries]);

  // Rebuild IDs modal state & settings
  const [showRebuildIdsModal, setShowRebuildIdsModal] = useState(false);
  const [idPrefix, setIdPrefix] = useState('F');
  const [idStartAt, setIdStartAt] = useState(1);
  const [idPadWidth, setIdPadWidth] = useState(0);
  const [idSortBy, setIdSortBy] = useState<'consonantal' | 'word' | 'source' | 'date'>('consonantal');
  const [idSortDir, setIdSortDir] = useState<'asc' | 'desc'>('asc');

  const handleConfirmRebuildIds = useCallback(async () => {
    if (isProcessing) return;
    setShowRebuildIdsModal(false);
    setIsProcessing(true);
    try {
      const opts = {
        prefix: idPrefix || 'F',
        startAt: Math.max(1, Number(idStartAt) || 1),
        padWidth: Math.max(0, Number(idPadWidth) || 0),
        sortBy: idSortBy,
        sortDir: idSortDir,
      } as const;
      const result = await dbService.rebuildLexiconIds(opts as any);
      alert(`Lexicon IDs rebuilt!\n\nTotal entries renumbered: ${result.total}`);
      refreshEntries(selectedLetter, searchQuery);
      setSweepInvalidCount(dbService.getPagesWithInvalid().length);
      refreshInvalidPages();
    } catch (error: any) {
      console.error('Failed to rebuild lexicon IDs', error);
      alert('Failed to rebuild IDs: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, idPrefix, idStartAt, idPadWidth, idSortBy, idSortDir, refreshEntries, selectedLetter, searchQuery]);

  const handleCleanRootNumerals = useCallback(async () => {
    if (isProcessing) return;
    if (!window.confirm('This will remove Roman numerals (I, II, III, etc.) from root fields.\n\nExample: "יָדַע I." → "יָדַע"\n\nContinue?')) {
      return;
    }
    setIsProcessing(true);
    try {
      const result = await dbService.cleanRomanNumeralsFromRoot();
      alert(`Root numerals cleaned!\n\nTotal roots checked: ${result.total}\nUpdated: ${result.updated}`);
      refreshEntries(selectedLetter, searchQuery);
    } catch (error: any) {
      console.error('Failed to clean root numerals', error);
      alert('Failed to clean root numerals: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, selectedLetter, searchQuery, refreshEntries]);

  const handleOpenTypeReplacer = useCallback(() => {
    const types = dbService.getDistinctPartOfSpeech();
    setDistinctTypes(types);
    setFindType('');
    setReplaceType('');
    setShowTypeReplacer(true);
  }, []);

  const handleFindReplaceType = useCallback(async () => {
    if (!findType.trim()) {
      alert('Please enter a type to find');
      return;
    }
    if (!replaceType.trim()) {
      alert('Please enter a replacement type');
      return;
    }
    if (findType === replaceType) {
      alert('Find and replace values are the same');
      return;
    }
    
    const count = await dbService.findReplacePartOfSpeech(findType.trim(), replaceType.trim());
    if (count > 0) {
      alert(`Replaced ${count} entries: "${findType}" → "${replaceType}"`);
      // Refresh the distinct types list
      setDistinctTypes(dbService.getDistinctPartOfSpeech());
      setFindType('');
      setReplaceType('');
      refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
    } else {
      alert(`No entries found with type "${findType}"`);
    }
  }, [findType, replaceType, selectedLetter, searchQuery, currentPage, pageSize, refreshEntries]);

  const handleCheckMissingPages = useCallback(() => {
    const missing = dbService.getMissingPages('fuerst_lex_', '.jpg', 44, 1558);
    const existingPages = dbService.getDistinctSourcePages();
    setMissingPages(missing);
    setScannedPagesCount(existingPages.length);
    setSelectedMissingPages(new Set());
    setShowMissingPages(true);
  }, []);

  const toggleMissingPageSelection = useCallback((pageNum: number) => {
    setSelectedMissingPages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pageNum)) {
        newSet.delete(pageNum);
      } else {
        newSet.add(pageNum);
      }
      return newSet;
    });
  }, []);

  const selectAllMissingPages = useCallback(() => {
    setSelectedMissingPages(new Set(missingPages));
  }, [missingPages]);

  const clearMissingPageSelection = useCallback(() => {
    setSelectedMissingPages(new Set());
  }, []);

  const handleScanSelectedMissingPages = useCallback(async () => {
    if (selectedMissingPages.size === 0) return;
    
    // Convert selected page numbers to File objects by fetching from public folder
    const selectedNums = [...selectedMissingPages].sort((a, b) => a - b);
    const files: File[] = [];
    
    for (const pageNum of selectedNums) {
      const filename = `fuerst_lex_${String(pageNum).padStart(4, '0')}.jpg`;
      try {
        const response = await fetch(`/fuerst_lex/${filename}`);
        if (response.ok) {
          const blob = await response.blob();
          const file = new File([blob], filename, { type: 'image/jpeg' });
          files.push(file);
        } else {
          console.warn(`Could not fetch ${filename}: ${response.status}`);
        }
      } catch (e) {
        console.warn(`Error fetching ${filename}:`, e);
      }
    }
    
    if (files.length === 0) {
      alert('Could not load any of the selected images. Make sure they exist in public/fuerst_lex/');
      return;
    }
    
    // Close the modal and trigger scanning
    setShowMissingPages(false);
    processFiles(files, missingPageInstructions);
  }, [selectedMissingPages, processFiles, missingPageInstructions]);


  const handleOpenDeleteByPage = useCallback(() => {
    const pages = dbService.getDistinctSourcePages();
    setSourcePages(pages);
    setSelectedDeletePages(new Set());
    setShowDeleteByPage(true);
  }, []);

  const toggleDeletePageSelection = useCallback((page: string) => {
    setSelectedDeletePages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(page)) {
        newSet.delete(page);
      } else {
        newSet.add(page);
      }
      return newSet;
    });
  }, []);

  const handleDeleteSelectedPages = useCallback(() => {
    if (selectedDeletePages.size === 0) return;
    
    const count = selectedDeletePages.size;
    if (!window.confirm(`Are you sure you want to delete all entries from ${count} page(s)?\n\nThis cannot be undone.`)) {
      return;
    }
    
    let totalDeleted = 0;
    for (const page of selectedDeletePages) {
      totalDeleted += dbService.deleteEntriesBySourcePage(page);
    }
    
    alert(`Deleted ${totalDeleted} entries from ${count} page(s).`);
    
    // Refresh the list and close modal
    setSourcePages(dbService.getDistinctSourcePages());
    setSelectedDeletePages(new Set());
    refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
  }, [selectedDeletePages, selectedLetter, searchQuery, currentPage, pageSize, refreshEntries]);

  // AI Validation handlers
  const handleValidateEntries = useCallback(async () => {
    if (dbEntries.length === 0) return;

    setIsValidating(true);
    setValidationProgress(0);
    try {
      // Process in batches of 25
      const batchSize = 25;
      const results = new Map<string, EntryValidationResult>();
      
      for (let i = 0; i < dbEntries.length; i += batchSize) {
        const batch = dbEntries.slice(i, i + batchSize);
        const batchResults = await validateEntries(
          batch.map(e => ({
            id: e.id,
            hebrewWord: e.hebrewWord,
            hebrewConsonantal: e.hebrewConsonantal || '',
            definition: e.definition,
            root: e.root,
            partOfSpeech: e.partOfSpeech
          })),
          selectedModel
        );
        
        for (const result of batchResults) {
          results.set(result.id, result);
          dbService.updateValidationStatus(result.id, result.isValid ? 'valid' : 'invalid', result.issue);
        }
        
        // Update progress and results after each batch
        setValidationProgress(Math.min(i + batchSize, dbEntries.length));
        setValidationResults(new Map(results));
      }
      
      // Auto-select invalid entries for rescan
      const invalidIds = new Set<string>();
      for (const [id, result] of results) {
        if (!result.isValid) {
          invalidIds.add(id);
        }
      }
      setSelectedForRescan(invalidIds);
      
    } catch (error: any) {
      console.error('Validation error:', error);
      alert('Error validating entries: ' + (error?.message || 'Unknown error'));
    } finally {
      setIsValidating(false);
    }
  }, [dbEntries, selectedModel]);

  const toggleRescanSelection = useCallback((id: string) => {
    setSelectedForRescan(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const handleMarkForRescan = useCallback(() => {
    if (selectedForRescan.size === 0) return;
    
    const count = dbService.markForRescan(Array.from(selectedForRescan));
    alert(`Marked ${count} entries for rescan.`);
    // Clear selection after marking for rescan
    setSelectedForRescan(new Set());
  }, [selectedForRescan]);

  if (dbError) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-red-600 p-4">
        <div className="text-center max-w-md">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto mb-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <h2 className="text-xl font-bold mb-2">Error Loading Database</h2>
          <p>{dbError}</p>
        </div>
              {/* Invalid Pages Button (quick access) */}
              <div className="mb-2">
                <button
                  onClick={() => { refreshInvalidPages(); setShowInvalidPages(true); }}
                  className="text-xs text-rose-600 hover:underline"
                >
                  View invalid pages ({sweepInvalidCount})
                </button>
              </div>
      </div>
    );
  }

  if (!isDbReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p>Initializing Database...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">

      {/* Import progress modal */}
      {(batchImporting || (batchImportTotal && batchImportTotal > 0 && batchImportProcessed < batchImportTotal)) && (
        <div className="fixed inset-0 z-60 flex items-center justify-center pointer-events-auto">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white dark:bg-slate-800 rounded-lg p-4 w-11/12 max-w-sm shadow-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Importing batch results</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{batchImportMessage ?? 'Processing...'}</p>

            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
              {batchImportTotal && batchImportTotal > 0 ? (
                <div
                  className="h-3 bg-indigo-600 transition-all"
                  style={{ width: `${Math.round((batchImportProcessed / batchImportTotal) * 100)}%` }}
                />
              ) : (
                <div className="h-3 rounded-full overflow-hidden">
                  <div className="indeterminate-gradient h-full w-full" />
                </div>
              )}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-right">
              {batchImportTotal && batchImportTotal > 0 ? `${batchImportProcessed}/${batchImportTotal} (${Math.round((batchImportProcessed / batchImportTotal) * 100)}%)` : 'Working…'}
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 py-2 px-4 flex items-center justify-between flex-shrink-0 z-50 relative">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 text-white p-1.5 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Hebrew Lexicon AI Reader and Parser</h1>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <span>SQLite</span>
              {renderLoadSourceBadge(dbLoadSource)}
              {serverConnected && (
                <span className="text-[9px] font-semibold tracking-wide uppercase rounded-full px-1.5 py-0.5 flex items-center gap-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                  <span className="w-1 h-1 rounded-full bg-green-500"></span>
                  Server
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Dark Mode Toggle */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M3 12h2.25m.386-6.364l1.591-1.591M16.5 12.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
          </button>

          {/* Model Selector */}
          <select
            id="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as GeminiModelId)}
            disabled={isProcessing}
            className="text-[11px] border border-slate-200 dark:border-slate-600 rounded px-1.5 py-1 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>

          {/* Database Actions */}
          <div className="flex items-center gap-2">
            {(!hasDatabase || initialSetupRequired) && (
              <button
                onClick={handleCreateNewDatabaseNow}
                disabled={isResettingDb || isProcessing}
                className="text-[10px] font-semibold uppercase tracking-wide rounded px-2 py-1 border border-slate-200 dark:border-slate-600 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-60"
                title="Create a new empty database (only when none exists, or confirm to overwrite)"
              >
                {isResettingDb ? 'Creating...' : 'Create New DB'}
              </button>
            )}
            <button
              onClick={handleCreateNewDatabase}
              disabled={isProcessing}
              className="text-[10px] font-semibold uppercase tracking-wide rounded px-2 py-1 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 disabled:opacity-60"
              title="Download a backup of the current database"
            >
              Backup DB
            </button>
          </div>

          <button
            onClick={handleReprocessStrongs}
            disabled={isProcessing}
            className="text-[10px] font-semibold uppercase tracking-wide rounded px-2 py-1 border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-60"
            title="Re-check all entries against Strong's database"
          >
            Update Strong's
          </button>

          <button
            onClick={handleRebuildIds}
            disabled={isProcessing}
            className="text-[10px] font-semibold uppercase tracking-wide rounded px-2 py-1 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-60"
            title="Reassign all entry IDs (F1, F2, ...) sorted alphabetically"
          >
            Update IDs
          </button>

          {/* Cleanup Dropdown */}
          <div className="relative group z-[100]">
            <button
              disabled={isProcessing}
              className="text-[10px] font-semibold uppercase tracking-wide rounded px-2 py-1 border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 disabled:opacity-60 flex items-center gap-1"
            >
              Cleanup
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] min-w-[160px]">
              <button
                onClick={handleMoveRomanNumerals}
                disabled={isProcessing}
                className="w-full text-left text-[11px] px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60 border-b border-slate-100 dark:border-slate-700"
              >
                Clean Word Numerals
              </button>
              <button
                onClick={handleCleanRootNumerals}
                disabled={isProcessing}
                className="w-full text-left text-[11px] px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60 border-b border-slate-100 dark:border-slate-700"
              >
                Clean Hebrew Roots
              </button>
              <button
                onClick={handleOpenTypeReplacer}
                disabled={isProcessing}
                className="w-full text-left text-[11px] px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60 border-b border-slate-100 dark:border-slate-700"
              >
                Replace Types
              </button>
            </div>
          </div>

          {/* Pages Dropdown */}
          <div className="relative group z-[100]">
            <button
              className="text-[10px] font-semibold uppercase tracking-wide rounded px-2 py-1 border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 flex items-center gap-1"
            >
              Pages
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[100] min-w-[140px]">
              <button
                onClick={handleCheckMissingPages}
                className="w-full text-left text-[11px] px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700"
              >
                Missing Pages
              </button>
              <button
                onClick={handleOpenDeleteByPage}
                className="w-full text-left text-[11px] px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-red-600 dark:text-red-400"
              >
                Delete By Page
              </button>
            </div>
          </div>
        </div>
      </header>
      {initialSetupRequired && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 px-4 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-3xl">
            No existing lexicon.sqlite was detected. Drop a prebuilt file into public/lexicon.sqlite or
            click Create New DB to generate a fresh working database before importing scans.
          </p>
          <button
            onClick={handleCreateNewDatabaseNow}
            disabled={isResettingDb || isProcessing}
            className="text-[11px] font-semibold uppercase tracking-wide rounded px-2 py-1 border border-amber-400 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60 disabled:opacity-60"
          >
            {isResettingDb ? 'Creating...' : 'Create New DB'}
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex min-h-0">
        {/* Left Sidebar: Upload & Status */}
        <div className="w-80 flex flex-col flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 z-10 overflow-hidden">
          <div className="flex-shrink-0 p-4 pb-2">
            <FileUploader 
              onFilesSelected={handleFilesSelected} 
              isProcessing={isProcessing} 
            />

            {/* Prompt Editor Toggle */}
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => setShowPromptEditor(!showPromptEditor)}
                className="text-[10px] text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 underline"
              >
                {showPromptEditor ? 'Hide Prompt' : 'Edit Extraction Prompt'}
              </button>
            </div>
            
            {/* Prompt Editor */}
            {showPromptEditor && (
              <div className="mt-2 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
                <textarea
                  value={extractionPrompt}
                  onChange={(e) => setExtractionPrompt(e.target.value)}
                  className="w-full h-32 text-[10px] p-2 border border-slate-200 dark:border-slate-700 rounded resize-y font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                  placeholder="Enter custom extraction prompt..."
                />
                <div className="mt-1 flex justify-end">
                  <button
                    onClick={() => setExtractionPrompt(DEFAULT_EXTRACTION_PROMPT)}
                    className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    Reset to Default
                  </button>
                </div>
              </div>
            )}

            {/* Pending Files UI */}
            {pendingFiles.length > 0 && (
              <div className="mt-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-300">
                    {pendingFiles.length} files selected
                  </span>
                  <button 
                    onClick={() => setPendingFiles([])}
                    className="text-[10px] text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => processFiles(pendingFiles)}
                    disabled={isProcessing}
                    className="w-full py-1.5 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Process Now (Live)
                  </button>
                  <button
                    onClick={handleExportExtractionBatch}
                    className="w-full py-1.5 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded hover:bg-indigo-50 dark:hover:bg-slate-700"
                  >
                    Export Batch JSONL
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 p-4 pt-2 flex flex-col gap-3">
            <div className="flex-1 min-h-0">
              <ProcessingQueue 
                pages={pages} 
                isProcessing={isProcessing}
                onStopScanning={handleStopScanning}
              />
            </div>
            <div className="flex-shrink-0">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">AI Sweep </h3> <font style={{fontSize: 10}} className="dark:text-slate-400">(Use numbers in page files)</font>
                  {sweepRunning && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                      {sweepMode === 'validate' ? 'Validating' : 'Correcting'}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setShowRebuildIdsModal(true)}
                    disabled={isProcessing}
                    className="text-[11px] px-2 py-1 rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600"
                  >
                    Update IDs…
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-slate-500 dark:text-slate-400">Start page</span>
                    <input
                      type="text"
                      value={sweepStartPageInput}
                      placeholder="e.g. 0041"
                      onChange={(e) => {
                        const raw = e.target.value;
                        setSweepStartPageInput(raw);
                        const parsed = parsePageInputValue(raw);
                        if (parsed !== undefined) {
                          setSweepStartPage(parsed);
                        }
                      }}
                      className="border border-slate-200 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-slate-500">End page</span>
                    <input
                      type="text"
                      value={sweepEndPageInput}
                      placeholder="e.g. 0050"
                      onChange={(e) => {
                        const raw = e.target.value;
                        setSweepEndPageInput(raw);
                        const parsed = parsePageInputValue(raw);
                        if (parsed !== undefined) {
                          setSweepEndPage(parsed);
                        }
                      }}
                      className="border border-slate-200 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-slate-500 dark:text-slate-400">Batch size</span>
                    <input
                      type="number"
                      min={5}
                      max={200}
                      value={validatorBatchSize}
                      onChange={(e) => setValidatorBatchSize(parseInt(e.target.value) || 25)}
                      className="border border-slate-200 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-slate-500 dark:text-slate-400">Max requests</span>
                    <input
                      type="number"
                      min={1}
                      value={maxRequests ?? ''}
                      placeholder="No limit"
                      onChange={(e) => {
                        const v = e.target.value;
                        setMaxRequests(v === '' ? null : parseInt(v) || null);
                      }}
                      className="border border-slate-200 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={skipValidEntries}
                    onChange={(e) => setSkipValidEntries(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-slate-600">Skip entries already marked Valid</span>
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={runValidationSweep}
                    disabled={sweepRunning}
                    className="flex-1 px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white disabled:opacity-50"
                  >
                    Run Validation
                  </button>
                  <button
                    onClick={runCorrectionSweep}
                    disabled={sweepRunning}
                    className="flex-1 px-3 py-2 text-sm font-semibold rounded-lg bg-amber-600 text-white disabled:opacity-50"
                  >
                    Run Corrections
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Pages: {sweepProcessedPages}/{sweepTotalPages}</span>
                  <span>
                    Invalid pages: <button
                      onClick={() => { refreshInvalidPages(); setShowInvalidPages(true); }}
                      className="text-rose-600 dark:text-rose-400 hover:underline"
                    >{sweepInvalidCount}</button>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                  <span>Requests used: {requestsUsed}{maxRequests ? ` / ${maxRequests}` : ''}</span>
                  <button
                    onClick={handleStopSweep}
                    disabled={!sweepRunning}
                    className="text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                  >
                    Stop
                  </button>
                </div>
                <div className="mt-3 border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2 text-xs">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Batch Processing</h4>
                  <button
                    onClick={handleExportValidationBatch}
                    disabled={sweepRunning}
                    className="w-full text-left px-3 py-2 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    1. Export current sweep scope as validation JSONL
                  </button>
                  <button
                    onClick={handleExportCorrectionBatch}
                    disabled={sweepRunning}
                    className="w-full text-left px-3 py-2 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    2. Export current sweep scope corrections as JSONL (exports only invalid entries)
                  </button>
                  <div className="flex items-center gap-2">
                    <label htmlFor="batch-import-type" className="text-[11px] text-slate-500 dark:text-slate-400">
                      Import results as
                    </label>
                    <select
                      id="batch-import-type"
                      value={batchImportType}
                      onChange={(e) => setBatchImportType(e.target.value as 'validation' | 'correction' | 'extraction')}
                      className="text-[11px] border border-slate-200 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="validation">Validation</option>
                      <option value="correction">Correction</option>
                      <option value="extraction">Extraction</option>
                    </select>
                    <button
                      onClick={() => batchImportInputRef.current?.click()}
                      className="px-3 py-1 text-[11px] border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      disabled={batchImporting}
                    >
                      {batchImporting ? 'Importing…' : 'Import batch results'}
                    </button>
                    <input
                      ref={batchImportInputRef}
                      type="file"
                      accept=".json,.jsonl,.txt"
                      onChange={handleBatchFileUpload}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Content: Alphabet & Results */}
        <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-slate-900">
          {consonantalFilter ? (
            /* Consonantal filter view - simplified header with back button */
            <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center gap-4">
              <a
                href={window.location.pathname}
                className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Back to Lexicon
              </a>
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 dark:text-slate-400">Consonantal form:</span>
                <span className="hebrew-text text-lg font-bold text-slate-900 dark:text-white" dir="rtl">{consonantalFilter}</span>
                <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">{dbEntries.length} entries</span>
              </div>
            </div>
          ) : (
            <AlphabetFilter 
              selectedLetter={selectedLetter} 
              onLetterSelect={handleLetterSelect}
              onSearch={handleSearch}
              onPageFilter={setPageFilter}
            />
          )}
          
          <div className="flex-1 overflow-hidden">
            <ResultsDisplay 
              entries={dbEntries} 
              onDeleteEntries={handleDeleteEntries}
              onUpdateEntry={handleUpdateEntry}
              onSetEntryStatus={handleSetEntryStatus}
              onExportAll={handleExportAll}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={(s) => { setSortBy(s); setCurrentPage(1); refreshEntries(selectedLetter, searchQuery, 1, pageSize); }}
              onSortDirChange={(d) => { setSortDir(d); setCurrentPage(1); refreshEntries(selectedLetter, searchQuery, 1, pageSize); }}
              filterTitle={consonantalFilter 
                ? `Entries with consonants: ${consonantalFilter}` 
                : searchQuery
                  ? `Search results for: ${searchQuery}`
                  : selectedLetter 
                    ? `Entries starting with ${selectedLetter}` 
                    : 'All Entries'}
              totalCount={totalCount}
              currentPage={currentPage}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              validationResults={validationResults}
              onValidateEntries={validateEntriesFor}
              onMarkForRescan={(ids) => {
                const count = dbService.markForRescan(ids);
                alert(`Marked ${count} entries for rescan.`);
                // Refresh display
                refreshEntries(selectedLetter, searchQuery, currentPage, pageSize);
              }}
              isValidating={isValidating}
              validationProgress={validationProgress}
              validatorBatchSize={validatorBatchSize}
              setValidatorBatchSize={setValidatorBatchSize}
            />
          </div>
        </div>
      </main>

      {/* Find/Replace Types Modal */}
      {showTypeReplacer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Find & Replace Types</h2>
              <button 
                onClick={() => setShowTypeReplacer(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Current types list */}
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Current Types ({distinctTypes.length})
                </label>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                  {distinctTypes.length === 0 ? (
                    <p className="text-sm text-slate-400">No types found</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {distinctTypes.map((type) => (
                        <button
                          key={type}
                          onClick={() => setFindType(type)}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                            findType === type 
                              ? 'bg-teal-100 border-teal-300 text-teal-800' 
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Find input */}
              <div>
                <label htmlFor="find-type" className="text-sm font-medium text-slate-700 mb-1 block">
                  Find (exact match)
                </label>
                <input
                  id="find-type"
                  type="text"
                  value={findType}
                  onChange={(e) => setFindType(e.target.value)}
                  placeholder="e.g., n.m."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Replace input */}
              <div>
                <label htmlFor="replace-type" className="text-sm font-medium text-slate-700 mb-1 block">
                  Replace with
                </label>
                <input
                  id="replace-type"
                  type="text"
                  value={replaceType}
                  onChange={(e) => setReplaceType(e.target.value)}
                  placeholder="e.g., noun (m.)"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setShowTypeReplacer(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFindReplaceType}
                disabled={!findType.trim() || !replaceType.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Replace All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Missing Pages Modal */}
      {showMissingPages && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Missing Pages Check</h2>
              <button 
                onClick={() => setShowMissingPages(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-800">{scannedPagesCount}</div>
                  <div className="text-xs text-slate-500">Pages Scanned</div>
                </div>
                <div className="bg-rose-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-rose-600">{missingPages.length}</div>
                  <div className="text-xs text-rose-500">Missing Pages</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-600">
                    {Math.round((scannedPagesCount / (1558 - 44 + 1)) * 100)}%
                  </div>
                  <div className="text-xs text-emerald-500">Complete</div>
                </div>
              </div>

              {/* Range info */}
              <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
                Checking range: <span className="font-mono font-medium">fuerst_lex_0044.jpg</span> to <span className="font-mono font-medium">fuerst_lex_1558.jpg</span>
                <span className="text-slate-400 ml-2">({1558 - 44 + 1} total pages)</span>
              </div>

              {/* Additional instructions for AI */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Special instructions for AI (optional)</label>
                <textarea
                  value={missingPageInstructions}
                  onChange={(e) => setMissingPageInstructions(e.target.value)}
                  placeholder="e.g., Prefer spelling on the page; prefer Holam over Holam-Haser in ambiguous cases; do not change Strong's numbers."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  rows={3}
                />
              </div>

              {/* Missing pages list */}
              {missingPages.length === 0 ? (
                <div className="text-center py-8 text-emerald-600">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto mb-2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-medium">All pages are scanned!</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">
                      Missing Page Numbers ({missingPages.length})
                      {selectedMissingPages.size > 0 && (
                        <span className="ml-2 text-indigo-600">
                          — {selectedMissingPages.size} selected
                        </span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllMissingPages}
                        className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                      >
                        Select All
                      </button>
                      <button
                        onClick={clearMissingPageSelection}
                        className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                    <div className="flex flex-wrap gap-1.5">
                      {missingPages.map((pageNum) => (
                        <button
                          key={pageNum}
                          onClick={() => toggleMissingPageSelection(pageNum)}
                          className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                            selectedMissingPages.has(pageNum)
                              ? 'bg-indigo-500 text-white'
                              : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                          }`}
                          title={`fuerst_lex_${String(pageNum).padStart(4, '0')}.jpg`}
                        >
                          {String(pageNum).padStart(4, '0')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between p-4 border-t border-slate-200">
              <button
                onClick={() => {
                  const filenames = missingPages.map(n => `fuerst_lex_${String(n).padStart(4, '0')}.jpg`).join('\n');
                  navigator.clipboard.writeText(filenames);
                  alert('Copied missing filenames to clipboard!');
                }}
                className="flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
                Copy All Filenames
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowMissingPages(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleScanSelectedMissingPages}
                  disabled={selectedMissingPages.size === 0 || isProcessing}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  Scan Selected ({selectedMissingPages.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invalid Pages Modal */}
      {showInvalidPages && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Invalid Pages</h2>
              <div className="flex items-center gap-2">
                <div className="text-sm text-slate-500">Total: {invalidPages.length}</div>
                <button
                  onClick={() => { setShowInvalidPages(false); }}
                  className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {invalidPages.length === 0 ? (
                <div className="text-center py-8 text-emerald-600">
                  <p className="font-medium">No invalid pages found.</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Invalid Pages ({invalidPages.length})</label>
                    <div className="flex gap-2">
                      <button onClick={selectAllInvalidPages} className="text-xs text-indigo-600 hover:underline">Select All</button>
                      <button onClick={clearInvalidSelection} className="text-xs text-slate-500 hover:underline">Clear</button>
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                    <div className="flex flex-col gap-1">
                      {invalidPages.map((pageId) => {
                        const count = dbService.getInvalidEntriesBySourcePage(pageId).length;
                        return (
                          <div key={pageId} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-slate-100">
                            <div className="flex items-center gap-3">
                              <input type="checkbox" checked={selectedInvalidPages.has(pageId)} onChange={() => toggleInvalidPageSelection(pageId)} />
                              <div className="font-mono">{pageId}</div>
                            </div>
                            <div className="text-slate-500">{count} invalid</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between p-4 border-t border-slate-200">
              <div className="flex gap-2">
                <button onClick={copyInvalidFilenames} className="flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors">Copy IDs</button>
                <button onClick={exportInvalidFilenames} className="flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors">Export</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowInvalidPages(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Close</button>
                <button
                  onClick={() => runCorrectionsOnPages(Array.from(selectedInvalidPages))}
                  disabled={selectedInvalidPages.size === 0 || sweepRunning}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
                >
                  Run Corrections ({selectedInvalidPages.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rebuild IDs Modal */}
      {showRebuildIdsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Update Entry IDs</h2>
              <button onClick={() => setShowRebuildIdsModal(false)} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col">
                  <span className="text-sm text-slate-600">Sort by</span>
                  <select value={idSortBy} onChange={(e) => setIdSortBy(e.target.value as any)} className="border border-slate-200 rounded px-2 py-1 bg-white">
                    <option value="consonantal">Hebrew (consonantal)</option>
                    <option value="word">Hebrew (full word)</option>
                    <option value="source">Source page</option>
                    <option value="date">Date added</option>
                  </select>
                </label>
                <label className="flex flex-col">
                  <span className="text-sm text-slate-600">Direction</span>
                  <select value={idSortDir} onChange={(e) => setIdSortDir(e.target.value as any)} className="border border-slate-200 rounded px-2 py-1 bg-white">
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </label>
                <label className="flex flex-col">
                  <span className="text-sm text-slate-600">ID prefix</span>
                  <input value={idPrefix} onChange={(e) => setIdPrefix(e.target.value)} className="border border-slate-200 rounded px-2 py-1" />
                </label>
                <label className="flex flex-col">
                  <span className="text-sm text-slate-600">Start at</span>
                  <input type="number" min={1} value={idStartAt} onChange={(e) => setIdStartAt(Number(e.target.value) || 1)} className="border border-slate-200 rounded px-2 py-1" />
                </label>
                <label className="flex flex-col col-span-2">
                  <span className="text-sm text-slate-600">Zero pad width (optional)</span>
                  <input type="number" min={0} value={idPadWidth} onChange={(e) => setIdPadWidth(Math.max(0, Number(e.target.value) || 0))} className="border border-slate-200 rounded px-2 py-1" />
                </label>
              </div>

              <div className="bg-slate-50 rounded-lg p-3">
                <div className="text-sm text-slate-600">Preview</div>
                <div className="mt-2 font-mono text-sm">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const n = idStartAt + i;
                    const numStr = idPadWidth > 0 ? String(n).padStart(idPadWidth, '0') : String(n);
                    return <div key={i}>{`${idPrefix}${numStr}`}</div>;
                  })}
                </div>
                <div className="mt-2 text-xs text-slate-500">Note: Sorting will determine which entry receives which ID. This operation is destructive (IDs will be replaced).</div>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-slate-200">
              <button onClick={() => setShowRebuildIdsModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleConfirmRebuildIds} disabled={isProcessing} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">Apply and Rebuild</button>
            </div>
          </div>
        </div>
      )}

      {/* Backup DB Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Backup Database</h2>
              <button onClick={() => setShowBackupModal(false)} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              <label className="block text-sm text-slate-600">Filename</label>
              <input className="w-full border border-slate-200 rounded px-2 py-1" value={backupFilename} onChange={(e) => setBackupFilename(e.target.value)} />
              <div className="text-xs text-slate-500">Choose a filename for the backup. The database will be downloaded to your device.</div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-slate-200">
              <button onClick={() => setShowBackupModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleConfirmBackup} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">Download Backup</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete By Page Modal */}
      {showDeleteByPage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800">Delete Entries By Page</h2>
              <button 
                onClick={() => setShowDeleteByPage(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Warning */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <strong>Warning:</strong> Deleting entries cannot be undone. Select pages carefully.
              </div>

              {/* Selection controls */}
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Source Pages ({sourcePages.length})
                  {selectedDeletePages.size > 0 && (
                    <span className="ml-2 text-red-600">
                      — {selectedDeletePages.size} selected
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedDeletePages(new Set(sourcePages))}
                    className="text-xs text-red-600 hover:text-red-800 hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedDeletePages(new Set())}
                    className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Pages list */}
              {sourcePages.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p>No pages found in database.</p>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {sourcePages.map((page) => (
                      <button
                        key={page}
                        onClick={() => toggleDeletePageSelection(page)}
                        className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                          selectedDeletePages.has(page)
                            ? 'bg-red-500 text-white'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        title={page}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setShowDeleteByPage(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSelectedPages}
                disabled={selectedDeletePages.size === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Delete Selected ({selectedDeletePages.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;