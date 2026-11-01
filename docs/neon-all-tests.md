# Complete audio collection

The verified source manifest contains 43 tests with 39 questions each: 1,677 files totaling 1,576,673,622 bytes. Formats are 1,657 MP3, 16 WAV, and four OGG files. Original formats and bytes are preserved.

The production import completed on 1 November 2026: **1,638 uploaded, 39 existing questions skipped, zero failures, zero validation errors, and zero missing questions**. The original Test 1 question IDs and listening history were retained. SHA-256 fingerprints confirm the environment files were unchanged.

Full verification passed against the running production app:

```text
PASS Postgres catalog: persistence=cloud, 43 tests, 1677 questions
PASS Neon storage: 1677/1677 recordings streamed through the app; every SHA-256 matches
PASS playback HTTP semantics: HEAD 200, byte/suffix ranges 206, invalid 400, out-of-bounds 416 (audio/mpeg, audio/wav, audio/ogg)
PASS private bucket: unsigned object request denied (403)
PASS Postgres progress: POST/GET round-trip, verified stored row, isolated sessions, cross-origin write denied
PASS cleanup: temporary verification progress removed
Neon end-to-end verification passed.
```

All 32 unit tests, lint, and TypeScript checks passed. Two consecutive production builds passed. A recurring Windows webpack filesystem-cache failure was resolved by disabling that cache only for Windows production builds. The existing development dependency audit warnings remain; no unrelated forced dependency upgrades were performed.

## Import and resume

From the project root:

```sh
npm install
npm run import:all -- --commit
```

This uses the existing `.env`/`.env.local`, database driver, and private Neon `tcf-audio-files` bucket. No new environment variables or storage provider settings are required. The database was already migrated during initial setup; a fresh installation must run `npm run db:migrate` first.

The command checks bucket access, copies the supplied Test 1 recordings, and downloads Tests 2–43 from the explicit verified source URLs. Each file must match its declared size and SHA-256. Before any upload, the existing importer probes every recording and checks the manifest hash again. It skips existing database mappings and never enables `--replace`. Repeating the command resumes a partial import safely.

Use `npm run download:audio` for downloads only, or `npm run import:all` for download plus import validation without cloud writes.

## File organization

| Location | Purpose |
| --- | --- |
| `data/all-tests-audio-sources.json` | Validated source URLs, hashes, sizes, formats, and explicit test/question mappings. |
| `scripts/download-all-audio.ts` | Three concurrent verified downloads, retries, protected cache writes, and resumability. |
| `scripts/import-all-audio.ts` | Storage preflight, downloader, and existing importer with `--skip-existing`. |
| `scripts/import-audio.ts` | Existing transactional Neon uploader. |
| `audio-import/test-01/` through `test-43/` | Verified local cache; ignored by Git and deployment uploads. |
| `audio-import/download-report.json` | Per-file download/copy/cache results. |
| `audio-import/import-manifest.json` | Complete verified mappings passed to the uploader. |
| `audio-import/import-report.json` | Uploaded/skipped/failed questions and database results. |
| `updates/neon-all-tests/` | Original update bundle, preserved for reference. |
| `.tcf-update-backups/20261101-130709/` | Original project files before the merge; no copied credentials. |
| `reports/neon-all-tests/` | Build and end-to-end verification output. |
| `reports/neon-initial-setup/` | Earlier Test 1 import/verification reports. |

The generic bundle installer refused to overwrite the newer Neon implementation, so its additive downloader, bulk runner, manifest, and downloader tests were merged. The existing working storage/route code, direct migration connection, FFprobe setup, and environment files were retained. The bundle's older parallel storage abstraction and Vercel fallback were not installed. The archived bundle and backups are excluded from TypeScript, ESLint, and deployment inputs.

The import command's full output is in `reports/neon-all-tests/import-run.log`, with a compact result in `import-summary.json`. Final build output is in `build.log`; streamed verification output is in `verification.log`. The original supplied `verification.json` remains in the archive and describes the separate preparation environment, not this local run.

## Verify the running app

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm start -- --port 3000 --hostname 127.0.0.1
```

In another terminal:

```sh
npm run verify:neon -- http://127.0.0.1:3000 --all
```

The full verifier checks every test's 39-question count and downloads all 1,677 recordings through the actual app routes to compare their hashes and MIME types. It checks HEAD, byte/suffix ranges, invalid ranges for MP3/WAV/OGG, unsigned private-bucket denial, and a Postgres progress round-trip with session isolation. It removes its own temporary progress. Full verification transfers approximately 1.58 GB from object storage.

The local fallback still uses the original 39 bundled Test 1 files when no database is configured. The all-tests cache is private import material, not a public asset directory. Vercel requires a separate frontend deployment with the configured Neon environment.
