import { GoogleGenAI, Type } from "@google/genai";
import { LexiconEntry } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// We use the pro model for better OCR capabilities on dense, historical text
const MODEL_NAME = 'gemini-3-pro-preview';

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

/**
 * Extracts lexicon entries from an image using Gemini.
 */
export const extractEntriesFromImage = async (file: File): Promise<LexiconEntry[]> => {
  try {
    const imagePart = await fileToGenerativePart(file);

    const prompt = `
      Analyze this page from Gesenius' Hebrew-Chaldee Lexicon. 
      Extract all Hebrew word entries found on this page into a structured JSON format.
      
      For each entry, capture:
      1. The main Hebrew word (lemma) including vowel points if visible.
      2. The transliteration (if you can infer it or it is present).
      3. The part of speech (e.g., n.m., v., adj.).
      4. The English definition (summarized if very long).
      5. The root word if explicitly mentioned.
      
      The image contains dense text in columns. Read carefully column by column.
      Ignore page headers, footers, or marginalia that are not dictionary entries.
      Return the data as a clean JSON array.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
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
              hebrewWord: { type: Type.STRING, description: "The Hebrew word entry" },
              transliteration: { type: Type.STRING, description: "English transliteration of the word" },
              partOfSpeech: { type: Type.STRING, description: "Grammatical part of speech" },
              definition: { type: Type.STRING, description: "English definition of the word" },
              root: { type: Type.STRING, description: "Root word if available" }
            },
            required: ["hebrewWord", "definition"]
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

    const data = JSON.parse(response.text) as LexiconEntry[];
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