# Gemini Batch Job Runner

This script (`scripts/run-batch-job.js`) is a powerful utility for managing asynchronous batch processing jobs with the Google Gemini API. It is specifically designed to handle the workflow of this tool, including image-based extraction and correction.

## Features

- **Automatic Image Uploads**: Scans your JSONL files for `[[FILE:path/to/image.jpg]]` tags. It automatically uploads these images to the Gemini File API and replaces the tags with the correct `fileUri` before submitting the batch job.
- **Persistent File Caching**: Uploaded file URIs are stored in `.gemini-file-cache.json`. If you run a job with the same images, the script will skip the upload and reuse the existing URIs (respecting the 48-hour expiration limit of the Gemini File API).
- **Format Normalization**: Automatically converts the "Legacy" JSONL format exported by the web app into the specific request-response format required by the Gemini Batch API.
- **Job Lifecycle Management**:
  - **Create**: Uploads the input and starts a new batch job.
  - **Poll**: Monitors a running job until completion and automatically downloads the results. You don't have to leave this running.
  - **Maintenance**: List active jobs, delete specific jobs, or clear all pending/running jobs. Jobs and downloads are kept for 48 hours.

## Prerequisites

- **Node.js** (v18+)
- **API Key**: Set your Gemini API key in your environment:
  ```bash
  export GEMINI_API_KEY='your_api_key_here'
  ```

## Usage

### 1. Run a new Batch Job
Export a JSONL file from the app (Extraction, Validation, or Correction), then run:
```bash
node scripts/run-batch-job.js --file extraction-batch-123.jsonl
```
The script will:
1. Scan for images and upload them (if not cached).
2. Upload the processed JSONL to Gemini.
3. Create the batch job.
4. Poll every 10 seconds until finished.
5. Download the results to `extraction-batch-123-batch-results.jsonl`.

### 2. Monitor an existing Job
If you closed the script while a job was running, you can resume polling by providing the job ID:
```bash
node scripts/run-batch-job.js --poll batches/abc-123-xyz
```

### 3. Maintenance Commands

**List all jobs:**
```bash
node scripts/run-batch-job.js --list
```

**List only failed/cancelled jobs:**
```bash
node scripts/run-batch-job.js --list --state failed,cancelled
```

**Delete a specific job:**
```bash
node scripts/run-batch-job.js --delete batches/abc-123-xyz
```

**Clear all queued/running jobs:**
```bash
node scripts/run-batch-job.js --clear
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--file <path>` | Path to the JSONL file exported from the app. | Required |
| `--model <name>` | Gemini model to use. | `gemini-3-flash-preview` |
| `--output <path>` | Destination for the result file. | `<input>-batch-results.jsonl` |
| `--poll-interval <ms>` | How often to check job status. | `10000` (10s) |
| `--timeout <min>` | Maximum time to wait for completion. | `1440` (24h) |
| `--api-key <key>` | Override the environment API key. | - |

## How it Works

1. **Pre-processing**: The script reads the input JSONL. If it finds `[[FILE:...]]` tags, it resolves the paths relative to the project root.
2. **Upload**: Images are uploaded to the Gemini File API. The resulting `fileUri` is cached locally with a timestamp.
3. **Transformation**: The script creates a temporary JSONL where `text` parts containing file tags are replaced with `fileData` parts. It also wraps the requests into the `request: { model, contents: [...] }` structure.
4. **Submission**: The transformed JSONL is uploaded to Gemini, and `ai.batches.create` is called.
5. **Polling**: The script enters a loop, calling `ai.batches.get` until the state is `SUCCEEDED`, `FAILED`, or `CANCELLED`.
6. **Download**: Once successful, it uses `ai.files.download` to save the output file to your disk.
