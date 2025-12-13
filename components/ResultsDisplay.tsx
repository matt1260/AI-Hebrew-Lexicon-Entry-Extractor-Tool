import React, { useState } from 'react';
import { LexiconEntry } from '../types';

interface ResultsDisplayProps {
  entries: LexiconEntry[];
  onDeleteEntries: (ids: string[]) => void;
  filterTitle?: string;
}

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ entries, onDeleteEntries, filterTitle }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
    // Only download selected if there is a selection, otherwise download all
    const entriesToExport = selectedIds.size > 0 
      ? entries.filter(e => selectedIds.has(e.id))
      : entries;

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(entriesToExport, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "lexicon_data.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-white rounded-xl border border-slate-200 m-6">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        <p>No entries found. Upload an image or select a different letter.</p>
      </div>
    );
  }

  const isAllSelected = entries.length > 0 && selectedIds.size === entries.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < entries.length;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex justify-between items-center py-4 px-6 bg-white border-b border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          {filterTitle || 'Lexicon Entries'}
          <span className="text-sm font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {entries.length}
          </span>
          {selectedIds.size > 0 && (
            <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full ml-1">
              {selectedIds.size} selected
            </span>
          )}
        </h2>
        
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium border border-red-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete
            </button>
          )}
          
          <button
            onClick={downloadJson}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 12L12 16.5m0 0L16.5 12M12 3v13.5" />
            </svg>
            Export
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 pt-2">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="p-4 border-b border-slate-200 w-12 text-center">
                  <input 
                    type="checkbox" 
                    checked={isAllSelected}
                    ref={input => {
                      if (input) input.indeterminate = isIndeterminate;
                    }}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/6">Word</th>
                <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/12">Type</th>
                <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/3">Definition</th>
                <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/6">Root/Notes</th>
                <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/6">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr 
                  key={entry.id} 
                  className={`hover:bg-slate-50 transition-colors ${selectedIds.has(entry.id) ? 'bg-indigo-50/40' : ''}`}
                  onClick={() => toggleSelection(entry.id)}
                >
                  <td className="p-4 align-top text-center" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelection(entry.id)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer mt-1"
                    />
                  </td>
                  <td className="p-4 align-top">
                    <div className="text-xl font-bold hebrew-text text-slate-900" dir="rtl">{entry.hebrewWord}</div>
                    {entry.hebrewConsonantal && (
                      <div className="text-sm text-slate-400 hebrew-text mt-1" dir="rtl" title="Consonantal (No Niqqud)">{entry.hebrewConsonantal}</div>
                    )}
                    {entry.transliteration && (
                      <div className="text-xs text-slate-500 mt-1 font-mono">{entry.transliteration}</div>
                    )}
                  </td>
                  <td className="p-4 align-top">
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-medium">
                      {entry.partOfSpeech || 'N/A'}
                    </span>
                  </td>
                  <td className="p-4 align-top text-slate-700 text-sm leading-relaxed">
                    {entry.definition}
                  </td>
                  <td className="p-4 align-top text-sm text-slate-500">
                    {entry.root && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs uppercase tracking-wider text-slate-400">Root:</span>
                        <span className="hebrew-text font-medium" dir="rtl">{entry.root}</span>
                      </div>
                    )}
                    {entry.isRoot && (
                      <div className="text-[10px] uppercase tracking-wide text-amber-600 mt-1">
                        root=true
                      </div>
                    )}
                    {entry.strongsNumbers && (
                      <div className="text-[10px] uppercase tracking-wide text-indigo-700 mt-1">
                        STRONGS: {entry.strongsNumbers}
                      </div>
                    )}
                  </td>
                  <td className="p-4 align-top text-sm">
                    {entry.sourcePage && (
                      <a 
                        href={entry.sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ResultsDisplay;