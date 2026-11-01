import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const AUDIO_TYPES: Record<string, { mime: string; formats: string[] }> = {
  '.mp3': { mime: 'audio/mpeg', formats: ['mp3'] },
  '.m4a': { mime: 'audio/mp4', formats: ['mov', 'mp4', 'm4a'] },
  '.aac': { mime: 'audio/aac', formats: ['aac'] },
  '.wav': { mime: 'audio/wav', formats: ['wav'] },
  '.ogg': { mime: 'audio/ogg', formats: ['ogg'] },
  '.oga': { mime: 'audio/ogg', formats: ['ogg'] },
  '.opus': { mime: 'audio/ogg', formats: ['ogg'] },
  '.webm': { mime: 'audio/webm', formats: ['matroska', 'webm'] },
  '.flac': { mime: 'audio/flac', formats: ['flac'] },
};

export type Mapping = { path: string; testNumber: number; questionNumber: number; sha256?: string };
export type AudioFile = Mapping & {
  absolutePath: string;
  filename: string;
  mimeType: string;
  duration: number;
  size: number;
  sha256: string;
};
export type MissingQuestions = {
  testNumber: number;
  numbers: number[];
  basis: 'manifest-expected-count' | 'observed-range';
};
export type ImportPlan = {
  files: AudioFile[];
  missing: MissingQuestions[];
  ignored: string[];
  errors: { path: string; message: string }[];
};
export type PlanInput = { directory?: string; manifest?: string; files?: string[] };

export function validateNumbers(testNumber: unknown, questionNumber: unknown): void {
  if (!Number.isInteger(testNumber) || Number(testNumber) < 1 || Number(testNumber) > 43) {
    throw new Error('Test number must be an integer from 1 to 43.');
  }
  if (!Number.isInteger(questionNumber) || Number(questionNumber) < 1 || Number(questionNumber) > 10000) {
    throw new Error('Question number must be an integer from 1 to 10000.');
  }
}

// A question number must be explicit in the filename. Numeric-only names never imply order.
export function detectMapping(filePath: string): Mapping {
  const normalized = filePath.replaceAll('\\', '/');
  const filename = normalized.split('/').at(-1) ?? '';
  const tests = [...normalized.matchAll(/(?:^|[\/ _.-])test[-_ ]*0*(\d+)(?=$|[\/ _.-])/gi)]
    .map((match) => Number(match[1]));
  const questions = [...filename.matchAll(/(?:^|[ _.-])question[-_ ]*0*(\d+)(?=$|[ _.-])/gi)]
    .map((match) => Number(match[1]));
  if (tests.length === 0 || questions.length !== 1 || new Set(tests).size !== 1) {
    throw new Error('Cannot map unambiguously. Use test-01/question-01.mp3 or an explicit manifest.');
  }
  const testNumber = tests[0];
  const questionNumber = questions[0];
  validateNumbers(testNumber, questionNumber);
  return { path: filePath, testNumber, questionNumber };
}

export function parseManifest(value: unknown): { files: Mapping[]; expectedQuestions: Record<string, number> } {
  if (!value || typeof value !== 'object' || !('files' in value) || !Array.isArray(value.files)) {
    throw new Error('Manifest must contain a files array.');
  }
  if (value.files.length === 0) throw new Error('Manifest contains no files.');
  const files = value.files.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('path' in entry) || typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new Error('Each manifest file needs a non-empty relative path.');
    }
    if (!('testNumber' in entry) || !('questionNumber' in entry)) throw new Error('Manifest file is missing its test or question number.');
    validateNumbers(entry.testNumber, entry.questionNumber);
    if (isAbsolute(entry.path) || /^[a-z]:[\\/]/i.test(entry.path) || entry.path.includes('\\')) {
      throw new Error('Manifest paths must use relative forward-slash paths.');
    }
    if ('sha256' in entry && (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))) {
      throw new Error('Manifest SHA-256 must be a lowercase 64-character hash.');
    }
    return { path: entry.path, testNumber: Number(entry.testNumber), questionNumber: Number(entry.questionNumber),
      ...('sha256' in entry ? { sha256: entry.sha256 as string } : {}) };
  });
  const expectedQuestions: Record<string, number> = {};
  if ('expectedQuestions' in value) {
    if (!value.expectedQuestions || typeof value.expectedQuestions !== 'object' || Array.isArray(value.expectedQuestions)) {
      throw new Error('expectedQuestions must be an object keyed by test number.');
    }
    for (const [key, count] of Object.entries(value.expectedQuestions)) {
      if (!/^\d+$/.test(key)) throw new Error('expectedQuestions keys must be test numbers.');
      validateNumbers(Number(key), count);
      if (String(Number(key)) in expectedQuestions) throw new Error('Duplicate test in expectedQuestions.');
      expectedQuestions[String(Number(key))] = Number(count);
    }
  }
  return { files, expectedQuestions };
}

export function duplicateMappings(files: Mapping[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const file of files) {
    const key = `${file.testNumber}:${file.questionNumber}`;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

export function findMissing(files: Mapping[], expected: Record<string, number> = {}): MissingQuestions[] {
  const testNumbers = new Set([...files.map((file) => file.testNumber), ...Object.keys(expected).map(Number)]);
  return [...testNumbers].sort((a, b) => a - b).flatMap((testNumber) => {
    const present = new Set(files.filter((file) => file.testNumber === testNumber).map((file) => file.questionNumber));
    const maximum = expected[String(testNumber)] ?? Math.max(0, ...present);
    const numbers = Array.from({ length: maximum }, (_, i) => i + 1).filter((number) => !present.has(number));
    return numbers.length ? [{ testNumber, numbers, basis: expected[String(testNumber)] !== undefined ? 'manifest-expected-count' as const : 'observed-range' as const }] : [];
  });
}

export async function safeFile(baseDirectory: string, inputPath: string): Promise<string> {
  const root = await realpath(baseDirectory);
  const candidate = await realpath(resolve(root, inputPath));
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error('File is outside the input directory (including symlink targets).');
  }
  if (!(await stat(candidate)).isFile()) throw new Error('Path is not a regular file.');
  return candidate;
}

async function walk(directory: string, root = directory): Promise<{ files: string[]; ignored: string[] }> {
  const files: string[] = [];
  const ignored: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = resolve(directory, entry.name);
    const shortPath = relative(root, absolutePath);
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
      ignored.push(shortPath);
    } else if (entry.isDirectory()) {
      const child = await walk(absolutePath, root);
      files.push(...child.files);
      ignored.push(...child.ignored);
    } else if (entry.isFile() && AUDIO_TYPES[extname(entry.name).toLowerCase()]) {
      files.push(shortPath);
    } else {
      ignored.push(shortPath);
    }
  }
  return { files, ignored };
}

type Probe = {
  format?: { duration?: string; format_name?: string };
  streams?: { codec_type?: string; duration?: string; disposition?: { attached_pic?: number } }[];
};

export function validateProbe(extension: string, probe: Probe): { mimeType: string; duration: number } {
  const type = AUDIO_TYPES[extension.toLowerCase()];
  if (!type) throw new Error(`Unsupported audio extension: ${extension || '(none)'}.`);
  const formats = probe.format?.format_name?.split(',') ?? [];
  if (!formats.some((format) => type.formats.includes(format))) throw new Error('File content does not match its audio extension.');
  if (!probe.streams?.some((stream) => stream.codec_type === 'audio')) throw new Error('File contains no audio stream.');
  if (probe.streams.some((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic)) throw new Error('Video files are not supported.');
  const duration = Number(probe.format?.duration ?? probe.streams.find((stream) => stream.codec_type === 'audio')?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio duration could not be determined.');
  return { mimeType: type.mime, duration };
}

export async function inspectAudio(absolutePath: string): Promise<Pick<AudioFile, 'filename' | 'mimeType' | 'duration' | 'size' | 'sha256'>> {
  const fileStat = await lstat(absolutePath);
  if (!fileStat.isFile() || fileStat.size === 0) throw new Error('Audio must be a non-empty regular file.');
  if (fileStat.size > 512 * 1024 * 1024) throw new Error('Audio exceeds the 512 MiB per-file limit.');
  if (!AUDIO_TYPES[extname(absolutePath).toLowerCase()]) throw new Error('Unsupported audio format.');
  let probe: Probe;
  try {
    const ffprobe = process.env.FFPROBE_PATH || (require('ffprobe-static') as { path: string }).path;
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,duration:stream_disposition=attached_pic',
      '-of', 'json', absolutePath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    probe = JSON.parse(stdout) as Probe;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new Error('ffprobe is required. Install dev dependencies or set FFPROBE_PATH.');
    throw new Error('ffprobe could not read valid audio from this file.');
  }
  const metadata = validateProbe(extname(absolutePath), probe);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
  return { ...metadata, filename: basename(absolutePath), size: fileStat.size, sha256: hash.digest('hex') };
}

export async function buildPlan(input: PlanInput): Promise<ImportPlan> {
  if (input.manifest && input.files?.length) throw new Error('Use a manifest or --file arguments, not both.');
  const base = resolve(input.directory || (input.manifest ? resolve(input.manifest, '..') : '.'));
  let mappings: Mapping[] = [];
  let expectedQuestions: Record<string, number> = {};
  const plan: ImportPlan = { files: [], ignored: [], errors: [], missing: [] };
  if (input.manifest) {
    ({ files: mappings, expectedQuestions } = parseManifest(JSON.parse(await readFile(resolve(input.manifest), 'utf8'))));
  } else {
    let paths = input.files;
    if (!paths?.length) {
      const scanned = await walk(base);
      paths = scanned.files;
      plan.ignored = scanned.ignored;
    }
    for (const path of paths) {
      try { mappings.push(detectMapping(resolve(base, path))); }
      catch (error) { plan.errors.push({ path, message: errorMessage(error) }); }
    }
  }
  for (const key of duplicateMappings(mappings)) plan.errors.push({ path: key, message: 'Duplicate test/question mapping in this batch.' });
  const seenFiles = new Set<string>();
  for (const mapping of mappings) {
    try {
      if (expectedQuestions[String(mapping.testNumber)] !== undefined && mapping.questionNumber > expectedQuestions[String(mapping.testNumber)]) {
        throw new Error('Question number exceeds the manifest expected count.');
      }
      const absolutePath = await safeFile(base, mapping.path);
      if (seenFiles.has(absolutePath)) throw new Error('The same source file is listed more than once.');
      seenFiles.add(absolutePath);
      const inspected = await inspectAudio(absolutePath);
      if (mapping.sha256 !== undefined && mapping.sha256 !== inspected.sha256) {
        throw new Error('Recording does not match the manifest SHA-256. Nothing from this batch will be uploaded.');
      }
      plan.files.push({ ...mapping, path: relative(base, absolutePath), absolutePath, ...inspected });
    } catch (error) { plan.errors.push({ path: mapping.path, message: errorMessage(error) }); }
  }
  plan.files.sort((a, b) => a.testNumber - b.testNumber || a.questionNumber - b.questionNumber);
  plan.missing = findMissing(plan.files, expectedQuestions);
  if (!mappings.length && !plan.errors.length) plan.errors.push({ path: base, message: 'No supported audio files found.' });
  return plan;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
