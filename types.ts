export interface LexiconEntry {
  hebrewWord: string;
  transliteration?: string;
  partOfSpeech: string;
  definition: string;
  root?: string;
  sourcePage?: string;
  sourceUrl?: string;
}

export interface ProcessedPage {
  id: string;
  fileName: string;
  imageUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  entries: LexiconEntry[];
  error?: string;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}