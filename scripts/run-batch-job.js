#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI, JobState } from '@google/genai';

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_POLL_INTERVAL_MS = 10_000; // 10 seconds
const DEFAULT_TIMEOUT_MINUTES = 24 * 60; // 24 hours
const DEFAULT_CLEAR_STATES = [JobState.JOB_STATE_QUEUED, JobState.JOB_STATE_RUNNING];
const CACHE_FILE = path.join(process.cwd(), '.gemini-file-cache.json');
const FILE_EXPIRATION_MS = 47 * 60 * 60 * 1000; // 47 hours (Gemini files expire in 48h)

const USAGE = `Usage: node scripts/run-batch-job.js --file [FILE NAME] [options]

Required (unless using --poll or maintenance mode):
  --file <path>             Path to the JSONL batch request file that was exported from the app.
                            (Skip this when using --poll or the maintenance flags below.)

Optional:
  --model <name>            Gemini model to run (default: gemini-3-flash).
  --display <name>          Friendly name that will be applied to the batch job.
  --output <path>           Destination file for the downloaded job results.
  --poll-interval <ms>      How often to poll for job status (default: 10000).
  --timeout <minutes>       How long to wait for completion before giving up (default: 1440).
  --api-key <key>           Override GEMINI_API_KEY/API_KEY for this run.
  --poll <job>              Monitor an existing batch job instead of creating a new one.
Maintenance mode:
  --list                    List existing batch jobs (honors --state).
  --delete <job>            Delete a batch job by name (batches/... or short id).
  --clear                   Delete all jobs in the pending/running states (use --state to override).
  --state <states>          Comma-separated states to filter when listing or clearing (e.g. queued,running).
  --help                    Show this help text.
`;

const parsedArgs = parseCommandLineArgs(process.argv.slice(2));
const isPollMode = Boolean(parsedArgs.poll);
const listMode = Boolean(parsedArgs.list);
const deleteJobName = parsedArgs.delete;
const clearMode = Boolean(parsedArgs.clear);
const maintenanceMode = listMode || Boolean(deleteJobName) || clearMode;
const requiresFileArgument = !isPollMode && !maintenanceMode;
if (parsedArgs.help || (requiresFileArgument && !parsedArgs.file)) {
  console.log(USAGE);
  process.exit(parsedArgs.help ? 0 : 1);
}
if (maintenanceMode && (parsedArgs.file || isPollMode)) {
  console.error('Maintenance commands cannot be mixed with --file or --poll.');
  process.exit(1);
}
let requestedStates;
try {
  requestedStates = parseStateFilters(parsedArgs.state);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const apiKey = parsedArgs.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.API_KEY;
if (!apiKey) {
  console.error('Set GEMINI_API_KEY or API_KEY (or pass --api-key) before running this script.');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
if (maintenanceMode) {
  if (listMode) {
    await listJobs(requestedStates);
  } else if (deleteJobName) {
    await deleteBatchJob(deleteJobName);
  } else if (clearMode) {
    await clearPendingJobs(requestedStates);
  }
  process.exit(0);
}

let inputFile;
if (!isPollMode) {
  inputFile = path.resolve(parsedArgs.file);
  if (!fs.existsSync(inputFile)) {
    console.error(`Batch request file not found: ${inputFile}`);
    process.exit(1);
  }
}

const displayName = parsedArgs.display
  ?? (parsedArgs.file
    ? `Batch job for ${path.basename(parsedArgs.file)}`
    : parsedArgs.poll
      ? `Batch job ${parsedArgs.poll}`
      : 'Gemini batch job');
const pollIntervalMs = Math.max(1_000, Number(parsedArgs.pollInterval ?? DEFAULT_POLL_INTERVAL_MS));
const timeoutMinutes = Number(parsedArgs.timeout ?? DEFAULT_TIMEOUT_MINUTES);
const timeoutMs = Math.max(0, timeoutMinutes * 60 * 1000);

const outputFile = parsedArgs.output
  ? path.resolve(parsedArgs.output)
  : buildDefaultOutputPath(parsedArgs.file, parsedArgs.poll);

if (isPollMode) {
  await pollExistingJob(parsedArgs.poll);
} else {
  const selectedModel = normalizeModelName(parsedArgs.model ?? DEFAULT_MODEL);
  
  // Pre-process file to handle uploads if present
  const processedInputFile = await uploadReferencedFiles(inputFile, ai);
  
  const { normalizedFilePath, createdTempFile } = normalizeBatchJsonl(processedInputFile, selectedModel);
  let cleanupListener;
  if (createdTempFile || processedInputFile !== inputFile) {
    cleanupListener = () => {
      try {
        if (createdTempFile) fs.rmSync(normalizedFilePath, { force: true });
        if (processedInputFile !== inputFile) fs.rmSync(processedInputFile, { force: true });
      } catch (error) {
        // best-effort cleanup
      }
    };
    process.on('exit', cleanupListener);
  }
  if (createdTempFile) {
    console.log(`Transformed ${inputFile} into Gemini Batch JSONL at ${normalizedFilePath}`);
  } else {
    console.log(`Using ${inputFile} as Gemini Batch JSONL input directly.`);
  }

  try {
    await run(normalizedFilePath, selectedModel);
  } finally {
    if (createdTempFile) {
      fs.rmSync(normalizedFilePath, { force: true });
    }
    if (processedInputFile !== inputFile) {
      fs.rmSync(processedInputFile, { force: true });
    }
    if (cleanupListener) {
      process.off('exit', cleanupListener);
    }
  }
}

async function uploadReferencedFiles(jsonlPath, ai) {
  console.log('Scanning for file references in JSONL...');
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  let modifiedLines = [];
  let uploadCount = 0;
  let skipCount = 0;
  const fileCache = loadFileCache();

  for (let i = 0; i < lines.length; i++) {
    let lineObj;
    try {
      lineObj = JSON.parse(lines[i]);
    } catch (e) {
      console.error(`Skipping invalid JSON on line ${i + 1}`);
      continue;
    }

    // Deep traverse to find parts with [[FILE:...]]
    // We assume standard structure: body.contents[].parts[].text
    if (lineObj.body && lineObj.body.contents) {
      for (const content of lineObj.body.contents) {
        if (content.parts) {
          const newParts = [];
          for (const part of content.parts) {
            if (part.text && typeof part.text === 'string' && part.text.startsWith('[[FILE:') && part.text.endsWith(']]')) {
              // Extract path
              const relativePath = part.text.substring(7, part.text.length - 2);
              const absolutePath = path.resolve(process.cwd(), relativePath);

              if (!fs.existsSync(absolutePath)) {
                throw new Error(`Referenced file not found: ${absolutePath}`);
              }

              let fileUri;
              const cached = fileCache[absolutePath];
              const now = Date.now();
              
              if (cached && (now - cached.timestamp < FILE_EXPIRATION_MS)) {
                fileUri = cached.uri;
                skipCount++;
              } else {
                console.log(`Uploading image: ${relativePath}...`);
                const uploadResult = await ai.files.upload({
                  file: absolutePath,
                  config: { 
                    mimeType: 'image/jpeg',
                    displayName: relativePath
                  }
                });
                fileUri = uploadResult.uri;
                if (!fileUri) {
                  throw new Error(`Upload failed: no URI returned for ${relativePath}`);
                }
                fileCache[absolutePath] = {
                  uri: fileUri,
                  timestamp: now
                };
                uploadCount++;
              }

              // Replace the text part with a fileData part
              newParts.push({
                fileData: {
                  mimeType: 'image/jpeg',
                  fileUri: fileUri
                }
              });
            } else {
              newParts.push(part);
            }
          }
          content.parts = newParts;
        }
      }
    }
    modifiedLines.push(JSON.stringify(lineObj));
  }

  if (uploadCount > 0 || skipCount > 0) {
    if (uploadCount > 0) {
      console.log(`Uploaded ${uploadCount} new files.`);
      saveFileCache(fileCache);
    }
    if (skipCount > 0) {
      console.log(`Skipped ${skipCount} already uploaded files (using cache).`);
    }
    const newPath = jsonlPath.replace('.jsonl', '.with-uploads.jsonl');
    fs.writeFileSync(newPath, modifiedLines.join(os.EOL));
    return newPath;
  }
  
  return jsonlPath;
}

function loadFileCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      // Clean up expired entries on load
      const now = Date.now();
      const clean = {};
      let expiredCount = 0;
      for (const [path, entry] of Object.entries(data)) {
        if (now - entry.timestamp < FILE_EXPIRATION_MS) {
          clean[path] = entry;
        } else {
          expiredCount++;
        }
      }
      if (expiredCount > 0) {
        console.log(`Removed ${expiredCount} expired entries from file cache.`);
      }
      return clean;
    }
  } catch (e) {
    console.warn('Could not load file cache, starting fresh.');
  }
  return {};
}

function saveFileCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn('Could not save file cache:', e.message);
  }
}

async function run(uploadFile, modelName) {
  console.log('Uploading', inputFile, 'to Gemini File API...');
  const uploaded = await ai.files.upload({
    file: uploadFile,
    config: {
      displayName: `Batch input ${path.basename(inputFile)}`,
      mimeType: 'application/jsonl',
    },
  });

  if (!uploaded.name) {
    throw new Error('Gemini did not return a resource name for the uploaded file.');
  }

  console.log('Uploaded file resource:', uploaded.name);

  const model = modelName;
  console.log(`Creating batch job with model ${model}...`);
  const batchJob = await ai.batches.create({
    model,
    src: {
      fileName: uploaded.name,
    },
    config: {
      displayName,
    },
  });

  if (!batchJob.name) {
    throw new Error('Batch API did not return a job name.');
  }

  console.log(`Batch job created: ${batchJob.name} (state: ${batchJob.state ?? 'unknown'})`);

  const finalJob = await waitForCompletion(batchJob.name, pollIntervalMs, timeoutMs);
  await handleCompletedJob(finalJob);
}

async function pollExistingJob(jobName) {
  const normalizedName = normalizeJobName(jobName);
  console.log(`Polling existing batch job ${normalizedName}...`);
  const finalJob = await waitForCompletion(normalizedName, pollIntervalMs, timeoutMs);
  await handleCompletedJob(finalJob);
}

async function waitForCompletion(jobName, intervalMs, timeoutMs) {
  const exitStates = new Set([
    JobState.JOB_STATE_SUCCEEDED,
    JobState.JOB_STATE_FAILED,
    JobState.JOB_STATE_CANCELLED,
  ]);
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
  let job = await ai.batches.get({ name: jobName });

  while (!exitStates.has(job.state ?? JobState.JOB_STATE_UNSPECIFIED)) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for batch job to finish.');
    }
    console.log(`Job ${jobName} is ${job.state}. Waiting ${intervalMs}ms before next poll...`);
    await delay(intervalMs);
    job = await ai.batches.get({ name: jobName });
  }

  console.log(`Job ${jobName} finished with state ${job.state}.`);
  return job;
}

async function handleCompletedJob(finalJob) {
  if ([JobState.JOB_STATE_FAILED, JobState.JOB_STATE_CANCELLED].includes(finalJob.state)) {
    console.error('Batch job did not complete successfully:', finalJob.error ?? 'No error details.');
    process.exit(1);
  }

  const resultFile = finalJob.dest?.fileName;
  if (!resultFile) {
    console.error('Job completed but there is no downloadable file name in the response.');
    process.exit(1);
  }

  console.log('Downloading result file to', outputFile);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  await ai.files.download({
    file: resultFile,
    downloadPath: outputFile,
  });

  console.log('Batch job results saved to', outputFile);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCommandLineArgs(argv) {
  const result = {};
  const booleanFlags = new Set(['list', 'clear']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help') {
      result.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.replace(/^--/, '');
    if (booleanFlags.has(key)) {
      result[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      result[toCamelCase(key)] = next;
      i += 1;
    } else {
      console.error(`Flag ${token} requires a value.`);
      console.log(USAGE);
      process.exit(1);
    }
  }
  return result;
}

function toCamelCase(key) {
  return key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function normalizeBatchJsonl(sourcePath, fallbackModel) {
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`Batch request file ${sourcePath} is empty.`);
  }

  let needsConversion = false;
  const normalizedLines = lines.map((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse JSON on line ${index + 1}: ${message}`);
    }
    if (isLegacyBatchRequest(parsed)) {
      needsConversion = true;
      return JSON.stringify(convertLegacyBatchRequest(parsed, fallbackModel, index + 1));
    }
    return line;
  });

  if (!needsConversion) {
    return { normalizedFilePath: sourcePath, createdTempFile: false };
  }

  const normalizedFilePath = path.join(
    os.tmpdir(),
    `gemini-batch-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`,
  );
  fs.writeFileSync(normalizedFilePath, normalizedLines.join(os.EOL));
  return { normalizedFilePath, createdTempFile: true };
}

function isLegacyBatchRequest(obj) {
  return Boolean(obj && typeof obj === 'object' && obj.body && Array.isArray(obj.body.contents));
}

function convertLegacyBatchRequest(request, fallbackModel, lineNumber) {
  const contents = request.body?.contents;
  if (!Array.isArray(contents) || contents.length === 0) {
    throw new Error(`Line ${lineNumber} has no contents to convert.`);
  }
  const resolvedModel = extractModelFromUrl(request.url) ?? fallbackModel ?? DEFAULT_MODEL;
  const model = normalizeModelName(resolvedModel);
  
  const parts = [];
  for (const content of contents) {
    if (content.parts && Array.isArray(content.parts)) {
      for (const part of content.parts) {
        parts.push(convertContentPart(part, lineNumber, parts.length + 1));
      }
    }
  }

  if (parts.length === 0) {
    throw new Error(`Line ${lineNumber} has no valid parts after conversion.`);
  }

  // Gemini batch expects an inlined request: contents is an array of messages, each with parts.
  const normalized = {
    key: request.custom_id ?? `line-${lineNumber}`,
    request: {
      model,
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
    },
  };
  return normalized;
}

function convertContentPart(part, lineNumber, partIndex) {
  const converted = {};
  if (typeof part.text === 'string') {
    converted.text = part.text;
  }
  if (part.inlineData) {
    converted.inlineData = part.inlineData;
  }
  if (part.fileData) {
    converted.fileData = part.fileData;
  }
  if (!converted.text && !converted.inlineData && !converted.fileData) {
    throw new Error(`Unsupported content part at line ${lineNumber}, part ${partIndex}.`);
  }
  return converted;
}

function extractModelFromUrl(url) {
  if (typeof url !== 'string') {
    return undefined;
  }
  const match = url.match(/models\/([^:]+):/);
  return match ? match[1] : undefined;
}

function normalizeModelName(name) {
  const modelId = typeof name === 'string' && name.length > 0 ? name : DEFAULT_MODEL;
  return modelId.startsWith('models/') ? modelId : `models/${modelId}`;
}

function normalizeJobName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Provide a batch job name to poll.');
  }
  return name.startsWith('batches/') ? name : `batches/${name}`;
}

function buildDefaultOutputPath(fileArg, pollJobName) {
  const base = fileArg
    ? path.parse(fileArg).name
    : pollJobName
      ? sanitizeName(pollJobName)
      : 'batch';
  return path.join(process.cwd(), `${base}-batch-results.jsonl`);
}

function sanitizeName(name) {
  const tail = name.split('/').pop() ?? name;
  return tail.replace(/[^A-Za-z0-9_.-]/g, '_') || 'batch';
}

async function listJobs(stateFilters) {
  const filterSet = new Set(stateFilters ?? []);
  console.log('Listing batch jobs', filterSet.size ? `(filtered by ${[...filterSet].join(', ')})` : '(no filter)');
  const jobs = [];
  let pageToken;
  do {
    const response = await ai.batches.list(pageToken ? { pageToken } : {});
    const pageJobs = Array.isArray(response?.batches) ? response.batches : [];
    for (const job of pageJobs) {
      const jobState = job.state ?? 'JOB_STATE_UNSPECIFIED';
      if (filterSet.size === 0 || filterSet.has(jobState)) {
        const display = job.displayName ? ` (${job.displayName})` : '';
        console.log(`[${jobState}] ${job.name ?? '<no-name>'}${display}`);
        jobs.push(job);
      }
    }
    pageToken = response?.nextPageToken;
  } while (pageToken);
  console.log(`Found ${jobs.length} job(s).`);
  return jobs;
}

async function deleteBatchJob(jobName) {
  const normalizedName = normalizeJobName(jobName);
  console.log(`Deleting batch job ${normalizedName}...`);
  await ai.batches.delete({ name: normalizedName });
  console.log(`Deleted batch job ${normalizedName}.`);
}

async function clearPendingJobs(stateFilters) {
  const targets = stateFilters?.length ? stateFilters : DEFAULT_CLEAR_STATES;
  if (targets.length === 0) {
    console.log('No states configured for clearing jobs. Nothing to do.');
    return;
  }
  const jobs = await listJobs(targets);
  if (jobs.length === 0) {
    console.log('No jobs matched the requested states.');
    return;
  }
  for (const job of jobs) {
    if (!job.name) {
      console.warn('Skipping job with missing name:', job);
      continue;
    }
    try {
      await deleteBatchJob(job.name);
    } catch (error) {
      console.error(`Failed to delete ${job.name}:`, error instanceof Error ? error.message : String(error));
    }
  }
}

function parseStateFilters(value) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const states = value.split(',').map((token) => token.trim()).filter(Boolean).map(coerceToJobState).filter(Boolean);
  if (states.length === 0) {
    throw new Error(`No valid job states found in --state value "${value}".`);
  }
  return Array.from(new Set(states));
}

function coerceToJobState(token) {
  if (!token) {
    return undefined;
  }
  const upper = token.trim().toUpperCase();
  if (upper in JobState) {
    return JobState[upper];
  }
  const prefixed = upper.startsWith('JOB_STATE_') ? upper : `JOB_STATE_${upper}`;
  return prefixed in JobState ? JobState[prefixed] : undefined;
}
