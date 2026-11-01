import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedSourceUrl, downloadOne, safeRelativePath, validateSourceManifest, verifyAudioFile, type AudioSource } from '../scripts/download-all-audio';

const body = Buffer.from('verified recording bytes');
const fixture: AudioSource = {
  testNumber: 1, questionNumber: 1, path: 'test-01/question-01.mp3',
  sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.length,
  audioDuration: 12, audioMimeType: 'audio/mpeg', sourceUrl: 'https://source.public.blob.vercel-storage.com/question-01.mp3',
};
const manifest = () => ({ version: 1, tests: 1, expectedQuestions: { '1': 1 }, files: [{ ...fixture }] });
async function temporary(run: (root: string, cache: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tcf-download-test-')));
  const cache = join(root, 'cache'); await mkdir(cache);
  try { await run(root, cache); } finally { await rm(root, { recursive: true, force: true }); }
}

test('source manifest rejects missing, duplicate, and mislabelled question mappings', () => {
  assert.equal(validateSourceManifest(manifest()).files.length, 1);
  assert.throws(() => validateSourceManifest({ ...manifest(), files: [] }), /missing/);
  assert.throws(() => validateSourceManifest({ ...manifest(), files: [fixture, fixture] }), /Duplicate/);
  assert.throws(() => validateSourceManifest({ ...manifest(), files: [{ ...fixture, path: 'test-02/question-01.mp3' }] }), /does not match/);
  assert.throws(() => validateSourceManifest({ ...manifest(), expectedQuestions: { '1': 2 } }), /missing/);
});

test('source URLs cannot carry credentials or target an unrelated host', () => {
  assert.equal(allowedSourceUrl(fixture.sourceUrl), fixture.sourceUrl);
  for (const url of ['http://source.public.blob.vercel-storage.com/file.mp3', 'https://source.public.blob.vercel-storage.com.evil.test/file.mp3', 'https://user:password@source.public.blob.vercel-storage.com/file.mp3', 'https://source.private.blob.vercel-storage.com/file.mp3', 'https://127.0.0.1/file.mp3']) assert.throws(() => allowedSourceUrl(url));
});

test('portable cache paths reject traversal, absolute paths, and hidden files', () => {
  assert.equal(safeRelativePath(fixture.path), fixture.path);
  for (const path of ['../secrets', '/tmp/file.mp3', 'C:\\private\\file.mp3', 'test-01/../question-01.mp3', '.env.local', 'test-01//question-01.mp3']) assert.throws(() => safeRelativePath(path));
});

test('verified cached recordings do not trigger another network request', async () => temporary(async (root, cache) => {
  await mkdir(join(cache, 'test-01')); await writeFile(join(cache, fixture.path), body);
  let calls = 0;
  const result = await downloadOne(fixture, { projectRoot: root, cacheRoot: cache, fetchImpl: async () => { calls++; throw new Error('No network expected'); } });
  assert.equal(result.status, 'cached'); assert.equal(calls, 0);
}));

test('conflicting cached recordings are preserved rather than overwritten', async () => temporary(async (root, cache) => {
  await mkdir(join(cache, 'test-01')); await writeFile(join(cache, fixture.path), 'different recording');
  const result = await downloadOne(fixture, { projectRoot: root, cacheRoot: cache, fetchImpl: async () => { throw new Error('No network expected'); } });
  assert.equal(result.status, 'failed'); assert.match(result.error ?? '', /preserved/);
  assert.equal(await readFile(join(cache, fixture.path), 'utf8'), 'different recording');
}));

test('download installs only bytes matching the verified checksum and size', async () => temporary(async (root, cache) => {
  const result = await downloadOne(fixture, { projectRoot: root, cacheRoot: cache, fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) });
  assert.equal(result.status, 'downloaded');
  assert.equal(await verifyAudioFile(join(cache, fixture.path), fixture), true);
  assert.deepEqual(await readdir(join(cache, 'test-01')), ['question-01.mp3']);
}));

test('changed source bytes are rejected and temporary downloads are removed', async () => temporary(async (root, cache) => {
  const changed = Buffer.alloc(body.length, 65);
  const result = await downloadOne(fixture, { projectRoot: root, cacheRoot: cache, fetchImpl: async () => new Response(changed, { status: 200 }) });
  assert.equal(result.status, 'failed'); assert.match(result.error ?? '', /checksum/);
  assert.deepEqual(await readdir(join(cache, 'test-01')), []);
}));

test('supplied Test 1 files are copied and verified without network requests', async () => temporary(async (root, cache) => {
  await mkdir(join(root, 'public/audio/test-01'), { recursive: true });
  await writeFile(join(root, 'public/audio/test-01/question-01.mp3'), body);
  const source = { ...fixture, sourceUrl: undefined, localSource: 'public/audio/test-01/question-01.mp3' };
  const result = await downloadOne(source, { projectRoot: root, cacheRoot: cache, fetchImpl: async () => { throw new Error('No network expected'); } });
  assert.equal(result.status, 'copied'); assert.equal(await verifyAudioFile(join(cache, fixture.path), fixture), true);
}));

test('a cache subdirectory symlink cannot write outside the cache', async () => temporary(async (root, cache) => {
  const outside = join(root, 'outside'); await mkdir(outside); await symlink(outside, join(cache, 'test-01'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await downloadOne(fixture, { projectRoot: root, cacheRoot: cache, fetchImpl: async () => { throw new Error('No network expected'); } });
  assert.equal(result.status, 'failed'); assert.deepEqual(await readdir(outside), []);
}));
