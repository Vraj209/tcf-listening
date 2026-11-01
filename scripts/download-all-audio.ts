#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export type AudioSource = {
  testNumber: number; questionNumber: number; path: string; sha256: string;
  sizeBytes: number; audioDuration: number; audioMimeType: string;
  sourceUrl?: string; localSource?: string;
};
export type SourceManifest = { version: 1; tests: number; expectedQuestions: Record<string, number>; files: AudioSource[] };
type ItemResult = { testNumber: number; questionNumber: number; path: string; status: 'downloaded' | 'copied' | 'cached' | 'failed'; error?: string };
export type DownloadReport = { generatedAt: string; total: number; complete: boolean; results: ItemResult[] };
type DownloadOptions = { directory?: string; manifest?: string; projectRoot?: string; concurrency?: number; log?: (message: string) => void };
type OneOptions = { cacheRoot: string; projectRoot: string; fetchImpl?: typeof fetch };

const MAX_BYTES = 512 * 1024 * 1024;
const HELP = `Download the verified TCF Tests 1–43 audio collection.

  npm run download:audio
  npm run download:audio -- --directory ./audio-import

Options:
  --manifest PATH   Source manifest (default: data/all-tests-audio-sources.json).
  --directory PATH  Cache within the current project (default: ./audio-import).
  --help            Show this help.

Existing recordings are reused only when their size and SHA-256 match.
Conflicting files are preserved and reported. No database or storage writes occur.
Test 1 can be copied from the supplied public/audio/test-01 files.
`;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const integer = (value: unknown, minimum: number, maximum: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

export function safeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || isAbsolute(value) || /^[a-z]:/i.test(value)) throw new Error('Manifest paths must be portable relative paths.');
  if (value.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) throw new Error('Manifest paths cannot contain empty, hidden, or traversal segments.');
  return value;
}

/** Only the observed public audio source provider may receive download requests. */
export function allowedSourceUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Audio source URL is missing.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Audio source URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname)) {
    throw new Error('Audio source must use the observed public HTTPS audio storage provider.');
  }
  return url.href;
}

export function validateSourceManifest(value: unknown): SourceManifest {
  if (!record(value) || value.version !== 1 || !integer(value.tests, 1, 43) || !record(value.expectedQuestions) || !Array.isArray(value.files)) throw new Error('Invalid audio source manifest.');
  const expectedQuestions: Record<string, number> = {};
  for (const [key, count] of Object.entries(value.expectedQuestions)) {
    if (!/^[1-9]\d*$/.test(key) || !integer(Number(key), 1, value.tests) || !integer(count, 1, 999)) throw new Error('Invalid expected question count.');
    expectedQuestions[key] = count;
  }
  if (Object.keys(expectedQuestions).length !== value.tests) throw new Error('Every manifest test must have an explicit question count.');
  const identities = new Set<string>();
  const paths = new Set<string>();
  const files: AudioSource[] = [];
  for (const raw of value.files) {
    if (!record(raw) || !integer(raw.testNumber, 1, value.tests) || !integer(raw.questionNumber, 1, expectedQuestions[String(raw.testNumber)] ?? 0) ||
        typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256) || !integer(raw.sizeBytes, 1, MAX_BYTES) ||
        typeof raw.audioDuration !== 'number' || !Number.isFinite(raw.audioDuration) || raw.audioDuration <= 0 ||
        typeof raw.audioMimeType !== 'string' || !/^audio\/[a-z0-9.+-]+$/i.test(raw.audioMimeType)) throw new Error('Invalid audio source record.');
    const path = safeRelativePath(raw.path);
    const match = /^test-(\d{2})\/question-(\d{2,3})\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac)$/.exec(path);
    if (!match || Number(match[1]) !== raw.testNumber || Number(match[2]) !== raw.questionNumber) throw new Error('Audio path does not match its test/question identity.');
    const identity = `${raw.testNumber}:${raw.questionNumber}`;
    if (identities.has(identity) || paths.has(path)) throw new Error('Duplicate test/question assignment or audio path.');
    identities.add(identity); paths.add(path);
    const sourceUrl = raw.sourceUrl === undefined ? undefined : allowedSourceUrl(raw.sourceUrl);
    const localSource = raw.localSource === undefined ? undefined : safeRelativePath(raw.localSource);
    if (!sourceUrl && !localSource) throw new Error('Every recording needs an observed source URL or a supplied local source.');
    files.push({ testNumber: raw.testNumber, questionNumber: raw.questionNumber, path, sha256: raw.sha256, sizeBytes: raw.sizeBytes, audioDuration: raw.audioDuration, audioMimeType: raw.audioMimeType, ...(sourceUrl ? { sourceUrl } : {}), ...(localSource ? { localSource } : {}) });
  }
  for (const [test, count] of Object.entries(expectedQuestions)) for (let question = 1; question <= count; question++) {
    if (!identities.has(`${test}:${question}`)) throw new Error(`Manifest is missing Test ${test}, Question ${question}.`);
  }
  files.sort((a, b) => a.testNumber - b.testNumber || a.questionNumber - b.questionNumber);
  return { version: 1, tests: value.tests, expectedQuestions, files };
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function ensureInsideDirectory(root: string, directory: string): Promise<string> {
  if (!inside(root, directory)) throw new Error('Directory escapes the current project.');
  let ancestor = directory;
  while (true) {
    try {
      if (!inside(root, await realpath(ancestor))) throw new Error('Directory follows a symlink outside the current project.');
      break;
    } catch (error) {
      if (!(record(error) && error.code === 'ENOENT')) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error('Could not resolve the destination directory.');
      ancestor = parent;
    }
  }
  await mkdir(directory, { recursive: true });
  const actual = await realpath(directory);
  if (!inside(root, actual)) throw new Error('Directory follows a symlink outside the current project.');
  return actual;
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporary = resolve(dirname(path), `.tcf-report-${randomUUID()}.part`);
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function checkedTarget(root: string, path: string, createParent: boolean): Promise<string> {
  const target = resolve(root, safeRelativePath(path));
  if (!inside(root, target)) throw new Error('Audio path escapes the selected directory.');
  if (createParent) await ensureInsideDirectory(root, dirname(target));
  const actualParent = await realpath(dirname(target));
  if (!inside(root, actualParent)) throw new Error('Audio path follows a symlink outside the selected directory.');
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Audio file cannot be a symbolic link.'); }
  catch (error) { if (!(record(error) && error.code === 'ENOENT')) throw error; }
  return target;
}

/** Hash files as streams so large WAV recordings do not fill memory. */
export async function verifyAudioFile(path: string, expected: Pick<AudioSource, 'sha256' | 'sizeBytes'>): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size !== expected.sizeBytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex') === expected.sha256;
  } catch (error) { if (record(error) && error.code === 'ENOENT') return false; throw error; }
}

class TransferError extends Error {
  constructor(message: string, readonly retryable = false, readonly retryDelay = 1000) { super(message); }
}

async function fetchAudio(source: AudioSource, destination: string, fetchImpl: typeof fetch): Promise<void> {
  let url = allowedSourceUrl(source.sourceUrl);
  const signal = AbortSignal.timeout(60_000);
  let response: Response | undefined;
  for (let redirect = 0; redirect <= 3; redirect++) {
    response = await fetchImpl(url, { signal, redirect: 'manual', headers: { Accept: 'audio/*, application/octet-stream;q=0.8', 'Accept-Encoding': 'identity' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirect === 3) throw new TransferError('Audio source returned too many redirects.');
    url = allowedSourceUrl(new URL(location, url).href);
    response = undefined;
  }
  if (!response) throw new TransferError('Audio source did not return a response.');
  if (!response.ok) {
    await response.body?.cancel();
    const retrySeconds = Number(response.headers.get('retry-after'));
    throw new TransferError(`Audio source returned HTTP ${response.status}.`, response.status === 429 || response.status >= 500, Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.min(10_000, retrySeconds * 1000) : 1000);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) !== source.sizeBytes) { await response.body?.cancel(); throw new TransferError('Audio source size changed; expected recording was not downloaded.'); }
  if (!response.body) throw new TransferError('Audio source returned an empty body.');
  let bytes = 0;
  const hash = createHash('sha256');
  const verifier = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > source.sizeBytes) { callback(new TransferError('Audio source exceeded its verified size.')); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), verifier, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
  if (bytes !== source.sizeBytes || hash.digest('hex') !== source.sha256) throw new TransferError('Audio source checksum changed; recording was not accepted.');
}

async function installExclusive(part: string, target: string, source: AudioSource): Promise<void> {
  try { await link(part, target); }
  catch (error) {
    if (record(error) && error.code === 'EEXIST' && await verifyAudioFile(target, source)) return;
    throw error;
  }
}

export async function downloadOne(source: AudioSource, options: OneOptions): Promise<ItemResult> {
  const identity = { testNumber: source.testNumber, questionNumber: source.questionNumber, path: source.path };
  let part: string | undefined;
  try {
    const target = await checkedTarget(options.cacheRoot, source.path, true);
    try {
      await stat(target);
      if (await verifyAudioFile(target, source)) return { ...identity, status: 'cached' };
      throw new TransferError('Existing file has a different checksum. It was preserved; move it aside before retrying.');
    } catch (error) { if (!(record(error) && error.code === 'ENOENT')) throw error; }
    part = resolve(dirname(target), `.tcf-download-${randomUUID()}.part`);
    if (source.localSource) {
      let supplied: string | undefined;
      try { supplied = await checkedTarget(options.projectRoot, source.localSource, false); }
      catch (error) { if (!(record(error) && error.code === 'ENOENT')) throw error; }
      if (supplied && await verifyAudioFile(supplied, source)) {
        await copyFile(supplied, part);
        if (!await verifyAudioFile(part, source)) throw new TransferError('Supplied audio changed while it was copied.');
        await installExclusive(part, target, source);
        return { ...identity, status: 'copied' };
      }
      if (!source.sourceUrl) throw new TransferError(`The supplied local recording is missing or has changed: ${source.localSource}. Restore it from the original project ZIP.`);
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await fetchAudio(source, part, options.fetchImpl ?? fetch); break; }
      catch (error) {
        await rm(part, { force: true });
        if ((error instanceof TransferError && !error.retryable) || attempt === 3) throw error;
        await delay(error instanceof TransferError ? error.retryDelay : attempt * 1000);
      }
    }
    await installExclusive(part, target, source);
    return { ...identity, status: 'downloaded' };
  } catch (error) {
    // Do not log source URLs, SDK internals, environment values, or credentials.
    return { ...identity, status: 'failed', error: error instanceof TransferError ? error.message : 'Recording could not be saved. Check the source connection, directory permissions, and available disk space.' };
  } finally { if (part) await rm(part, { force: true }).catch(() => {}); }
}

export async function downloadAll(options: DownloadOptions = {}): Promise<{ report: DownloadReport; importManifest: string; directory: string }> {
  const projectRoot = await realpath(options.projectRoot ?? process.cwd());
  const directory = resolve(projectRoot, options.directory ?? 'audio-import');
  if (!inside(projectRoot, directory)) throw new Error('The audio cache must be inside the current project.');
  const cacheRoot = await ensureInsideDirectory(projectRoot, directory);
  const manifestPath = resolve(projectRoot, options.manifest ?? 'data/all-tests-audio-sources.json');
  const manifest = validateSourceManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const log = options.log ?? console.log;
  log(`Checking ${manifest.files.length} recordings across ${manifest.tests} tests.`);
  const results: ItemResult[] = [];
  let next = 0;
  const workers = Math.max(1, Math.min(3, Math.floor(options.concurrency ?? 3)));
  async function worker() {
    while (next < manifest.files.length) {
      const source = manifest.files[next++];
      const result = await downloadOne(source, { cacheRoot, projectRoot });
      results.push(result);
      if (result.status === 'failed') log(`Failed: Test ${source.testNumber}, Question ${source.questionNumber}. ${result.error}`);
      else if (results.length % 50 === 0 || results.length === manifest.files.length) log(`Checked ${results.length}/${manifest.files.length} recordings.`);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  results.sort((a, b) => a.testNumber - b.testNumber || a.questionNumber - b.questionNumber);
  const complete = results.length === manifest.files.length && results.every(result => result.status !== 'failed');
  const report: DownloadReport = { generatedAt: new Date().toISOString(), total: manifest.files.length, complete, results };
  const importManifest = resolve(cacheRoot, 'import-manifest.json');
  await writeJsonAtomically(resolve(cacheRoot, 'download-report.json'), report);
  if (complete) {
    await writeJsonAtomically(importManifest, { expectedQuestions: manifest.expectedQuestions, files: manifest.files.map(source => ({ path: source.path, testNumber: source.testNumber, questionNumber: source.questionNumber, sha256: source.sha256 })) });
    log(`All ${results.length} recordings verified. Import manifest: ${relative(projectRoot, importManifest)}`);
  } else {
    // A previous successful manifest must not accidentally authorize a later incomplete batch.
    await rm(importManifest, { force: true });
    log(`${results.filter(result => result.status === 'failed').length} recording(s) failed. No cloud import was started. Retry the same command to resume.`);
  }
  return { report, importManifest, directory: cacheRoot };
}

export async function runDownloadCli(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { directory: { type: 'string' }, manifest: { type: 'string' }, help: { type: 'boolean', default: false } }, strict: true, allowPositionals: false });
  if (values.help) { console.log(HELP); return; }
  const { report } = await downloadAll({ directory: values.directory, manifest: values.manifest });
  if (!report.complete) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDownloadCli().catch(error => { console.error(error instanceof Error ? error.message : 'Audio download failed.'); process.exitCode = 1; });
}
