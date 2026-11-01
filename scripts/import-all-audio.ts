#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { downloadAll } from './download-all-audio';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { AUDIO_BUCKET, getAudioStorage } from '../src/db/storage';

const HELP = `Download and import all verified TCF Tests 1–43.

  npm run import:all                  # download, verify, then importer dry-run
  npm run import:all -- --commit      # download, verify, then upload missing mappings

Options:
  --directory PATH   Local cache within this project (default: ./audio-import).
  --manifest PATH    Verified source manifest (default: data/all-tests-audio-sources.json).
  --commit           Enable cloud uploads and database writes after every file verifies.
  --dry-run          Explicit validation-only mode (default).
  --help             Show this help.

Existing database mappings are skipped. This command never replaces existing audio.
Cloud credentials stay in the local project environment; never paste them into chat.
The database schema must already be migrated (npm run db:migrate).
`;

export async function runImportAllCli(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: {
    directory: { type: 'string' }, manifest: { type: 'string' },
    commit: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  }, strict: true, allowPositionals: false });
  if (values.help) { console.log(HELP); return; }
  if (values.commit && values['dry-run']) throw new Error('--commit and --dry-run cannot be combined.');
  if (values.commit) {
    for (const file of ['.env.local', '.env']) {
      try { process.loadEnvFile(file); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in this local project before importing. Nothing was downloaded or uploaded.');
    await getAudioStorage().send(new HeadBucketCommand({ Bucket: AUDIO_BUCKET }));
    console.log(`Storage target: private Neon bucket ${AUDIO_BUCKET}.`);
  }
  const downloaded = await downloadAll({ directory: values.directory, manifest: values.manifest });
  if (!downloaded.report.complete) { process.exitCode = 1; return; }
  const importer = fileURLToPath(new URL('./import-audio.ts', import.meta.url));
  const childArgs = ['--import', 'tsx', importer, '--directory', downloaded.directory, '--manifest', downloaded.importManifest, '--skip-existing', '--report', resolve(downloaded.directory, 'import-report.json'), values.commit ? '--commit' : '--dry-run'];
  console.log(values.commit ? 'Starting cloud import for missing test/question mappings.' : 'Starting importer validation. No cloud uploads or database writes are enabled.');
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, childArgs, { stdio: 'inherit', env: process.env, shell: false });
    const interrupt = () => child.kill('SIGINT');
    process.once('SIGINT', interrupt);
    child.once('error', error => { process.removeListener('SIGINT', interrupt); reject(error); });
    child.once('exit', code => { process.removeListener('SIGINT', interrupt); resolveExit(code ?? 1); });
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runImportAllCli().catch(error => { console.error(error instanceof Error ? error.message : 'The all-tests import failed.'); process.exitCode = 1; });
}
