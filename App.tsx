import React, { useState, useCallback } from 'react';
import FileUploader from './components/FileUploader';
import ResultsDisplay from './components/ResultsDisplay';
import ProcessingQueue from './components/ProcessingQueue';
import { ProcessedPage, LexiconEntry } from './types';
import { extractEntriesFromImage } from './services/geminiService';

const App: React.FC = () => {
  const [pages, setPages] = useState<ProcessedPage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    // Create initial page objects
    const newPages: ProcessedPage[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      fileName: file.name,
      imageUrl: URL.createObjectURL(file),
      status: 'pending',
      entries: []
    }));

    setPages(prev => [...prev, ...newPages]);
    setIsProcessing(true);

    // Process sequentially to not hit rate limits easily and for better UX control
    // In a production app with a backend queue, this could be parallelized more aggressively.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pageId = newPages[i].id;
      const pageUrl = newPages[i].imageUrl;

      // Update status to processing
      setPages(prev => prev.map(p => 
        p.id === pageId ? { ...p, status: 'processing' } : p
      ));

      try {
        const extractedEntries = await extractEntriesFromImage(file);
        
        // Enrich entries with source metadata
        const enrichedEntries: LexiconEntry[] = extractedEntries.map(entry => ({
          ...entry,
          sourcePage: file.name,
          sourceUrl: pageUrl
        }));
        
        setPages(prev => prev.map(p => 
          p.id === pageId ? { 
            ...p, 
            status: 'completed', 
            entries: enrichedEntries 
          } : p
        ));
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isQuotaError = errorMessage.toLowerCase().includes('quota') || errorMessage.includes('429');
        
        setPages(prev => {
          // Update the current page to error
          let updatedPages = prev.map((p): ProcessedPage => 
            p.id === pageId ? { 
              ...p, 
              status: 'error', 
              error: errorMessage 
            } : p
          );

          // If we hit a quota limit, cancel all pending pages to prevent further failures
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

        if (isQuotaError) {
          // Stop processing the queue
          break;
        }
      }
    }
    
    setIsProcessing(false);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 py-4 px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 text-white p-2 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">Hebrew Lexicon Scanner</h1>
            <p className="text-xs text-slate-500">Powered by Gemini 3.0 Pro</p>
          </div>
        </div>
        <div className="text-sm text-slate-500">
           {pages.reduce((acc, p) => acc + p.entries.length, 0)} words extracted
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-6 gap-6 flex">
        {/* Left Sidebar: Upload & Status */}
        <div className="w-80 flex flex-col gap-6 flex-shrink-0">
          <FileUploader 
            onFilesSelected={handleFilesSelected} 
            isProcessing={isProcessing} 
          />
          <ProcessingQueue pages={pages} />
        </div>

        {/* Right Content: Results Table */}
        <div className="flex-1 min-w-0">
          <ResultsDisplay processedPages={pages} />
        </div>
      </main>
    </div>
  );
};

export default App;