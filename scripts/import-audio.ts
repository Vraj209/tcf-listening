#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildPlan, errorMessage, type AudioFile } from './lib/import-plan';
import { AUDIO_BUCKET, getAudioStorage, hasAudioStorage } from '../src/db/storage';

const HELP = `TCF Listening audio importer

Validate and report (no cloud writes by default):
  npm run import:audio -- --directory ./audio
  npm run import:audio -- --manifest ./manifest.json --directory ./audio
  npm run import:audio -- --directory ./audio --file test-01/question-01.mp3 --file test-02/question-01.mp3

Upload to Neon Object Storage and save Postgres records:
  npm run import:audio -- --directory ./audio --commit

Options:
  --directory PATH     Audio root. Manifest paths are relative to this directory.
  --manifest PATH      Explicit JSON mapping; otherwise infer only labeled test/question names.
  --file PATH          One file within the audio root; repeat for multiple files.
  --dry-run            Explicit validation-only mode (the default).
  --commit             Enable uploads and database writes.
  --replace            Explicitly permit replacing existing question audio.
  --skip-existing      Skip existing mappings, useful for resuming a partial import.
  --report PATH        Also save the complete JSON report.
  --help               Show this help.

Uses bundled ffprobe (or FFPROBE_PATH). A commit requires DATABASE_URL and the
AWS_* storage variables pulled by neon deploy. The audio bucket stays private.
Only import recordings you supplied or have permission to use.
`;

type ImportResult = {
  testNumber: number;
  questionNumber: number;
  path: string;
  status: 'imported' | 'replaced' | 'skipped' | 'failed';
  questionId?: string;
  audioUrl?: string;
  previousAudioUrl?: string;
  error?: string;
  orphanedAudioUrl?: string;
  retainedAudioUrl?: string;
};

function safeMessage(error: unknown): string {
  let message = errorMessage(error);
  // Driver errors can contain a connection string. Never include credentials in reports.
  for (const value of [process.env.DATABASE_URL, process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY]) {
    if (value) message = message.replaceAll(value, '[redacted]');
  }
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted database URL]');
}

function itemIdentity(file: AudioFile) {
  return { testNumber: file.testNumber, questionNumber: file.questionNumber, path: file.path };
}

async function connectDatabase() {
  const [{ Pool, neonConfig }, { drizzle }, schema] = await Promise.all([
    import('@neondatabase/serverless'), import('drizzle-orm/neon-serverless'), import('../src/db/schema'),
  ]);
  if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000, max: 2 });
  return { pool, db: drizzle(pool, { schema }), schema };
}

async function run(): Promise<void> {
  for (const path of ['.env.local', '.env']) {
    try { process.loadEnvFile(path); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  const { values } = parseArgs({ options: {
    directory: { type: 'string' }, manifest: { type: 'string' }, file: { type: 'string', multiple: true },
    commit: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    replace: { type: 'boolean', default: false }, 'skip-existing': { type: 'boolean', default: false },
    report: { type: 'string' }, help: { type: 'boolean', default: false },
  }, strict: true, allowPositionals: false });
  if (values.help) { console.log(HELP); return; }
  if (!values.directory && !values.manifest && !values.file?.length) throw new Error('Provide --directory, --manifest, or --file. Use --help for examples.');
  if (values.commit && values['dry-run']) throw new Error('--commit and --dry-run cannot be combined.');
  if (values.replace && values['skip-existing']) throw new Error('--replace and --skip-existing cannot be combined.');
  const plan = await buildPlan({ directory: values.directory, manifest: values.manifest, files: values.file });
  const report = {
    mode: values.commit ? 'commit' : 'dry-run',
    generatedAt: new Date().toISOString(),
    databaseChecked: false,
    validatedFiles: plan.files.map((file) => ({
      path: file.path, testNumber: file.testNumber, questionNumber: file.questionNumber,
      filename: file.filename, mimeType: file.mimeType, duration: file.duration,
      size: file.size, sha256: file.sha256,
    })),
    missingQuestions: plan.missing,
    ignoredFiles: plan.ignored,
    validationErrors: plan.errors,
    existingMappings: [] as { testNumber: number; questionNumber: number }[],
    results: [] as ImportResult[],
    notes: [
      'Missing-question reports describe this input batch. No unobserved trailing questions are inferred without an expected count.',
      'AudioUrl report fields contain object keys. Replaced objects are retained for in-progress playback; review previousAudioUrl before later cleanup.',
    ],
  };
  async function finish(exitCode = 0) {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (values.report) {
      const output = resolve(values.report);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, json, { flag: 'w' });
    }
    console.log(json);
    process.exitCode = exitCode;
  }
  if (plan.errors.length) { await finish(1); return; }
  if (values.commit && (!process.env.DATABASE_URL || !hasAudioStorage())) {
    report.validationErrors.push({ path: 'environment', message: 'Commit requires DATABASE_URL and all four AWS_* variables from neon deploy. Nothing was uploaded.' });
    await finish(1); return;
  }
  if (!process.env.DATABASE_URL) {
    report.notes.push('DATABASE_URL is not configured: validation succeeded locally, but database conflicts have not been checked.');
    await finish(); return;
  }

  const { pool, db, schema } = await connectDatabase();
  const { tests, questions } = schema;
  const { and, eq, inArray, sql, count } = await import('drizzle-orm');
  try {
    const existingRows = await db.select({ testNumber: tests.testNumber, questionNumber: questions.questionNumber })
      .from(questions).innerJoin(tests, eq(questions.testId, tests.id))
      .where(inArray(tests.testNumber, [...new Set(plan.files.map((file) => file.testNumber))]));
    const keys = new Set(plan.files.map((file) => `${file.testNumber}:${file.questionNumber}`));
    report.existingMappings = existingRows.filter((row) => keys.has(`${row.testNumber}:${row.questionNumber}`));
    report.databaseChecked = true;
    const existing = new Set(report.existingMappings.map((row) => `${row.testNumber}:${row.questionNumber}`));
    if (existing.size && !values.replace && !values['skip-existing']) {
      report.validationErrors.push({ path: 'database', message: `${existing.size} test/question mappings already exist. Nothing was uploaded. Use --skip-existing to resume or --replace to intentionally replace audio.` });
      await finish(1); return;
    }
    if (!values.commit) { await finish(); return; }
    const { PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const storage = getAudioStorage();
    for (const file of plan.files) {
      if (existing.has(`${file.testNumber}:${file.questionNumber}`) && values['skip-existing']) {
        report.results.push({ ...itemIdentity(file), status: 'skipped' });
        continue;
      }
      process.stderr.write(`Importing Test ${file.testNumber}, Question ${file.questionNumber}\n`);
      let uploadedUrl: string | undefined;
      let committed = false;
      let transactionBodyCompleted = false;
      try {
        // A unique object is created for every attempt. A failed transaction can safely delete only its own upload.
        const objectPath = `tcf/test-${String(file.testNumber).padStart(2, '0')}/question-${String(file.questionNumber).padStart(2, '0')}-${file.sha256.slice(0, 16)}-${randomUUID()}${extname(file.filename).toLowerCase()}`;
        await storage.send(new PutObjectCommand({
          Bucket: AUDIO_BUCKET, Key: objectPath, Body: createReadStream(file.absolutePath),
          ContentLength: file.size, ContentType: file.mimeType,
          CacheControl: 'private, max-age=3600', Metadata: { sha256: file.sha256 },
        }));
        uploadedUrl = objectPath;
        const result = await db.transaction(async (tx) => {
          // Lock a whole test so count updates and duplicate checks remain correct across concurrent imports.
          await tx.execute(sql`select pg_advisory_xact_lock(1413691212, ${file.testNumber})`);
          await tx.insert(tests).values({ testNumber: file.testNumber, title: `Test ${String(file.testNumber).padStart(2, '0')}`, totalQuestions: 0 })
            .onConflictDoNothing({ target: tests.testNumber });
          const [test] = await tx.select({ id: tests.id }).from(tests).where(eq(tests.testNumber, file.testNumber));
          if (!test) throw new Error('Test record could not be created.');
          const [current] = await tx.select().from(questions)
            .where(and(eq(questions.testId, test.id), eq(questions.questionNumber, file.questionNumber)));
          if (current && !values.replace) throw new Error('This question was imported by another process. No existing audio was changed.');
          const metadata = {
            audioUrl: objectPath, audioDuration: file.duration, audioFilename: file.filename,
            audioMimeType: file.mimeType, updatedAt: new Date(),
          };
          const [saved] = current
            ? await tx.update(questions).set(metadata).where(eq(questions.id, current.id)).returning({ id: questions.id })
            : await tx.insert(questions).values({ testId: test.id, questionNumber: file.questionNumber, ...metadata }).returning({ id: questions.id });
          const [total] = await tx.select({ value: count() }).from(questions).where(eq(questions.testId, test.id));
          await tx.update(tests).set({ totalQuestions: Number(total.value), updatedAt: new Date() }).where(eq(tests.id, test.id));
          transactionBodyCompleted = true;
          return { questionId: saved.id, previousAudioUrl: current?.audioUrl };
        });
        committed = true;
        report.results.push({ ...itemIdentity(file), status: result.previousAudioUrl ? 'replaced' : 'imported', audioUrl: objectPath, ...result });
      } catch (error) {
        const failed: ImportResult = { ...itemIdentity(file), status: 'failed', error: safeMessage(error) };
        if (uploadedUrl && !committed && transactionBodyCompleted) {
          // A network error while COMMIT is acknowledged has an unknown outcome. Deleting here could break a committed row.
          failed.retainedAudioUrl = uploadedUrl;
          failed.error += ' Commit acknowledgment was uncertain. The new object was retained; inspect the database mapping before retrying or deleting it.';
        } else if (uploadedUrl && !committed) {
          try { await storage.send(new DeleteObjectCommand({ Bucket: AUDIO_BUCKET, Key: uploadedUrl })); }
          catch { failed.orphanedAudioUrl = uploadedUrl; failed.error += ' The new object could not be cleaned up; its key is included for review.'; }
        }
        report.results.push(failed);
      }
    }
    await finish(report.results.some((result) => result.status === 'failed') ? 1 : 0);
  } catch (error) {
    report.validationErrors.push({ path: 'database', message: safeMessage(error) });
    await finish(1);
  } finally { await pool.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => { console.error(safeMessage(error)); process.exitCode = 1; });
}
