import { GoogleGenAI, Type } from "@google/genai";
import { LexiconEntry, normalizeSourcePageFilename } from "../types";

// Resolve API key from environment.
// - For Vite frontend builds, set `VITE_GEMINI_API_KEY` in a .env file.
// - For Node/server environments, set `GEMINI_API_KEY` or `API_KEY`.
const API_KEY = (
  typeof window !== "undefined"
    ? (import.meta as any).env?.VITE_GEMINI_API_KEY
    : process.env.GEMINI_API_KEY
) || process.env.API_KEY;

if (!API_KEY) {
  // Fail fast with a clear message. This will show in console during development.
  console.error(
    "Gemini API key not found. Set VITE_GEMINI_API_KEY (Vite) or GEMINI_API_KEY/API_KEY (Node)."
  );
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Available models for selection
export const AVAILABLE_MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', description: 'Top performance' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', description: 'Fast, up-to-date flash model' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast, cost-effective' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Low-cost, low-latency flash variant' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Previous generation' },
] as const;

export type GeminiModelId = typeof AVAILABLE_MODELS[number]['id'];

// Default model
export const DEFAULT_MODEL: GeminiModelId = 'gemini-3-flash-preview';

// -------------
// Batch helpers
// -------------

type BatchRequest = {
  custom_id: string;
  method: 'POST';
  url: string;
  body: {
    contents: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>;
  };
};

const BATCH_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const buildBatchRequest = (customId: string, model: GeminiModelId, parts: BatchRequest['body']['contents']): BatchRequest => ({
  custom_id: customId,
  method: 'POST',
  url: `${BATCH_ENDPOINT}/${model}:generateContent`,
  body: { contents: parts }
});

const toJsonl = (requests: BatchRequest[]): string => requests.map(r => JSON.stringify(r)).join('\n');

const downloadJsonl = (jsonl: string, filename: string) => {
  if (typeof window === 'undefined') return;
  const blob = new Blob([jsonl], { type: 'application/jsonl' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Build a JSONL for Gemini Batch API to validate entries offline.
 * Upload the JSONL, then ingest the batch output to mark entries valid/invalid.
 */
export const buildValidationBatchJsonl = (
  entries: Array<{ id: string; hebrewWord: string; hebrewConsonantal: string; definition: string; root?: string; partOfSpeech?: string }>,
  model: GeminiModelId = DEFAULT_MODEL
): string => {
  const promptFor = (entry: typeof entries[number]) => {
    const defSnippet = entry.definition.length > 200 ? `${entry.definition.slice(0, 200)}...` : entry.definition;
    return `You are a Hebrew lexicon expert. Validate these OCR-extracted Hebrew dictionary entries.\n\nFor each entry, check if:\n1. The Hebrew word looks like a valid Hebrew word (not garbled OCR)\n2. The definition reasonably matches the Hebrew word\n3. Look for common OCR errors: ז/ו confusion, ר/ד confusion, ה/ח confusion, etc.\n\nEntries:\nID: ${entry.id}\nWord: ${entry.hebrewWord}\nConsonantal: ${entry.hebrewConsonantal}\nRoot: ${entry.root || ''}\nPOS: ${entry.partOfSpeech || ''}\nDefinition: ${defSnippet}\n\nFor each entry respond with:\n- id: the entry ID exactly as given\n- hebrewWord: the Hebrew word\n- isValid: true if entry looks correct, false if suspicious/wrong\n- confidence: \"high\", \"medium\", or \"low\"\n- issue: brief problem description if invalid (e.g., \"OCR error - word garbled\", \"Definition mismatch\")\n- suggestion: correction if possible\n\nReturn JSON array. Mark as valid unless clearly wrong.`;
  };

  const requests = entries.map(e => buildBatchRequest(e.id, model, [{ text: promptFor(e) }]));
  return toJsonl(requests);
};

/**
 * Build a JSONL for Gemini Batch API to correct invalid entries offline.
 * Groups entries by source page and inserts a [[FILE:...]] tag that the batch script will resolve to an upload.
 */
export const buildCorrectionBatchJsonl = (
  entries: Array<{ id: string; hebrewWord: string; hebrewConsonantal?: string; root?: string; definition: string; partOfSpeech?: string; validationIssue?: string; sourcePage?: string }>,
  model: GeminiModelId = DEFAULT_MODEL
): string => {
  // Group entries by source page so we generate one request per page (context window efficiency)
  const entriesByPage: Record<string, typeof entries> = {};
  
  entries.forEach(entry => {
    const page = entry.sourcePage || 'unknown';
    if (!entriesByPage[page]) {
      entriesByPage[page] = [];
    }
    entriesByPage[page].push(entry);
  });

  const requests: BatchRequest[] = [];

    for (const [page, pageEntries] of Object.entries(entriesByPage)) {
      // Skip if no valid page file or unknown
      if (page === 'unknown') continue;

      const normalizedPage = normalizeSourcePageFilename(page);
      if (!normalizedPage) continue;

    // Construct the prompt for this batch of entries
    const entriesText = pageEntries.map(e => {
      const defSnippet = e.definition.length > 200 ? `${e.definition.slice(0, 200)}...` : e.definition;
      const issue = e.validationIssue ? `Issue: ${e.validationIssue}` : '';
      return `ID: ${e.id}\nWord: ${e.hebrewWord}\nConsonantal: ${e.hebrewConsonantal || ''}\nRoot: ${e.root || ''}\nPOS: ${e.partOfSpeech || ''}\nDefinition: ${defSnippet}\n${issue}`;
    }).join('\n\n');

    const prompt = `
You are a Hebrew lexicon expert. Correct these OCR-extracted Hebrew dictionary entries based on the provided page image.

The image shows the authoritative source text.
For each entry below:
1. Locate the entry in the image.
2. Fix any spelling errors in the Hebrew Word or Consonantal text to match the image exactly.
3. Ensure the Root is correct.
4. If the entry is not found or is garbage, mark status: "invalid".

Entries to check:
${entriesText}

Respond with a JSON array of objects:
[{
  "id": "ID",
  "hebrewWord": "Fixed Word",
  "hebrewConsonantal": "Fixed Consonantal",
  "root": "Fixed Root",
  "status": "valid" | "invalid",
  "validationIssue": "Description of fix or issue"
}]
`;

    // We assume the standard path structure for this project
    // The script will intercept this tag and handle the upload
    // If sourcePage is a full filename like "fuerst_lex_0042.jpg", use it.
    // If it's just "0042", construct it.
    let imagePath = normalizedPage;
    if (!imagePath.includes('/')) {
      if (normalizedPage.startsWith('fuerst_lex_') || /^\d+$/.test(normalizedPage)) {
        imagePath = `public/fuerst_lex/${normalizedPage}`;
      } else if (normalizedPage.toLowerCase().startsWith('gesenius_lexicon_')) {
        imagePath = `public/gesenius_lex/${normalizedPage}`;
      }
    }
    
    const fileTag = `[[FILE:${imagePath}]]`;
    
    // Extract a clean ID from the filename (e.g., 'fuerst_lex_0042' -> 'fuerst_0042')
    const baseFilename = normalizedPage.replace(/\.[^.]+$/, ''); // Remove extension
    const match = baseFilename.match(/^([a-z]+)(?:_lex(?:icon)?)?_?(\d+)$/i);
    const cleanId = match ? `${match[1].toLowerCase()}_${match[2]}` : baseFilename.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    requests.push({
      custom_id: `cor_${cleanId}`,
      method: 'POST',
      url: `/v1beta/models/${model}:generateContent`,
      body: {
        contents: [
          {
            parts: [
              { text: fileTag }, // The script will replace this with the file URI
              { text: prompt }
            ]
          }
        ]
      }
    } as any);
  }

  return toJsonl(requests);
};

/**
 * Build a JSONL for Gemini Batch API to extract entries from images.
 * Uses [[FILE:...]] tags for image uploads.
 */
export const buildExtractionBatchJsonl = (
  files: File[],
  model: GeminiModelId = DEFAULT_MODEL,
  prompt: string = DEFAULT_EXTRACTION_PROMPT
): string => {
  const requests = files.map(file => {
    // Try to guess the path. If it's a File object from input, we only have .name.
    // We'll assume the user puts them in public/fuerst_lex/ if they match the pattern,
    // otherwise we just use the filename and expect the user to handle it or the script to find it in CWD.
    let imagePath = file.name;
    if (!imagePath.includes('/')) {
       if (imagePath.startsWith('fuerst_lex_') || /^\d+$/.test(imagePath.split('.')[0])) {
          imagePath = `public/fuerst_lex/${imagePath}`;
       }
    }
    
    const fileTag = `[[FILE:${imagePath}]]`;
    
    // Extract a clean ID from the filename (e.g., 'fuerst_lex_0042.jpg' -> 'fuerst_0042')
    const baseFilename = file.name.replace(/\.[^.]+$/, '');
    const match = baseFilename.match(/^([a-z]+)(?:_lex(?:icon)?)?_?(\d+)$/i);
    const cleanId = match ? `${match[1].toLowerCase()}_${match[2]}` : baseFilename.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    
    return {
      custom_id: `ext_${cleanId}`,
      method: 'POST',
      url: `/v1beta/models/${model}:generateContent`,
      body: {
        contents: [
          {
            parts: [
              { text: fileTag },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                hebrewWord: { type: Type.STRING, description: "The Hebrew word entry with niqqud" },
                hebrewConsonantal: { type: Type.STRING, description: "The Hebrew word entry without niqqud (consonantal)" },
                transliteration: { type: Type.STRING, description: "English transliteration of the word" },
                partOfSpeech: { type: Type.STRING, description: "Grammatical part of speech" },
                definition: { type: Type.STRING, description: "English definition of the word" },
                root: { type: Type.STRING, description: "Root word if available" }
              },
              required: ["hebrewWord", "hebrewConsonantal", "definition"]
            }
          }
        }
      }
    };
  });

  return toJsonl(requests as any[]);
};

/**
 * Browser helper to trigger a download of a JSONL string.
 */
export const downloadBatchJsonl = (jsonl: string, filename: string) => downloadJsonl(jsonl, filename);

/**
 * Converts a File object to a Base64 string.
 */
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = reader.result as string;
      const base64Content = base64Data.split(',')[1];
      resolve({
        inlineData: {
          data: base64Content,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const DEFAULT_EXTRACTION_PROMPT = `
      Analyze this page from a Hebrew-Chaldee Lexicon. 
      Extract all Hebrew word entries found on this page into a structured JSON format.
      
      For each entry, capture:
      1. The main Hebrew word (lemma) including vowel points if visible EXACTLY as spelled. Usually the largest font on the line.
      2. The part of speech (e.g., n.m., v., adj.).
      3. The English definition (summarized if very long). Core definition is usually in italics. Include any verse references.
      6. The root word if explicitly mentioned, exactly as given.
      
      Additionally, for each entry:
      1. Generate the consonantal Hebrew word (the word stripped of all vowel points/niqqud).
      2. Generate a transliteration (if you can infer it or it is present).

      The image contains dense text in columns. Read carefully column by column.
      Ignore page headers, footers, or marginalia that are not dictionary entries.
      Return the data as a clean JSON array.
    `;

/**
 * Extracts lexicon entries from an image using Gemini.
 * @param file - The image file to process
 * @param model - The Gemini model to use (defaults to flash)
 * @param customPrompt - Optional custom prompt to override the default
 */
export const extractEntriesFromImage = async (
  file: File, 
  model: GeminiModelId = DEFAULT_MODEL, 
  customPrompt?: string
): Promise<LexiconEntry[]> => {
  console.log(`[Gemini] Using model: ${model}`);
  try {
    const imagePart = await fileToGenerativePart(file);

    const prompt = customPrompt && customPrompt.trim()
      ? customPrompt.trim()
      : DEFAULT_EXTRACTION_PROMPT;

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          imagePart,
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              hebrewWord: { type: Type.STRING, description: "The Hebrew word entry with niqqud" },
              hebrewConsonantal: { type: Type.STRING, description: "The Hebrew word entry without niqqud (consonantal)" },
              transliteration: { type: Type.STRING, description: "English transliteration of the word" },
              partOfSpeech: { type: Type.STRING, description: "Grammatical part of speech" },
              definition: { type: Type.STRING, description: "English definition of the word" },
              root: { type: Type.STRING, description: "Root word if available" }
            },
            required: ["hebrewWord", "hebrewConsonantal", "definition"]
          }
        }
      }
    });

    // Check for safety blocking or other stop reasons
    const candidate = response.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Generation stopped: ${candidate.finishReason}. The content might have triggered safety filters.`);
    }

    if (!response.text) {
      throw new Error("No data returned from Gemini. The model might have failed to generate text.");
    }

    const rawData = JSON.parse(response.text);
    
    // Add unique IDs to each entry
    const data: LexiconEntry[] = Array.isArray(rawData) ? rawData.map((item: any) => ({
      ...item,
      // Use crypto.randomUUID if available, otherwise fallback to simple random string
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36)
    })) : [];

    return data;

  } catch (error: any) {
    console.error("Error processing image with Gemini:", error);
    
    const errorMessage = error.message || error.toString();

    // Map common API errors to user-friendly messages
    if (errorMessage.includes('429') || 
        errorMessage.includes('Resource has been exhausted') || 
        errorMessage.includes('Quota exceeded')) {
      throw new Error("API Quota Exceeded. Please check your billing or wait before trying again.");
    }
    
    if (errorMessage.includes('400') || errorMessage.includes('INVALID_ARGUMENT')) {
      throw new Error("Invalid Request. The image format might not be supported.");
    }

    throw error;
  }
};

/**
 * Validation result for a single entry
 */
export interface EntryValidationResult {
  id: string;
  hebrewWord: string;
  isValid: boolean;
  confidence: 'high' | 'medium' | 'low';
  issue?: string;
  suggestion?: string;
}

export interface EntryCorrectionResult {
  id: string;
  hebrewWord: string;
  hebrewConsonantal?: string;
  root?: string;
  status: 'valid' | 'invalid';
  validationIssue?: string;
}

/**
 * Validates a batch of lexicon entries using AI
 * Checks if Hebrew words and definitions appear valid
 */
export const validateEntries = async (
  entries: Array<{ id: string; hebrewWord: string; hebrewConsonantal: string; definition: string; root?: string; partOfSpeech?: string }>,
  model: GeminiModelId = DEFAULT_MODEL
): Promise<EntryValidationResult[]> => {
  console.log(`[Gemini] Validating ${entries.length} entries with model: ${model}`);
  
  try {
    const entriesText = entries.map((e, i) => 
      `${i + 1}. ID: ${e.id} | Word: ${e.hebrewWord} | Definition: ${e.definition.substring(0, 150)}${e.definition.length > 150 ? '...' : ''}`
    ).join('\n');

    const prompt = `
You are a Hebrew lexicon expert. Validate these OCR-extracted Hebrew dictionary entries.

For each entry, check if:
1. The Hebrew word looks like a valid Hebrew word (not garbled OCR)
2. The definition reasonably matches the Hebrew word
3. Look for common OCR errors: ז/ו confusion, ר/ד confusion, ה/ח confusion, etc.

Entries:
${entriesText}

For each entry respond with:
- id: the entry ID exactly as given
- hebrewWord: the Hebrew word
- isValid: true if entry looks correct, false if suspicious/wrong
- confidence: "high", "medium", or "low"
- issue: brief problem description if invalid (e.g., "OCR error - word garbled", "Definition mismatch")
- suggestion: correction if possible

Return JSON array. Mark as valid unless clearly wrong.
`;

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              hebrewWord: { type: Type.STRING },
              isValid: { type: Type.BOOLEAN },
              confidence: { type: Type.STRING },
              issue: { type: Type.STRING },
              suggestion: { type: Type.STRING }
            },
            required: ["id", "hebrewWord", "isValid", "confidence"]
          }
        }
      }
    });

    if (!response.text) {
      throw new Error("No validation results returned from Gemini.");
    }

    return JSON.parse(response.text);
  } catch (error: any) {
    console.error("Error validating entries with Gemini:", error);
    throw error;
  }
};

/**
 * Correction pass for invalid entries: request corrected spellings.
 */
export const correctEntries = async (
  entries: Array<{ id: string; hebrewWord: string; hebrewConsonantal?: string; root?: string; definition: string; partOfSpeech?: string; validationIssue?: string }>,
  model: GeminiModelId = DEFAULT_MODEL,
  pageFile?: File
): Promise<EntryCorrectionResult[]> => {
  console.log(`[Gemini] Correcting ${entries.length} entries with model: ${model}`);

  try {
    const entriesText = entries.map((e, i) =>
      `${i + 1}. ID: ${e.id} | Word: ${e.hebrewWord} | Consonantal: ${e.hebrewConsonantal || ''} | Root: ${e.root || ''} | POS: ${e.partOfSpeech || ''} | Issue: ${e.validationIssue || 'unknown'} | Definition: ${e.definition.substring(0, 160)}${e.definition.length > 160 ? '...' : ''}`
    ).join('\n');

    // Prepare prompt and contents. If a scanned page image is provided, include it as the first content part
    // and instruct the model to use the image as the authoritative source for spelling.
    const prompt = `You are a careful Hebrew lexicon editor. Fix likely OCR errors using the scanned page image provided as the authoritative reference (if present).

For each entry, re-examine the page to figure out what was misread and where using the description. Core definitions are usually in italics along with extended descriptions and references. Then return corrected spellings:
- hebrewWord: corrected headword (Hebrew) — ensure it matches what is visible on the scanned page exactly when the page shows a clear form
- hebrewConsonantal: consonantal form (if known)
- root: corrected root (if known)
- status: "valid" if corrected and consistent; "invalid" if still unsure or ambiguous
- validationIssue: brief note if still invalid or what was fixed

IMPORTANT: Ensure spelling matches to what is on the provided page exactly. When the page shows ambiguity, mark status as "invalid" and explain in validationIssue.

Entries:
${entriesText}

Respond ONLY with a JSON array of objects with fields: id, hebrewWord, hebrewConsonantal, root, status, validationIssue.`;

    const parts: any[] = [];
    if (pageFile) {
      const imagePart = await fileToGenerativePart(pageFile);
      parts.push(imagePart);
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              hebrewWord: { type: Type.STRING },
              hebrewConsonantal: { type: Type.STRING },
              root: { type: Type.STRING },
              status: { type: Type.STRING },
              validationIssue: { type: Type.STRING }
            },
            required: ["id", "hebrewWord", "status"]
          }
        }
      }
    });

    if (!response.text) {
      throw new Error("No correction results returned from Gemini.");
    }

    return JSON.parse(response.text);
  } catch (error: any) {
    console.error("Error correcting entries with Gemini:", error);
    throw error;
  }
};