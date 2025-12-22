export interface LexiconEntry {
  id: string;
  hebrewWord: string;
  hebrewConsonantal?: string;
  transliteration?: string;
  partOfSpeech: string;
  definition: string;
  root?: string;
  isRoot?: boolean;
  strongsNumbers?: string;
  sourcePage?: string;
  sourceUrl?: string;
  dateAdded?: number;
  // Validation fields
  status?: 'valid' | 'invalid' | 'unchecked';
  validationIssue?: string;
}

/**
 * Get the public URL for a source page image
 * @param entry - The lexicon entry containing sourcePage
 * @returns The public URL path or undefined
 */
export function getSourceImageUrl(entry: LexiconEntry): string | undefined {
  // If sourcePage looks like a fuerst_lex filename, return the public path
  if (entry.sourcePage && entry.sourcePage.startsWith('fuerst_lex_')) {
    return `/fuerst_lex/${entry.sourcePage}`;
  }
  // Otherwise fall back to sourceUrl (might be blob URL from current session)
  return entry.sourceUrl;
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