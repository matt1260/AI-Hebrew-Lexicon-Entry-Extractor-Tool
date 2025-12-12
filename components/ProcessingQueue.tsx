import React from 'react';
import { ProcessedPage } from '../types';

interface ProcessingQueueProps {
  pages: ProcessedPage[];
}

const ProcessingQueue: React.FC<ProcessingQueueProps> = ({ pages }) => {
  if (pages.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Pages ({pages.length})
      </h3>
      
      <div className="space-y-3 overflow-y-auto flex-1 pr-2">
        {pages.map((page) => (
          <div key={page.id} className="flex gap-3 items-start p-3 bg-slate-50 rounded-lg border border-slate-100">
            <div className="w-12 h-12 flex-shrink-0 bg-slate-200 rounded-md overflow-hidden relative">
              <img 
                src={page.imageUrl} 
                alt={page.fileName} 
                className="w-full h-full object-cover"
              />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate" title={page.fileName}>
                {page.fileName}
              </p>
              
              <div className="mt-1 flex flex-col">
                {page.status === 'pending' && (
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    Pending
                  </span>
                )}
                {page.status === 'processing' && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    Scanning...
                  </span>
                )}
                {page.status === 'completed' && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                    Done ({page.entries.length} entries)
                  </span>
                )}
                {page.status === 'error' && (
                  <>
                    <span className="text-xs text-red-600 flex items-center gap-1">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                      Failed
                    </span>
                    {page.error && (
                      <span className="text-[10px] text-red-400 mt-0.5 truncate w-full block" title={page.error}>
                        {page.error}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProcessingQueue;