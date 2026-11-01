# TCF Listening

A focused listening player for TCF Canada Tests 1–43. Built with Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui components, Lucide icons, Drizzle, Neon PostgreSQL, and private Neon Object Storage.

The local fallback includes **39 verified recordings for Test 1**. The complete source manifest covers **43 tests, 39 questions each: 1,677 recordings** (about 1.58 GB). The bulk importer downloads verified originals and adds missing questions to the configured private Neon bucket. No recordings, transcripts, or answers are invented.

## Run locally

Install Node.js 22 or newer, then run from the project directory:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). Leave `DATABASE_URL` empty to use the included Test 1 recordings and save progress in this browser. Audio imports use the bundled `ffprobe-static` development dependency; set `FFPROBE_PATH` to use another FFprobe executable.

For a production build:

```sh
npm run build
npm start
```

`npm run preview`, when used for the managed preview, also requires a completed production build. The source project does not include generated `.next` files or `node_modules`.

## Practice

Choose a test from the searchable selector, then select a question. The player supports play/pause, previous/next question, ten-second skips, seeking, playback speed, and desktop volume. Auto-play next is off by default. Changing a test selects its first available question; returning to the website restores the last saved selection. Theme follows the system until changed.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Left / Right arrow | Back / forward 10 seconds |
| N / P | Next / previous question |
| + / - | Increase / decrease playback speed |

Input fields, sliders, selectors, and dialogs keep their normal keyboard behavior. Browser autoplay restrictions may require a tap on Play. On iPhone and iPad, use the device's volume controls.

## Connect Neon and audio storage

This workspace is linked to project `empty-violet-98021358`, branch `production`. Its existing private bucket is `tcf-audio-files`, declared in `neon.ts`. Provision or reconcile it and pull credentials into the existing `.env` with:

```sh
neon deploy
```

The CLI pulls `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, and the four `AWS_*` storage variables. If the CLI login expires, run `neon login --profile DEFAULT`. For a new empty database, migrate and import:

```sh
npm run db:migrate
npm run import:audio -- --manifest data/audio-manifest.json --directory .
npm run import:audio -- --manifest data/audio-manifest.json --directory . --commit --skip-existing
```

The first import command validates the supplied Test 1 mappings without uploading. The second uploads the recordings and saves their metadata. Import only recordings you supplied or are authorized to use. Importing more tests does not require an application code change.

To download and import the complete supplied collection while retaining existing questions:

```sh
npm run import:all -- --commit
```

Downloads are cached under `audio-import/` and must match their manifest size and SHA-256. The importer validates audio content and checks those hashes again before uploading. Existing mappings are skipped. Run the same command to resume a partial import. See [the all-tests import guide](docs/neon-all-tests.md).

When `DATABASE_URL` is set, the app reads the database catalog instead of `data/catalog.json`. A newly migrated database has 43 empty tests until import finishes. A database outage produces an unavailable state rather than substituting old local data.

Read [the import guide](docs/importing.md) for folder naming, explicit manifests, replacements, duplicates, missing-question reports, and recovery. See [deployment setup and current status](docs/deployment.md) for Vercel configuration.

## Data and privacy

| Table | Purpose and integrity |
| --- | --- |
| `tests` | Unique test number, restricted to 1–43; title, available recording count, timestamps. |
| `questions` | Audio object key in the existing `audio_url` column, duration, source filename, MIME type, timestamps; unique test/question pair; foreign key to its test. |
| `listening_progress` | Anonymous session, test/question, playback position, played status, timestamp; unique session/question pair and composite foreign key preventing a mismatched test. |

Audio bytes stay in object storage, not PostgreSQL. In cloud mode, the browser receives `/api/audio/<question-id>` URLs. The server signs a short-lived request to the current branch's private Neon bucket and streams it with byte-range support for seeking. Storage credentials and signed storage URLs never enter browser code. Object keys remain valid when the database and bucket are branched together.

Selection, playback positions, played questions, speed, volume, auto-play, and appearance preferences use local storage. With Neon configured, an HttpOnly anonymous session cookie associates playback positions and played status with that browser. This is not an account or cross-device synchronization. Clearing site data resets the anonymous identity and local preferences; it does not automatically delete older server-side progress rows. There are no analytics trackers or mandatory application accounts.

For a private hosted library, keep Vercel Deployment Protection enabled. Private object storage protects the original objects; the app's streaming route is accessible to anyone allowed to access the deployment.

## Project structure

```text
src/app/                 Page and catalog, progress, audio API routes
src/components/          Responsive player and UI components
src/hooks/               Native audio lifecycle and playback persistence
src/db/                  Neon client, Drizzle schema, audio proxy helpers
src/lib/                 Catalog, types, validation, browser preferences
drizzle/                 SQL migration, schema snapshot, migration journal
scripts/import-audio.ts  Validated bulk importer
data/                    Local catalog and supplied Test 1 manifest
public/audio/            Supplied Test 1 recordings for local practice
docs/                    Import, deployment, inventory, verification notes
```

## Check the project

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover mapping validation, download integrity, import safety, progress input, private audio key/range handling, direct migration connections, and preference recovery. With the production app running locally, run `npm run verify:neon -- http://127.0.0.1:3000 --all` to verify the 43-test catalog, all 1,677 audio hashes, MP3/WAV/OGG seeking, bucket privacy, and progress persistence. Without `--all`, it checks the original Test 1 recordings. The verifier removes only its own temporary progress rows. See [the Neon setup report](docs/neon-setup.md) and [verification notes](docs/qa.md).
