# Hebrew Lexicon AI Reader & Parser

AI scanner tool which uses Gemini and response schema constraints of newer models to read Hebrew pages, parse data into a database, and validate, and correct entries. To save on costs, there is also the options to export to JSONL for batch processing with the Google's Batch API (50% discount). App uses strongs.sqlite to match roots to Strong's numbers (Update Strong's button).

Includes fully digitized, linked, and IDed database of A Hebrew & Chaldee lexicon to the Old Testament by Julius Fürst.

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](or .env) to your Gemini API key
3. Run the app:
   `npm run dev`
4. Optional: place prebuilt SQLite files under `public/` so startup can reuse them (the app looks for `public/lexicon.sqlite` and `public/strongs.sqlite` with a `strongs` table that has `lemma` and `number` columns).

## Local SQLite server

Use the bundled Node server when you want the frontend to hit a single disk-backed `lexicon.sqlite` rather than IndexedDB. This way the data is not lost if the browser loses the data. The server listens on port 4000 by default and exposes two endpoints:

- `GET /lexicon.sqlite` returns `public/lexicon.sqlite` if it exists
- `POST /lexicon.sqlite` replaces the disk file with the raw request body (`application/octet-stream` works great)
- `GET /status` health check (used by the frontend to detect server availability)

**Workflow:**

1. Start the sqlite server: `npm run start:server`
2. In another terminal, start the frontend: `npm run dev`
3. The frontend automatically detects the server and shows a green **Server** badge
4. All database changes are synced to `public/lexicon.sqlite` in real-time

You can override the server URL by setting `VITE_LEXICON_SERVER` in `.env.local`:

```
VITE_LEXICON_SERVER=http://localhost:4000
```

## Usage

1. Start the app (frontend):
   - Install dependencies: `npm install`
   - Start dev server: `npm run dev`
   - (Optional) Start the SQLite server: `npm run start:server` if you want the frontend to fetch a disk-backed `lexicon.sqlite` file from `http://localhost:4000`. Front end should be accessible at http://localhost:3000/

2. Set up Gemini API key:
   - For Vite frontend development, add `VITE_GEMINI_API_KEY` to your `.env` or `.env.local` file.
   - For server/node environments, set `GEMINI_API_KEY` or `API_KEY` in the environment.

3. Create a database (button generates a new database, see lexicon.sqlite)
4. Select Gemini model to use (Gemini 3 Flash or better HIGHLY recommended)
5. Load scanned images to start AI reading or to export for BATCH processing.
6. Use the script `run-batch-job.js` in `scripts/` to process exported BATCH JSONL files. See [scripts/README.md](scripts/README.md) for detailed instructions.

## AI Validation & Run Corrections ✅

- **Validation (AI Sweep / Run Validation):**
   - Uses the Gemini-based validator to check OCR-extracted entries for common problems (garbled OCR, mismatched vowels, missing definitions, incorrect part-of-speech, etc.).
   - Runs in batches and persists a `status` (`valid` / `invalid`) and optional `validationIssue` for each entry in the local SQLite database.
   - You can validate entries for a single page range via the **AI Sweep** controls or validate the currently visible entries using the **Validate** action in the results view.
   - Gemini 3 Flash or better is HIGHLY recommmended. Export JSONL validation JSONL sweep and use Batch API for 50% discount. 

- **Run Corrections (AI Sweep Corrections):**
   - Attempts automated corrections for entries marked `invalid`. Corrections can adjust fields like `hebrewWord` (including niqqud), `hebrewConsonantal`, `root`, and `definition` and will also update the entry's validation `status`.
   - Corrections are applied in small batches and saved to the database; they are intended to reduce manual editing but may still require review.

- **Manual Overrides:**
   - You can manually mark an entry as **Valid** from the results list or from within the edit modal. This updates the `status` and clears any `validationIssue` for that entry.

Tip: Use the "Skip entries already marked Valid" option during sweeps to avoid re-checking entries you've already inspected.

