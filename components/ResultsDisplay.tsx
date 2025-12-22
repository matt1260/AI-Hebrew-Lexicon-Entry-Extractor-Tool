import React, { useState, useMemo } from 'react';
import { LexiconEntry, getSourceImageUrl } from '../types';
import { EntryValidationResult } from '../services/geminiService';

type SortOption = 'default' | 'id' | 'hebrew' | 'consonantal' | 'source';

interface ResultsDisplayProps {
  entries: LexiconEntry[];
  onDeleteEntries: (ids: string[]) => void;
  onUpdateEntry?: (id: string, updates: Partial<LexiconEntry>) => Promise<boolean>;
  filterTitle?: string;
  // Pagination props
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  validationResults?: Map<string, EntryValidationResult>;
  onValidateEntries?: (entries: LexiconEntry[], batchSize: number) => Promise<void>;
  onMarkForRescan?: (ids: string[]) => void;
  onSetEntryStatus?: (id: string, status: 'valid' | 'invalid' | 'unchecked', issue?: string | null) => Promise<void> | void;
  onSortChange?: (sort: SortOption) => void;
  sortBy?: SortOption;
  onSortDirChange?: (dir: 'asc' | 'desc') => void;
  sortDir?: 'asc' | 'desc';
  isValidating?: boolean;
  validationProgress?: number;
  validatorBatchSize?: number;
  setValidatorBatchSize?: (n: number) => void;
  onExportAll?: () => void;
}

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ 
  entries, 
  onDeleteEntries,
  onUpdateEntry,
  filterTitle,
  totalCount,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  validationResults,
  onValidateEntries,
  onMarkForRescan,
  onSetEntryStatus,
  onSortChange,
  onSortDirChange,
  sortBy,
  sortDir = 'asc',
  isValidating,
  validationProgress,
  validatorBatchSize = 25,
  setValidatorBatchSize,
  onExportAll,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Sort is controlled by parent when provided
  // const [sortBy, setSortBy] = useState<SortOption>('default');
  
  // Edit modal state
  const [editingEntry, setEditingEntry] = useState<LexiconEntry | null>(null);
  const [editForm, setEditForm] = useState<Partial<LexiconEntry>>({});
  const [isSaving, setIsSaving] = useState(false);
  // Hebrew keyboard helper
  const [showHebrewKeyboard, setShowHebrewKeyboard] = useState(false);
  const [activeHebrewTarget, setActiveHebrewTarget] = useState<'hebrewWord' | 'hebrewConsonantal' | null>(null);
  const hebrewWordRef = React.useRef<HTMLInputElement | null>(null);
  const hebrewConsonantalRef = React.useRef<HTMLInputElement | null>(null);

  const HEBREW_LETTERS = ['א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ל','מ','נ','ס','ע','פ','צ','ק','ר','ש','ת','ן','ם','ך','ף','ץ','’',','];
  // Common niqqud (vowel points) and related diacritics
  const HEBREW_VOWELS = [
    '\u05B0', // sheva
    '\u05B1', // hataf segol
    '\u05B2', // hataf patah
    '\u05B3', // hataf qamats
    '\u05B4', // hiriq
    '\u05B5', // tsere
    '\u05B6', // segol
    '\u05B7', // patah
    '\u05B8', // qamats
    '\u05B9', // holam
    '\u05BB', // qubuts
    '\u05BC', // dagesh/raphe
    '\u05BD', // meteg
    '\u05C1', // shin dot
    '\u05C2', // sin dot
  ];

  const insertHebrewAtCursor = (ref: HTMLInputElement | null, field: 'hebrewWord' | 'hebrewConsonantal', char: string) => {
    if (!ref) return;
    const el = ref;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.substring(0, start);
    const after = el.value.substring(end);
    const newVal = before + char + after;
    // Update local form state
    setEditForm(prev => ({ ...prev, [field]: newVal }));
    // Update DOM and restore caret
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + char.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  // Sort entries based on selected option (parent-controlled). We still provide a small
  // client-side fallback so the current page is ordered sensibly while the DB returns
  // globally-sorted results.
  const sortedEntries = useMemo(() => {
    const s = (sortBy || 'default') as SortOption;
    const dir = sortDir === 'desc' ? -1 : 1;
    if (s === 'default') return entries;
    return [...entries].sort((a, b) => {
      switch (s) {
        case 'id': {
          const aNum = parseInt(a.id.replace(/^F/, ''), 10) || 0;
          const bNum = parseInt(b.id.replace(/^F/, ''), 10) || 0;
          return (aNum - bNum) * dir;
        }
        case 'hebrew':
          return (a.hebrewWord || '').localeCompare(b.hebrewWord || '', 'he') * dir;
        case 'consonantal':
          return (a.hebrewConsonantal || '').localeCompare(b.hebrewConsonantal || '', 'he') * dir;
        case 'source':
          return (a.sourcePage || '').localeCompare(b.sourcePage || '') * dir;
        default:
          return 0;
      }
    });
  }, [entries, sortBy, sortDir]);

  const getConsonantalUrl = (consonantal: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('consonantal', consonantal);
    return url.toString();
  };

  // Handle "Select All" toggle
  const handleSelectAll = () => {
    if (selectedIds.size === entries.length && entries.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  };

  // Handle individual row toggle
  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = () => {
    if (window.confirm(`Are you sure you want to delete ${selectedIds.size} entries?`)) {
      onDeleteEntries(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  };

  const downloadJson = () => {
    // If there's a selection, only export selected
    if (selectedIds.size > 0) {
      const entriesToExport = entries.filter(e => selectedIds.has(e.id));
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(entriesToExport, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "lexicon_selection.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      return;
    }

    // Otherwise, if onExportAll is provided, use it for full DB export
    if (onExportAll) {
      onExportAll();
    } else {
      // Fallback to current view if onExportAll not provided
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(entries, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "lexicon_data.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    }
  };

  // Edit handlers
  const handleEditClick = (entry: LexiconEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEntry(entry);
    setEditForm({
      hebrewWord: entry.hebrewWord,
      hebrewConsonantal: entry.hebrewConsonantal || '',
      transliteration: entry.transliteration || '',
      partOfSpeech: entry.partOfSpeech || '',
      definition: entry.definition || '',
      root: entry.root || '',
      isRoot: entry.isRoot || false,
      strongsNumbers: entry.strongsNumbers || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEntry || !onUpdateEntry) return;
    
    setIsSaving(true);
    try {
      const success = await onUpdateEntry(editingEntry.id, editForm);
      if (success) {
        setEditingEntry(null);
        setEditForm({});
      } else {
        alert('Failed to save changes');
      }
    } catch (error) {
      console.error('Error saving entry:', error);
      alert('Error saving changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingEntry(null);
    setEditForm({});
  };

  const handleValidateEntries = async () => {
    if (!onValidateEntries || entries.length === 0) return;

    // If any rows are selected, validate those, otherwise validate visible entries
    const targets = selectedIds.size > 0 ? entries.filter(e => selectedIds.has(e.id)) : entries;
    await onValidateEntries(targets, validatorBatchSize || 25);
  };

  const handleMarkValid = async (id: string) => {
    if (!onSetEntryStatus) return;
    try {
      await onSetEntryStatus(id, 'valid', null);
    } catch (e) {
      console.error('Failed to mark entry valid', e);
      alert('Failed to mark entry as valid');
    }
  };

  if (entries.length === 0 && totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-white rounded-xl border border-slate-200 m-6">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 006 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        <p>No entries found. Upload an image or select a different letter.</p>
      </div>
    );
  }

  const isAllSelected = entries.length > 0 && selectedIds.size === entries.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < entries.length;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      <div className="flex justify-between items-center py-4 px-6 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
          {filterTitle || 'Lexicon Entries'}
          <span className="text-sm font-normal text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
            {totalCount}
          </span>
          {selectedIds.size > 0 && (
            <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full ml-1">
              {selectedIds.size} selected
            </span>
          )}
        </h2>
        
        <div className="flex items-center gap-2">
          {/* Sort dropdown */}
          <div className="flex items-center gap-2">
            <label htmlFor="sort-select" className="text-xs text-slate-500 dark:text-slate-400 font-medium">Sort:</label>
            <select
              id="sort-select"
              value={sortBy || 'default'}
              onChange={(e) => onSortChange && onSortChange(e.target.value as SortOption)}
              className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="default">Default</option>
              <option value="id">ID (F1, F2...)</option>
              <option value="hebrew">Hebrew Word</option>
              <option value="consonantal">Consonantal</option>
              <option value="source">Source</option>
            </select>
            <button
              onClick={() => onSortDirChange && onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
              title={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
              className="ml-2 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
            >
              {sortDir === 'asc' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12l4-4 4 4" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 12l-4 4-4-4" />
                </svg>
              )}
            </button>
          </div>

          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-sm font-medium border border-red-200 dark:border-red-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete
            </button>
          )}
          
          <button
            onClick={downloadJson}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-700 dark:hover:bg-white transition-colors text-sm font-medium"
            title={selectedIds.size > 0 ? "Export selected entries" : "Export entire database as JSON"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 12L12 16.5m0 0L16.5 12M12 3v13.5" />
            </svg>
            {selectedIds.size > 0 ? `Export (${selectedIds.size})` : "Export JSON"}
          </button>


        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 pt-2">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 w-12 text-center">
                  <input 
                    type="checkbox" 
                    checked={isAllSelected}
                    ref={input => {
                      if (input) input.indeterminate = isIndeterminate;
                    }}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer bg-white dark:bg-slate-800"
                  />
                </th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-16">ID</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-1/6">Word</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-1/12">Type</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-1/3">Definition</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-1/6">Root/Notes</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-1/6">Source</th>
                <th className="text-center p-2 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-1/6">Status</th>
                <th className="p-4 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-400 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {sortedEntries.map((entry) => (
                <tr 
                  key={entry.id} 
                  className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${selectedIds.has(entry.id) ? 'bg-indigo-50/40 dark:bg-indigo-900/20' : ''}`}
                  onClick={() => toggleSelection(entry.id)}
                >
                  <td className="p-4 align-top text-center" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelection(entry.id)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 cursor-pointer mt-1 bg-white dark:bg-slate-800"
                    />
                  </td>
                  <td className="p-4 align-top">
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">{entry.id}</span>
                  </td>
                  <td className="p-4 align-top">
                    <div className="text-xl font-bold hebrew-text text-slate-900 dark:text-white" dir="rtl">{entry.hebrewWord}</div>
                    {entry.hebrewConsonantal && (
                      <a
                        href={getConsonantalUrl(entry.hebrewConsonantal)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline hebrew-text mt-1 inline-flex items-center gap-1"
                        dir="rtl"
                        title={`View all entries with consonants: ${entry.hebrewConsonantal} (opens in new tab)`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {entry.hebrewConsonantal}
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3 inline">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                      </a>
                    )}
                    {entry.transliteration && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">{entry.transliteration}</div>
                    )}
                  </td>
                  <td className="p-4 align-top">
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-medium">
                      {entry.partOfSpeech || 'N/A'}
                    </span>
                  </td>
                  <td className="p-4 align-top text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
                    {entry.definition}
                  </td>
                  <td className="p-4 align-top text-sm text-slate-500 dark:text-slate-400">
                    {entry.root && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">Root:</span>
                        <span className="hebrew-text font-medium text-slate-700 dark:text-slate-200" dir="rtl">{entry.root}</span>
                      </div>
                    )}
                    {entry.isRoot && (
                      <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 mt-1">
                        root=true
                      </div>
                    )}
                    {entry.strongsNumbers && (
                      <div className="text-[10px] uppercase tracking-wide text-indigo-700 dark:text-indigo-400 mt-1">
                        STRONGS: {entry.strongsNumbers}
                      </div>
                    )}
                  </td>
                  <td className="p-4 align-top text-sm">
                    {entry.sourcePage && (
                      <a 
                        href={getSourceImageUrl(entry)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                        <span className="truncate max-w-[120px] inline-block" title={entry.sourcePage}>
                          {entry.sourcePage}
                        </span>
                      </a>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    {entry.status === 'valid' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Valid</span>
                    ) : entry.status === 'invalid' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">Invalid</span>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">Unchecked</span>
                    )}
                    {entry.validationIssue && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">{entry.validationIssue}</div>
                    )}
                  </td>
                  <td className="p-4 align-top text-center">
                    <button
                      onClick={(e) => handleEditClick(entry, e)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors"
                      title="Edit entry"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    </button>
                    {entry.status !== 'valid' && onSetEntryStatus && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMarkValid(entry.id); }}
                        className="ml-1 p-1.5 text-emerald-600 dark:text-emerald-400 hover:text-white hover:bg-emerald-600 dark:hover:bg-emerald-500 rounded transition-colors"
                        title="Mark as Valid"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500 dark:text-slate-400">Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-sm text-slate-500 dark:text-slate-400 mr-2">
                {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
              </span>
              
              <button
                onClick={() => onPageChange(1)}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 dark:text-slate-400"
                title="First page"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                </svg>
              </button>
              
              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 dark:text-slate-400"
                title="Previous page"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>

              <span className="px-3 py-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 dark:text-slate-400"
                title="Next page"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
              
              <button
                onClick={() => onPageChange(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 dark:text-slate-400"
                title="Last page"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Entry Modal */}
      {editingEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col border border-transparent dark:border-slate-700">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Edit Entry</h2>
              <button 
                onClick={handleCancelEdit}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* ID (read-only) */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">ID</label>
                <div className="text-sm font-mono bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-400">
                  {editingEntry.id}
                </div>
              </div>

              {/* Hebrew Word */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Hebrew Word</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={hebrewWordRef}
                    type="text"
                    value={editForm.hebrewWord || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, hebrewWord: e.target.value }))}
                    onFocus={() => setActiveHebrewTarget('hebrewWord')}
                    className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xl hebrew-text text-right bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    dir="rtl"
                  />
                  <button
                    title="Toggle Hebrew keyboard"
                    onClick={() => { setShowHebrewKeyboard(s => !s); setActiveHebrewTarget('hebrewWord'); hebrewWordRef.current?.focus(); }}
                    className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    ✍️
                  </button>
                </div>
              </div>

              {/* Hebrew Consonantal */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Consonantal (without niqqud)</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={hebrewConsonantalRef}
                    type="text"
                    value={editForm.hebrewConsonantal || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, hebrewConsonantal: e.target.value }))}
                    onFocus={() => setActiveHebrewTarget('hebrewConsonantal')}
                    className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xl hebrew-text text-right bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    dir="rtl"
                  />
                  <button
                    title="Toggle Hebrew keyboard"
                    onClick={() => { setShowHebrewKeyboard(s => !s); setActiveHebrewTarget('hebrewConsonantal'); hebrewConsonantalRef.current?.focus(); }}
                    className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    ✍️
                  </button>
                </div>
              </div>

              {/* Hebrew Keyboard */}
              {showHebrewKeyboard && activeHebrewTarget && (
                <div className="p-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-lg">
                  {/* Vowel points row - only active for hebrewWord (not consonantal) */}
                  <div className="mb-2">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">Vowel points</div>
                    <div className="grid grid-cols-10 gap-1">
                      {HEBREW_VOWELS.map((v) => (
                        <button
                          key={v}
                          disabled={activeHebrewTarget === 'hebrewConsonantal'}
                          onClick={() => {
                            if (activeHebrewTarget === 'hebrewWord') insertHebrewAtCursor(hebrewWordRef.current, 'hebrewWord', v);
                          }}
                          className={`text-lg py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-white ${activeHebrewTarget === 'hebrewConsonantal' ? 'opacity-40 cursor-not-allowed' : ''}`}
                          title={activeHebrewTarget === 'hebrewConsonantal' ? 'Disabled for consonantal field' : 'Insert vowel point'}
                        >
                          <span className="text-lg">{"\u25CC" + v}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-8 gap-1">
                    {HEBREW_LETTERS.map((ch) => (
                      <button
                        key={ch}
                        onClick={() => {
                          if (activeHebrewTarget === 'hebrewWord') insertHebrewAtCursor(hebrewWordRef.current, 'hebrewWord', ch);
                          if (activeHebrewTarget === 'hebrewConsonantal') insertHebrewAtCursor(hebrewConsonantalRef.current, 'hebrewConsonantal', ch);
                        }}
                        className="text-lg py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
                      >
                        {ch}
                      </button>
                    ))}
                    <button onClick={() => {
                      if (activeHebrewTarget === 'hebrewWord') insertHebrewAtCursor(hebrewWordRef.current, 'hebrewWord', ' ');
                      if (activeHebrewTarget === 'hebrewConsonantal') insertHebrewAtCursor(hebrewConsonantalRef.current, 'hebrewConsonantal', ' ');
                    }} className="col-span-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600">Space</button>
                    <button onClick={() => {
                      // backspace
                      const ref = activeHebrewTarget === 'hebrewWord' ? hebrewWordRef.current : hebrewConsonantalRef.current;
                      if (ref) {
                        const s = ref.selectionStart ?? ref.value.length;
                        const e = ref.selectionEnd ?? s;
                        if (s === e && s > 0) {
                          const before = ref.value.substring(0, s - 1);
                          const after = ref.value.substring(e);
                          setEditForm(prev => ({ ...prev, [activeHebrewTarget!]: before + after }));
                          requestAnimationFrame(() => {
                            ref.focus();
                            ref.setSelectionRange(s - 1, s - 1);
                          });
                        } else {
                          const before = ref.value.substring(0, s);
                          const after = ref.value.substring(e);
                          setEditForm(prev => ({ ...prev, [activeHebrewTarget!]: before + after }));
                          requestAnimationFrame(() => {
                            ref.focus();
                            ref.setSelectionRange(s, s);
                          });
                        }
                      }
                    }} className="col-span-2 py-1 rounded bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50">Backspace</button>
                  </div>
                </div>
              )}

              {/* Transliteration */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Transliteration</label>
                <input
                  type="text"
                  value={editForm.transliteration || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, transliteration: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                />
              </div>

              {/* Part of Speech */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Part of Speech</label>
                <input
                  type="text"
                  value={editForm.partOfSpeech || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, partOfSpeech: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  placeholder="e.g., n.m., v., adj."
                />
              </div>

              {/* Definition */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Definition</label>
                <textarea
                  value={editForm.definition || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, definition: e.target.value }))}
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                />
              </div>

              {/* Root */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Root</label>
                <input
                  type="text"
                  value={editForm.root || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, root: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg hebrew-text text-right bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  dir="rtl"
                />
              </div>

              {/* Is Root checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isRoot"
                  checked={editForm.isRoot || false}
                  onChange={(e) => setEditForm(prev => ({ ...prev, isRoot: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 bg-white dark:bg-slate-800"
                />
                <label htmlFor="isRoot" className="text-sm text-slate-700 dark:text-slate-300">This entry is a root word</label>
              </div>

              {/* Strong's Numbers */}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Strong's Numbers</label>
                <input
                  type="text"
                  value={editForm.strongsNumbers || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, strongsNumbers: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  placeholder="e.g., H1234 or H1234/H5678"
                />
              </div>

              {/* Source (read-only) */}
              {editingEntry.sourcePage && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Source Page</label>
                  <div className="text-sm font-mono bg-slate-100 dark:bg-slate-700 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300">
                    {editingEntry.sourcePage}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={handleCancelEdit}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              {onSetEntryStatus && (
                <button
                  onClick={async () => {
                    if (!editingEntry) return;
                    try {
                      await onSetEntryStatus(editingEntry.id, 'valid', null);
                      // close modal after marking
                      setEditingEntry(null);
                      setEditForm({});
                    } catch (e) {
                      console.error('Failed to mark valid', e);
                      alert('Failed to mark entry as valid');
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-lg transition-colors"
                >
                  Mark Valid
                </button>
              )}
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsDisplay;