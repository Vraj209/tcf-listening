import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildPlan, detectMapping, duplicateMappings, findMissing, parseManifest, safeFile, validateProbe } from '../scripts/lib/import-plan';

test('maps explicit test folders and question filenames, including Windows separators', () => {
  assert.deepEqual(detectMapping('audio/test-07/question-012.mp3'), { path: 'audio/test-07/question-012.mp3', testNumber: 7, questionNumber: 12 });
  assert.equal(detectMapping('C:\\audio\\test-43\\Question-01.mp3').testNumber, 43);
  assert.equal(detectMapping('test-02-question-03.mp3').questionNumber, 3);
});

test('never derives ordering from ambiguous, contradictory or out-of-range names', () => {
  for (const path of ['test-01/track-12.mp3', 'test-01/12.mp3', 'question-01.mp3', 'test-01/test-02/question-01.mp3', 'test-44/question-01.mp3', 'test-00/question-01.mp3', 'test-02/question-00.mp3', 'test-01/question-01-question-02.mp3']) {
    assert.throws(() => detectMapping(path), Error, path);
  }
});

test('manifest requires explicit integer mappings and portable relative paths', () => {
  assert.deepEqual(parseManifest({ files: [{ path: 'clip.mp3', testNumber: 1, questionNumber: 3, extra: true }], expectedQuestions: { '01': 4 } }), {
    files: [{ path: 'clip.mp3', testNumber: 1, questionNumber: 3 }], expectedQuestions: { '1': 4 },
  });
  for (const value of [null, { files: [] }, { files: [{ path: '/tmp/a.mp3', testNumber: 1, questionNumber: 1 }] }, { files: [{ path: 'a.mp3', testNumber: '1', questionNumber: 1 }] }, { files: [{ path: 'a.mp3', testNumber: 1, questionNumber: 1 }], expectedQuestions: { bad: 5 } }]) {
    assert.throws(() => parseManifest(value));
  }
});

test('detects duplicate question assignments before any upload', () => {
  assert.deepEqual(duplicateMappings([
    { path: 'a.mp3', testNumber: 2, questionNumber: 1 },
    { path: 'b.mp3', testNumber: 2, questionNumber: 1 },
    { path: 'c.mp3', testNumber: 3, questionNumber: 1 },
  ]), ['2:1']);
});

test('reports only internal gaps unless an expected count is explicitly supplied', () => {
  const files = [{ path: 'a.mp3', testNumber: 2, questionNumber: 1 }, { path: 'c.mp3', testNumber: 2, questionNumber: 3 }];
  assert.deepEqual(findMissing(files), [{ testNumber: 2, numbers: [2], basis: 'observed-range' }]);
  assert.deepEqual(findMissing(files, { '2': 5, '4': 2 }), [
    { testNumber: 2, numbers: [2, 4, 5], basis: 'manifest-expected-count' },
    { testNumber: 4, numbers: [1, 2], basis: 'manifest-expected-count' },
  ]);
});

test('checks decoded content, duration, and video streams instead of trusting an extension', () => {
  assert.deepEqual(validateProbe('.mp3', { format: { format_name: 'mp3', duration: '12.5' }, streams: [{ codec_type: 'audio' }] }), { mimeType: 'audio/mpeg', duration: 12.5 });
  assert.throws(() => validateProbe('.mp3', { format: { format_name: 'wav', duration: '12.5' }, streams: [{ codec_type: 'audio' }] }));
  assert.throws(() => validateProbe('.m4a', { format: { format_name: 'mov,mp4,m4a', duration: '12.5' }, streams: [{ codec_type: 'audio' }, { codec_type: 'video' }] }));
  assert.throws(() => validateProbe('.mp3', { format: { format_name: 'mp3', duration: 'NaN' }, streams: [{ codec_type: 'audio' }] }));
  assert.doesNotThrow(() => validateProbe('.mp3', { format: { format_name: 'mp3', duration: '3' }, streams: [{ codec_type: 'audio' }, { codec_type: 'video', disposition: { attached_pic: 1 } }] }));
});

test('rejects traversal and symlinks escaping the chosen audio root', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'tcf-import-'));
  try {
    const root = join(parent, 'audio');
    await mkdir(root);
    await writeFile(join(parent, 'outside.mp3'), 'outside');
    await writeFile(join(root, 'inside.mp3'), 'inside');
    // Windows junctions exercise realpath containment without requiring symlink privileges.
    await mkdir(join(parent, 'outside'));
    await writeFile(join(parent, 'outside', 'linked.mp3'), 'outside');
    await symlink(join(parent, 'outside'), join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await safeFile(root, 'inside.mp3'), await realpath(join(root, 'inside.mp3')));
    await assert.rejects(safeFile(root, '../outside.mp3'), /outside/);
    await assert.rejects(safeFile(root, 'escape/linked.mp3'), /outside/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('real validation rejects renamed non-audio before any cloud operation', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'tcf-import-'));
  try {
    await mkdir(join(parent, 'test-01'));
    await writeFile(join(parent, 'test-01', 'question-01.mp3'), 'This is not audio.');
    const plan = await buildPlan({ directory: parent });
    assert.equal(plan.files.length, 0);
    assert.equal(plan.errors.length, 1);
    assert.match(plan.errors[0].message, /ffprobe/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('import validation rejects valid audio with a different manifest checksum', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'tcf-hash-test-'));
  try {
    const manifest = join(temporary, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ files: [{
      path: 'public/audio/test-01/question-01.mp3', testNumber: 1, questionNumber: 1, sha256: '0'.repeat(64),
    }] }));
    const plan = await buildPlan({ directory: process.cwd(), manifest });
    assert.equal(plan.files.length, 0);
    assert.equal(plan.errors.length, 1);
    assert.match(plan.errors[0].message, /SHA-256/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
