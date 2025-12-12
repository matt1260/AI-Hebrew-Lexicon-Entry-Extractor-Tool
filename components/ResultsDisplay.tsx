import React from 'react';
import { LexiconEntry, ProcessedPage } from '../types';

interface ResultsDisplayProps {
  processedPages: ProcessedPage[];
}

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ processedPages }) => {
  const allEntries = processedPages.flatMap(p => p.entries);

  if (processedPages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mb-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        <p>No entries extracted yet. Upload an image to start.</p>
      </div>
    );
  }

  const downloadJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allEntries, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "lexicon_data.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4 px-2">
        <h2 className="text-xl font-bold text-slate-800">
          Extracted Entries <span className="text-sm font-normal text-slate-500 ml-2">({allEntries.length} total)</span>
        </h2>
        <button
          onClick={downloadJson}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 12L12 16.5m0 0L16.5 12M12 3v13.5" />
          </svg>
          Export JSON
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-white border border-slate-200 rounded-xl shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/6">Word</th>
              <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/12">Type</th>
              <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/3">Definition</th>
              <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/6">Root/Notes</th>
              <th className="p-4 border-b border-slate-200 font-semibold text-slate-600 w-1/6">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allEntries.map((entry, index) => (
              <tr key={index} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 align-top">
                  <div className="text-xl font-bold hebrew-text text-slate-900" dir="rtl">{entry.hebrewWord}</div>
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
                </td>
                <td className="p-4 align-top text-sm">
                  {entry.sourcePage && (
                    <a 
                      href={entry.sourceUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
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
  );
};

export default ResultsDisplay;