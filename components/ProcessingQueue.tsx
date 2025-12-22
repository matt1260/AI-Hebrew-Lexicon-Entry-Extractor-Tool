import React, { useMemo } from 'react';
import { ProcessedPage } from '../types';

interface ProcessingQueueProps {
  pages: ProcessedPage[];
  isProcessing?: boolean;
  onStopScanning?: () => void;
}

const StatusIcon: React.FC<{ status: ProcessedPage['status'] }> = ({ status }) => {
  switch (status) {
    case 'pending':
      return <span className="w-2 h-2 rounded-full bg-slate-400 flex-shrink-0" />;
    case 'processing':
      return <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />;
    case 'completed':
      return (
        <svg className="w-3 h-3 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'error':
      return (
        <svg className="w-3 h-3 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    default:
      return null;
  }
};

const ProcessingQueue: React.FC<ProcessingQueueProps> = ({ pages, isProcessing, onStopScanning }) => {
  const stats = useMemo(() => {
    const completed = pages.filter(p => p.status === 'completed').length;
    const errors = pages.filter(p => p.status === 'error').length;
    const pending = pages.filter(p => p.status === 'pending').length;
    const processing = pages.filter(p => p.status === 'processing').length;
    const totalEntries = pages.reduce((sum, p) => sum + (p.entries?.length || 0), 0);
    return { completed, errors, pending, processing, totalEntries };
  }, [pages]);

  if (pages.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 mb-2 opacity-50">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <p className="text-xs">No scans yet</p>
      </div>
    );
  }

  const progressPercent = pages.length > 0 ? Math.round(((stats.completed + stats.errors) / pages.length) * 100) : 0;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm h-full flex flex-col overflow-hidden">
      {/* Header with stats */}
      <div className="flex-shrink-0 p-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Scans ({pages.length})
          </h3>
          <div className="flex items-center gap-2">
            {isProcessing && onStopScanning && (stats.pending > 0 || stats.processing > 0) && (
              <button
                onClick={onStopScanning}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 rounded border border-red-200 dark:border-red-800 transition-colors"
                title="Stop scanning"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                </svg>
                Stop
              </button>
            )}
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              {stats.totalEntries} entries
            </span>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        
        {/* Mini stats row */}
        <div className="flex gap-3 mt-2 text-[10px] font-medium">
          {stats.processing > 0 && (
            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              {stats.processing} scanning
            </span>
          )}
          {stats.pending > 0 && (
            <span className="text-slate-500 dark:text-slate-400">{stats.pending} pending</span>
          )}
          {stats.completed > 0 && (
            <span className="text-green-600 dark:text-green-400">{stats.completed} done</span>
          )}
          {stats.errors > 0 && (
            <span className="text-red-500 dark:text-red-400">{stats.errors} failed</span>
          )}
        </div>
      </div>
      
      {/* Compact scrollable list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="divide-y divide-slate-50 dark:divide-slate-800">
          {pages.map((page) => (
            <div 
              key={page.id} 
              className={`flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                page.status === 'processing' ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''
              }`}
            >
              <StatusIcon status={page.status} />
              <span 
                className={`text-xs truncate flex-1 ${
                  page.status === 'error' ? 'text-red-600 dark:text-red-400' :
                  page.status === 'completed' ? 'text-slate-700 dark:text-slate-300' :
                  page.status === 'processing' ? 'text-amber-700 dark:text-amber-400 font-medium' :
                  'text-slate-500 dark:text-slate-500'
                }`}
                title={page.fileName}
              >
                {page.fileName}
              </span>
              {page.status === 'completed' && page.entries.length > 0 && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">
                  {page.entries.length}
                </span>
              )}
              {page.status === 'error' && page.error && (
                <span 
                  className="text-[10px] text-red-400 dark:text-red-500 truncate max-w-[80px] flex-shrink-0" 
                  title={page.error}
                >
                  {page.error.includes('Quota') ? 'Quota' : 'Error'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProcessingQueue;