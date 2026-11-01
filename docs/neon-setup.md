# Neon setup report — 1 November 2026

This report records the initial Test 1 setup. The subsequent full-library import is documented in [the all-tests guide](neon-all-tests.md). Its original local logs have been organized under `reports/neon-initial-setup/`.

## Result

The app uses the requested existing organization `org-solitary-moon-96446296`, project `empty-violet-98021358`, and `production` branch. It reuses the existing private `tcf-audio-files` bucket in `aws-us-east-2`. Postgres contains 43 tests and 39 imported Test 1 questions; Tests 2–43 remain empty. The production app ran locally at `http://127.0.0.1:3000` and passed live service verification.

No Vercel frontend deployment or hosted environment update was performed. This directory has no Git metadata, so the changes are working files rather than commits.

## Agent tooling and configuration changes

- Fetched and read the exact requested [Neon skill](https://neon.com/.well-known/agent-skills/neon/SKILL.md), plus installed Postgres and object-storage skills. All nine project skills were already installed and `neon skills status` reported each up to date. Project skills and `skills-lock.json` were preserved.
- Updated the global Neon CLI from 6.2.3 to 8.16.0 using `npm i -g neon@latest`.
- The initial requested `neon init` installed the user-level Neon plugin for Claude Code, Codex, Cursor, and VS Code. It installed user-level skills for Gemini CLI and GitHub Copilot, and wrote their MCP entries to `C:/Users/Vraj Panchal/.gemini/settings.json` and `C:/Users/Vraj Panchal/.copilot/mcp-config.json`, reusing the existing MCP key through the CLI's setup flow. Copilot CLI was unavailable, so its setup used skills/MCP.
- Confirmed the existing Codex Neon MCP connection works. No duplicate project MCP configuration was added. Successful initialization later used `--no-agent-setup --no-config` to preserve installed tooling and the prepared `neon.ts`.
- Added `.neon` for the requested project/production branch; CLI initialization subsequently confirmed the link. Added `neon.ts` declaring the existing private bucket. No project limits, unrelated services, or existing bucket access settings were changed.
- `neon deploy` pulled seven variables into the existing `.env`: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION`. Unrelated entries, including unused legacy Blob settings, were preserved. Credentials were not printed or exposed through public variables.

## Remote changes

- Applied the existing Drizzle migration first on validation branch `verify-tcf-neon-20261101` (`br-icy-dream-b5ljcbn9`), then production. The test branch uses a small compute, five-minute idle suspension, and automatic expiry at `2026-11-01T18:40:23Z`. Its temporary local environment file was removed.
- Created the schema's `tests`, `questions`, and `listening_progress` tables, constraints, indexes, migration journal, and 43 test rows in the initially empty production database.
- Uploaded 39 uniquely named objects and inserted their question metadata. Existing mappings were checked before import; none were replaced.
- While CLI authentication was unavailable, issued a branch credential named `TCF Listening app storage` through MCP, limited to `storage:read` and `storage:write`. It remains available; the subsequently successful CLI deployment pulled its default storage credential for normal use. Existing credentials were not revoked or rotated.
- The verifier created and deleted only its own randomly identified progress row. Existing listening history was not changed.

## File changes

| Files | Change |
| --- | --- |
| `neon.ts`, `.neon` | Private bucket declaration and local production link. |
| `.env`, `.env.example` | Neon-managed values and documented server-only placeholders. |
| `.gitignore`, `.vercelignore` | Exclude Neon context, verification/build logs, and import logs; retain private-audio exclusions. |
| `package.json`, `package-lock.json` | Add `@neon/config`, AWS S3 client/presigner, and development `ffprobe-static`; remove `@vercel/blob`; add `verify:neon`; use webpack for builds. |
| `src/db/storage.ts` | Lazy path-style S3 client using pulled AWS variables, bucket/key validation, and server-only signed GET/HEAD requests. |
| `src/app/api/audio/[questionId]/route.ts`, `src/db/audio.ts` | Replace Vercel origins/tokens with Neon keys and signed upstream requests; preserve streaming, HEAD, byte ranges, cancellation, and error responses. |
| `src/db/schema.ts` | Document object keys in the existing `audio_url` column; no column rename or extra migration. |
| `src/db/connection.ts`, `drizzle.config.ts` | Use direct migration connections, preserving the pooled app connection. |
| `scripts/import-audio.ts` | Upload to Neon and store keys; retain unique names, transactional duplicate protection, safe cleanup, and compatible report field names. |
| `scripts/lib/import-plan.ts` | Use bundled FFprobe or `FFPROBE_PATH`; retain content, duration, hash, and path validation. |
| `scripts/verify-neon.ts` | Repeatable live HTTP/database/storage checks with isolated progress cleanup. |
| `tests/backend.test.ts` | Object-key/path-escape and direct-connection coverage in place of Vercel URL assumptions. |
| `tests/import-plan.test.ts` | Windows-compatible junction test and canonical-path comparison for Windows short-name temp paths. |
| `README.md`, `docs/importing.md`, `docs/deployment.md`, `docs/qa.md`, this report | Updated setup, import, deployment, and actual verification status. |
| Ignored local artifacts | `build-neon.log`, `verify-neon.log`, and `import-report-neon*` preserve evidence; `.next` was regenerated. |

The existing Drizzle ORM, Neon HTTP query driver, WebSocket transaction driver, UI, local recordings, catalog fallback, and progress behavior were retained. Native S3 requests support the existing streaming/HEAD/range interface. References: [Neon connection methods](https://neon.com/docs/connect/choose-connection), [S3 compatibility](https://neon.com/docs/storage/s3-compatibility).

## Command evidence

```text
neon init -y --no-agent-setup --no-config --org-id org-solitary-moon-96446296 --project-id empty-violet-98021358 --branch production
Linked .neon
  Project         tcf-listening (empty-violet-98021358)
  Branch          production
  Org             org-solitary-moon-96446296
Pulled 7 Neon variables into .env
Neon setup complete.

neon deploy
→ Applying to branch production (br-divine-art-b5uwwntn)
No changes — branch production already matches the policy.
Utilized services: Postgres, Object Storage
Pulled 7 Neon variables into .env

npm run db:migrate
[✓] migrations applied successfully!

Audio import:
Validated : 39
Imported  : 39
Failed    : 0
Errors    : 0
```

```text
npm run build
> next build --webpack
✓ Compiled successfully in 3.8s
Finished TypeScript in 2.5s
✓ Generating static pages using 7 workers (2/2)
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /api/audio/[questionId]
├ ƒ /api/progress
└ ƒ /api/tests
Exit code: 0

npm start -- --port 3000 --hostname 127.0.0.1
✓ Ready in 231ms

npm run verify:neon -- http://127.0.0.1:3000
PASS page: HTTP 200, no service credentials in HTML
PASS Postgres catalog: persistence=cloud, 43 tests
PASS Neon storage: 39/39 recordings streamed through the app; every SHA-256 matches
PASS playback HTTP semantics: HEAD 200, byte/suffix ranges 206, invalid 400, out-of-bounds 416
PASS private bucket: unsigned object request denied (403)
PASS Postgres progress: POST/GET round-trip, verified stored row, isolated sessions, cross-origin write denied
PASS cleanup: temporary verification progress removed
Neon end-to-end verification passed.
Exit code: 0
```

Also passed: `npm test` (22 passed, zero failed/skipped), `npm run lint`, and `npm run typecheck`. `npm audit --omit=dev --json` reported zero production vulnerabilities. The full install audit reported 21 development dependency vulnerabilities (20 moderate, one high); no unrelated forced upgrades were made.

## Failures and recovery

- Sandboxed npm network access failed with `ENOTFOUND`; installation with authorized network access succeeded.
- PowerShell misinterpreted the unquoted services list. Quoting `'postgres,object-storage'` fixed it. The failed invocation also printed a Windows libuv shutdown assertion.
- CLI OAuth initially failed with `invalid_grant`. The existing MCP connection allowed work to continue. Later CLI retries authenticated successfully, completing initialization and deployment.
- Automatic approval review rejected copying an MCP bearer key into the CLI as an unauthorized credential transfer. That action did not execute; no workaround transferred the key. Supported MCP tools and the later working CLI session completed setup.
- Turbopack's CSS worker failed inside and outside the sandbox. Webpack compiled successfully. A later webpack cache error (`WasmHash` reading `length`) cleared after deleting only generated `.next` output; final `npm run build` passed.
- The filesystem test could not create links inside the sandbox and compared Windows short/long paths literally. The portable junction/canonical-path test passed outside the sandbox with the full suite.
- Browser fetching of the exact Markdown skill URL failed; fetching that same URL through PowerShell succeeded.

Live service verification covers real HTTP routes and Postgres, not a new browser playback or hosted Vercel pass. Previous local-browser checks remain recorded separately in `qa.md`.
