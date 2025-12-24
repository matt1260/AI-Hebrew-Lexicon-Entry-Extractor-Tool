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

const extractFilename = (value: string): string => {
  const withoutPath = value.split(/[\\/]/).pop() ?? '';
  return withoutPath.replace(/\.jpe?g$/i, '');
};

const slugify = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const normalizeSourcePageFilename = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const base = extractFilename(trimmed);
  const slug = slugify(base);
  if (!slug) return undefined;

  const pad = (num: string) => num.padStart(4, '0');

  // Check for Fuerst pattern
  const fuerstMatch = slug.match(/fuerst-lex-?(\d{1,4})/);
  if (fuerstMatch) {
    return `fuerst_lex_${pad(fuerstMatch[1])}.jpg`;
  }

  // Check for Gesenius pattern
  const geseniusMatch = slug.match(/gesenius(?:-lex(?:icon)?)?-?(\d{1,4})/);
  if (geseniusMatch) {
    return `gesenius_lexicon_${pad(geseniusMatch[1])}.jpg`;
  }

  // Generic pattern: prefix-#### or prefix_####
  const genericMatch = slug.match(/^(.*?)-?(\d{1,4})$/);
  if (genericMatch) {
    const prefix = genericMatch[1].replace(/-/g, '_');
    const num = pad(genericMatch[2]);
    return `${prefix}_${num}.jpg`;
  }

  const fallback = slug.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!fallback) return undefined;
  return fallback.endsWith('.jpg') ? fallback : `${fallback}.jpg`;
};

export const getSourcePageFromBatchKey = (batchKey?: string | null): string | undefined => {
  if (!batchKey) return undefined;
  const trimmed = batchKey.trim();
  if (!trimmed) return undefined;

  const prefix = trimmed.startsWith('extract-') ? 'extract-' : '';
  const remainder = prefix ? trimmed.slice(prefix.length) : trimmed;
  const lastDashIndex = remainder.lastIndexOf('-');
  const slug = lastDashIndex > 0 ? remainder.slice(0, lastDashIndex) : remainder;

  return normalizeSourcePageFilename(slug);
};

export const getPublicSourceImagePath = (sourcePage?: string | null, fallbackUrl?: string | null): string | undefined => {
  const normalized = normalizeSourcePageFilename(sourcePage);
  if (normalized) {
    // Try to infer directory from prefix (e.g., fuerst_lex_0001.jpg -> /fuerst_lex/fuerst_lex_0001.jpg)
    const lastUnderscoreIndex = normalized.lastIndexOf('_');
    if (lastUnderscoreIndex > 0) {
      const prefix = normalized.slice(0, lastUnderscoreIndex);
      // Special case for gesenius_lexicon -> gesenius_lex directory
      if (prefix === 'gesenius_lexicon') {
        return `/gesenius_lex/${normalized}`;
      }
      return `/${prefix}/${normalized}`;
    }
    return `/${normalized}`;
  }
  return fallbackUrl ?? undefined;
};

/**
 * Get the public URL for a source page image
 * @param entry - The lexicon entry containing sourcePage
 * @returns The public URL path or undefined
 */
export function getSourceImageUrl(entry: LexiconEntry): string | undefined {
  return getPublicSourceImagePath(entry.sourcePage, entry.sourceUrl);
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