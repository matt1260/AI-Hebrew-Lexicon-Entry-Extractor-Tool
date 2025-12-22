import React, { useState } from 'react';

interface AlphabetFilterProps {
  selectedLetter: string | null;
  onLetterSelect: (letter: string | null) => void;
  onSearch: (query: string) => void;
  onPageFilter: (page: string) => void;
}

const HEBREW_ALPHABET = [
  'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 
  'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ', 'ק', 'ר', 'ש', 'ת'
];

const AlphabetFilter: React.FC<AlphabetFilterProps> = ({ selectedLetter, onLetterSelect, onSearch, onPageFilter }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [pageQuery, setPageQuery] = useState('');
  const [showKeyboard, setShowKeyboard] = useState(false);

  const handleLetterClick = (letter: string) => {
    setSearchQuery(prev => prev + letter);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onLetterSelect(null); // Clear letter filter when searching
      onPageFilter(''); // Clear page filter when searching
      onSearch(searchQuery.trim());
    }
  };

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLetterSelect(null); // Clear letter filter
    onSearch(''); // Clear search query
    onPageFilter(pageQuery.trim());
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    onSearch('');
  };

  const handleClearPage = () => {
    setPageQuery('');
    onPageFilter('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handlePageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageQuery(e.target.value);
  };

  return (
    <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm z-20 relative">
      {/* Search bar row */}
      <div className="py-2 px-4 flex items-center gap-2 border-b border-slate-100 dark:border-slate-700">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={handleInputChange}
              placeholder="Search Hebrew word, transliteration, or definition..."
              className="w-full px-3 py-1.5 pr-20 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent hebrew-text bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              dir="auto"
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Clear search"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowKeyboard(!showKeyboard)}
                className={`p-1 rounded transition-colors ${
                  showKeyboard ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
                title="Toggle Hebrew keyboard"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
                </svg>
              </button>
            </div>

            {/* Hebrew keyboard popup overlay */}
            {showKeyboard && (
              <div className="absolute top-full left-0 mt-2 z-[9999] bg-white dark:bg-slate-800 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 p-3 w-full">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Hebrew Keyboard</span>
                  <button
                    type="button"
                    onClick={() => setShowKeyboard(false)}
                    className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 justify-center" dir="rtl">
                  {HEBREW_ALPHABET.map((letter) => (
                    <button
                      key={letter}
                      type="button"
                      onClick={() => handleLetterClick(letter)}
                      className="w-8 h-8 flex items-center justify-center rounded-md text-base font-bold hebrew-text bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
                    >
                      {letter}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!searchQuery.trim()}
            className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Search
          </button>
        </form>

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

        <form onSubmit={handlePageSubmit} className="flex items-center gap-2">
          <div className="relative w-30 md:w-36">
            <input
              type="text"
              value={pageQuery}
              onChange={handlePageChange}
              placeholder="Page (e.g. 0100)"
              className="w-full px-3 py-1.5 pr-5 text-sm border border-slate-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
            {pageQuery && (
              <button
                type="button"
                onClick={handleClearPage}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Clear page filter"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            Go
          </button>
        </form>
      </div>

      {/* Letter filter row */}
      <div className="py-2 px-4 flex items-center gap-2">
        <button
          onClick={() => { onLetterSelect(null); handleClearSearch(); }}
          className={`
            flex-shrink-0 px-3 py-1 rounded-lg text-sm font-medium transition-colors
            ${selectedLetter === null && !searchQuery
              ? 'bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white' 
              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }
          `}
        >
          All
        </button>
        
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>
        
        <div className="flex-1 overflow-x-auto hide-scrollbar flex items-center gap-1" dir="rtl">
          {HEBREW_ALPHABET.map((letter) => (
            <button
              key={letter}
              onClick={() => { onLetterSelect(letter === selectedLetter ? null : letter); setSearchQuery(''); onSearch(''); }}
              className={`
                w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-base font-bold hebrew-text transition-all
                ${selectedLetter === letter 
                  ? 'bg-indigo-600 text-white shadow-md scale-105' 
                  : 'text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-400'
                }
              `}
            >
              {letter}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AlphabetFilter;