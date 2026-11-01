# Verification notes

## Completed checks — 1 November 2026

- Full-library import: all 1,677 files verified; 1,638 uploaded and 39 existing questions skipped, with zero failures or missing questions. The environment files were unchanged.
- Full-library live verification: the app returned 43 tests with 39 questions each; all 1,677 streamed files matched their source SHA-256 and MIME type. MP3, WAV, and OGG HEAD/range checks passed. Unsigned bucket access returned 403; progress round-tripped through Postgres with session isolation and temporary-row cleanup.
- Production build, TypeScript, ESLint, and all 32 automated tests passed. Two consecutive builds passed without clearing generated output after disabling webpack's persistent filesystem cache for Windows production builds. Other platforms retain the normal cache.
- Full-library evidence is in `reports/neon-all-tests/`; [the import guide](neon-all-tests.md) records the commands and file organization. The browser checks below are historical checks of the original local fallback, not a new browser pass of the full collection.
- Chrome production preview: play/pause, correct recording after N/next, exactly one audio element, one active question, ten-second skip, 1.25× speed, and saved question/20.73-second position after reload verified.
- Auto-play next advanced from Question 02 to Question 03 and started it. Test 43 remained empty with zero question controls and no audio source. The searchable selector listed all 43 tests with actual counts.
- Responsive production preview reviewed at 390px mobile and 768px tablet frame widths, plus desktop. Mobile content width and scroll width both measured 375px (390px frame minus scrollbar), with no horizontal page overflow. Question 39 scrolled into view and Next was disabled at the final question. Light and dark appearances reviewed.
- All 39 supplied recordings passed full FFmpeg decoding; import dry-run mapped all 39 successfully.
- Live Neon integration is now verified against production: the migration passed on an isolated branch and production; all 39 recordings were imported; every streamed recording matched its SHA-256; HEAD and byte/suffix range requests passed; unsigned bucket access returned 403; progress round-tripped through the app and was independently checked in Postgres. Temporary verification progress was removed. See [the setup report](neon-setup.md) for command output.
- The earlier Chrome UI checks above used local audio. This integration's connected-service checks use the production HTTP routes, not a fresh browser playback pass. Safari, Firefox, and physical iOS/Android devices have not been tested.

Run a production build with a development server stopped; do not build into an active dev server's generated `.next` output. A clean production build was used for the browser checks above.

## Automated checks

`npm test` runs focused Node tests for catalog/progress validation, safe downloads, cache integrity, manifest hashes, audio import validation, and browser preference normalization. Player preference tests cover sparse question lists, unavailable tests, removed questions, corrupt saved data, supported playback speeds, and seek bounds.

The supplied Test 1 archive was checked for complete question mapping (01–39), ZIP integrity, FFprobe metadata, and complete FFmpeg decoding. Tests 2–43 contain no invented audio.

## Browser acceptance checklist

Run these checks against the local preview and the deployed app. A checklist item is not a claim that every browser has been tested.

- At mobile, iPad, and desktop sizes, only the selected question has active styling; the page has no horizontal overflow. The active question remains visible.
- Play Test 1, pause, seek, skip ten seconds, and change playback speed. Listen for the matching recording.
- While playing, quickly switch questions and tests. Only one audio element should exist and only the selected recording should play.
- Leave a recording part-way through, switch away, then return; resume at the saved position. Repeat after reloading the page.
- On a fresh browser, auto-play next is disabled. Enable it, seek near the end, and verify advancement to the next available question. The final question must stop without looping.
- Use Space, Left/Right, N/P, and +/- with page focus and after clicking playback controls. Search fields, speed selectors, sliders, and dialogs must preserve their own keyboard behavior.
- Select an empty test and verify the `Audio not available` state with working test navigation.
- Test light/dark appearance, focus visibility, labels, and reduced-motion preference.
- Simulate an audio/network failure and verify useful recovery without overlapping playback.
- Once Neon and private object storage are configured, verify persisted anonymous progress and HTTP range seeking through the audio route. No credentials or raw private audio URLs should appear in client HTML.

Chrome, Safari, Firefox, and mobile-device playback still require their respective browser/device checks before claiming cross-browser certification.
