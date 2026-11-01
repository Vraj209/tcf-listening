# Importing listening audio

For the complete supplied 43-test collection, use `npm run import:all -- --commit`. It verifies all 1,677 source files, then runs the importer described below with `--skip-existing`. See [the all-tests guide](neon-all-tests.md) for cache locations, reports, and full verification.

Import only recordings you supply or have authorization to use. The importer does not scrape test websites, infer questions from alphabetical order, or download source audio URLs.

## Requirements

- Node.js 22 or newer and dependencies installed with `npm ci`.
- Install development dependencies for the bundled `ffprobe-static` executable, or set `FFPROBE_PATH`.
- For cloud import: migrated Neon PostgreSQL database, `DATABASE_URL`, and `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION` from `neon deploy`.
- The `tcf-audio-files` bucket is private in `neon.ts`. The browser receives `/api/audio/<question-id>`; signed storage URLs remain server-side.

The importer loads `.env.local` and `.env` without replacing already-set environment variables. Never commit those files or generated import reports. Report fields named `audioUrl`, `previousAudioUrl`, `retainedAudioUrl`, and `orphanedAudioUrl` now contain bucket object keys; the names are retained for report compatibility.

## Standard directory import

```text
audio/
  test-01/
    question-01.mp3
    question-02.mp3
  test-02/
    question-01.mp3
```

Validate the complete batch first. The default is a dry run and performs no cloud writes:

```sh
npm run import:audio -- --directory ./audio --report ./import-report.json
```

If `DATABASE_URL` is available, a dry run also checks existing database mappings. Without it, the report explicitly says database conflicts have not been checked. After reviewing the mappings, upload:

```sh
npm run import:audio -- --directory ./audio --commit --report ./import-report.json
```

Multiple individual files are supported:

```sh
npm run import:audio -- --directory ./audio --file test-01/question-01.mp3 --file test-02/question-01.mp3
```

## Explicit manifest

When source names do not identify a test and a question, provide a manifest rather than renaming by guesswork:

```json
{
  "expectedQuestions": { "1": 2 },
  "files": [
    { "path": "recording-a.mp3", "testNumber": 1, "questionNumber": 1 },
    { "path": "recording-b.mp3", "testNumber": 1, "questionNumber": 2 }
  ]
}
```

```sh
npm run import:audio -- --manifest ./manifest.json --directory ./audio
npm run import:audio -- --manifest ./manifest.json --directory ./audio --commit
```

Paths are relative to `--directory`, or to the manifest's directory when that option is omitted. Absolute paths, directory escapes, and symlinks that escape the root are rejected. Additional manifest metadata is allowed. `examples/audio-manifest.json` is a format example, not a claim that those recordings exist.

An optional lowercase `sha256` field is enforced against the actual recording. A mismatch stops the whole batch before cloud uploads. The all-tests downloader includes this field in its generated import manifest.

The included, verified Test 1 manifest uses paths relative to the project root:

```sh
npm run import:audio -- --manifest ./data/audio-manifest.json --directory .
npm run import:audio -- --manifest ./data/audio-manifest.json --directory . --commit
```

## Replacements, resuming, and integrity

- A duplicate test/question in the same batch aborts the whole batch before uploads.
- Existing database mappings abort the batch unless `--skip-existing` or `--replace` is explicitly supplied. Use `--skip-existing` to resume after a partially successful import.
- `--replace` preserves question IDs and listening history while changing audio metadata. The previous object is retained so currently playing clients are not interrupted. Reports list `previousAudioUrl` for later deliberate cleanup.
- Uploads use new object names containing a content hash and a random suffix. Existing objects are never overwritten.
- Each recording's database update runs in an interactive transaction with a per-test advisory lock. The unique test/question constraint remains the final defense against concurrent duplicate assignment. Question counts are recalculated from stored rows.
- If database work fails before commit, the importer attempts to delete only its new upload. Any cleanup failure is reported. If the commit acknowledgment is uncertain, the new object is retained and reported for inspection; it is never deleted speculatively.
- Upload or database failures are reported per question and cause a nonzero exit status. Successful earlier imports remain usable; the operation is not an all-or-nothing transaction across the entire folder.

Supported extensions: MP3, M4A, AAC, WAV, OGG, OGA, Opus, WebM audio, and FLAC. `ffprobe` checks real file content and duration; video files, empty files, extension/content mismatches, and files over 512 MiB are rejected. MP3 or AAC/M4A is recommended when the same files must play across Safari, Chrome, and Firefox. The importer preserves source audio and does not transcode it.

The report includes validated mappings, SHA-256 hashes, durations, ignored files, conflicts, missing numbers, and individual outcomes. Directory scanning ignores hidden files, unsupported extensions, and symlinks; an explicitly selected unsupported file is rejected. Missing-number checks use `expectedQuestions` when provided. Otherwise they report gaps only between question 1 and the highest supplied number; they do not invent a total for a test. These checks describe the input batch, not the combination of every previous database import.

## Deployment

Set the same database and Neon storage variables in the Vercel project's server environment. Run migrations once, then run the importer from a trusted computer or job. Importing is not part of the Vercel build and no admin upload endpoint is exposed to visitors. After importing, the next page request reads the database catalog; adding audio does not require application code changes.

Keep deployment access protection enabled for a personal practice site. Private Neon storage protects raw objects; the server audio route remains usable by anyone who can access the deployed application unless further application authentication is added.

Reference documentation: [Neon S3 compatibility](https://neon.com/docs/storage/s3-compatibility), [Drizzle with Neon](https://orm.drizzle.team/docs/connect-neon), [Neon connection methods](https://neon.com/docs/connect/choose-connection).
