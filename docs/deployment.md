# Deployment

## Current status

Neon project tcf-listening (empty-violet-98021358) is linked to organization org-solitary-moon-96446296, branch production, in aws-us-east-2. The existing private tcf-audio-files bucket is reused. Postgres now contains 43 tests and 1,677 questions, with 39 recordings per test. See [the complete-library import report](neon-all-tests.md) and [the initial setup report](neon-setup.md).

The previously created Vercel project remains separate: project prj_P7vjtSdyGM9mqlkWxY27TdF5yAsI, team team_umXGiwDH7OXRxYrHjQj7Ra3N, [tcf-listening.vercel.app](https://tcf-listening.vercel.app/). Its earlier deployment was an audio-free preview. This Neon setup did not update Vercel environment variables or redeploy that frontend. Hosted access and connected playback there still need verification after a frontend deployment.

## Neon configuration

neon.ts declares the private bucket. The ignored .neon file pins the project and production branch. Run:

    neon deploy

The CLI reconciles backend services and pulls these server variables into the existing .env (or .env.local when .env does not exist):

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | Pooled application connection. |
| DATABASE_URL_UNPOOLED | Direct migration connection. If absent, the migration config removes the Neon pooler suffix. |
| NEON_BRANCH | Linked branch metadata. |
| AWS_ACCESS_KEY_ID | Branch storage access key. |
| AWS_SECRET_ACCESS_KEY | Branch storage secret. |
| AWS_ENDPOINT_URL_S3 | Branch storage endpoint. |
| AWS_REGION | Storage signing region. |

Keep these values server-side, without a NEXT_PUBLIC_ prefix. Existing unrelated environment entries are preserved. If authentication expires, run neon login --profile DEFAULT, finish sign-in, then retry.

Existing agent tooling and neon.ts can be preserved when relinking:

    neon init -y --no-agent-setup --no-config --org-id org-solitary-moon-96446296 --project-id empty-violet-98021358 --branch production

The established Drizzle/Neon HTTP driver handles the app's independent queries. The trusted importer uses the existing WebSocket transaction driver for its per-test locks and atomic writes. Migrations use a direct endpoint. See [Neon's driver guidance](https://neon.com/docs/connect/choose-connection).

## Migrate and import

    npm ci
    npm run db:migrate
    npm run import:audio -- --manifest data/audio-manifest.json --directory . --report import-report.json
    npm run import:audio -- --manifest data/audio-manifest.json --directory . --commit --skip-existing --report import-report.json

All 1,677 supplied recordings are imported on production. For the full collection, use npm run import:all -- --commit; it verifies the cache and skips existing mappings automatically. The commands above cover the original local Test 1 manifest. Use --replace only for intentional replacements. The importer uses bundled FFprobe unless FFPROBE_PATH is set. Imports run from a trusted computer, not from a build or visitor-facing endpoint. See [importing.md](importing.md).

## Deploy the Next.js frontend

Use the existing Vercel project, Next.js framework, npm ci, and npm run build. Configure the database and storage variables above in its server environment before redeploying. neon deploy provisions the backend; it does not upload the Next.js site to Vercel.

Keep Vercel Deployment Protection enabled for a private library. The streaming route is available to anyone permitted to access the app; bucket privacy is not application authentication.

Omit public/audio/** from hosted deployment uploads; .vercelignore already excludes it. Git-based workflows must likewise exclude the bundled local audio from deployment source. In cloud mode, the app uses Postgres mappings and /api/audio/<id> routes. An audio-free, unconfigured preview should use an empty local catalog to avoid broken references to omitted files.

## Verify

    npm test
    npm run lint
    npm run typecheck
    npm run build
    npm start -- --port 3000 --hostname 127.0.0.1

In another terminal:

    npm run verify:neon -- http://127.0.0.1:3000 --all

The full live verifier checks all 1,677 source hashes, MP3/WAV/OGG HEAD/range requests, unsigned bucket denial, cloud catalog reads, progress writes/reads, session isolation, and cross-origin rejection. It deletes only its temporary progress. Omit --all for the original Test 1 subset.

Production builds use webpack. On this Windows host Turbopack's CSS worker failed; webpack's persistent filesystem snapshots also repeatedly failed while hashing symlinked directories. Windows production builds now disable that cache in next.config.ts; other platforms retain the normal cache. Do not rebuild into a running development server's .next directory.

After a hosted deployment, separately verify access protection, real browser playback/seeking, progress after reload, and unavailable tests. No hosted or cross-browser verification is implied by the local HTTP tests.
