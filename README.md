<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1venoN0eo-mH2KclHaJGYUVC3hUmzyM9v

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
4. Optional: place prebuilt SQLite files under `public/` so startup can reuse them (the app looks for `public/lexicon.sqlite` and `public/strongs.sqlite` with a `strongs` table that has `lemma` and `number` columns).

## Local SQLite server

Use the bundled Node server when you want the frontend to hit a single disk-backed `lexicon.sqlite` rather than IndexedDB. The server listens on port 4000 by default and exposes two endpoints:

- `GET /lexicon.sqlite` returns `public/lexicon.sqlite` if it exists
- `POST /lexicon.sqlite` replaces the disk file with the raw request body (`application/octet-stream` works great)
- `GET /status` health check (used by the frontend to detect server availability)

**Workflow:**

1. Start the server: `npm run start:server`
2. In another terminal, start the frontend: `npm run dev`
3. The frontend automatically detects the server and shows a green **Server** badge
4. All database changes are synced to `public/lexicon.sqlite` in real-time

You can override the server URL by setting `VITE_LEXICON_SERVER` in `.env.local`:

```
VITE_LEXICON_SERVER=http://localhost:4000
```

Sample `curl` upload:

```
