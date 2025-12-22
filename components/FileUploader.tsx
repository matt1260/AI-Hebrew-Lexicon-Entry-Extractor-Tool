import React, { useRef, useState } from 'react';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  isProcessing: boolean;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFilesSelected, isProcessing }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // Fix: Explicitly type 'file' as File to avoid TS error: Property 'type' does not exist on type 'unknown'.
      const imageFiles = Array.from(e.dataTransfer.files).filter((file: File) => file.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        onFilesSelected(imageFiles);
      }
    }
  };

  const handleClick = () => {
    if (isProcessing) return;
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Fix: Explicitly type 'file' as File to avoid TS error: Property 'type' does not exist on type 'unknown'.
      const imageFiles = Array.from(e.target.files).filter((file: File) => file.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        onFilesSelected(imageFiles);
      }
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-200
        ${isDragging 
          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' 
          : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/50'
        }
        ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInput}
        className="hidden"
        accept="image/*"
        multiple
      />
      
      <div className="flex items-center gap-3">
        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400 flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>
        <div className="text-left">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {isProcessing ? 'Processing...' : 'Upload Scans'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500">
            Drop images or click
          </p>
        </div>
      </div>
    </div>
  );
};

export default FileUploader;