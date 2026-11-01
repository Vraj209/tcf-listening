# Supplied audio inventory

The local preview contains the 39 original MP3 recordings supplied in `TCF-Test-1-Audio(1).zip`. No audio was downloaded from external test pages.

- Available: Test 01, Questions 01–39.
- Tests 02–43: empty until authorized audio is imported.
- Audio bytes: 22,418,883 (21.38 MiB).
- Combined duration: 1812.376 seconds (30 min 12.4 sec).
- Every ZIP entry passed its CRC check, matched an unambiguous question filename, and was verified by `ffprobe` as one MP3 audio stream.
- All 39 recordings also decoded end-to-end with `ffmpeg` without errors.
- No transcoding: extracted files preserve the exact original bytes.
- `data/audio-manifest.json` records source names, mapping, durations, sizes, and SHA-256 hashes.
- `data/catalog.json` is the no-database preview catalog. It has 43 tests and only the 39 verified question records.
- Deterministic UUID v5 IDs use the URL namespace with names `tcf:test:N` and `tcf:test:N:question:Q`.

The public preview audio URLs are local `/audio/test-01/question-NN.mp3` assets. The cloud import script uploads supplied files to configured object storage and stores the resulting URLs in Neon. These local assets are a self-contained preview fallback, not a claim that object storage has already been configured.

| Question | Duration (s) | Bytes |
| --- | ---: | ---: |
| 01 | 23.928 | 237,776 |
| 02 | 26.384 | 279,622 |
| 03 | 22.491 | 202,798 |
| 04 | 31.216 | 328,666 |
| 05 | 36.989 | 417,772 |
| 06 | 32.679 | 363,083 |
| 07 | 28.421 | 292,340 |
| 08 | 28.996 | 300,894 |
| 09 | 38.139 | 448,966 |
| 10 | 37.512 | 422,790 |
| 11 | 47.909 | 598,194 |
| 12 | 36.336 | 417,731 |
| 13 | 32.522 | 360,143 |
| 14 | 43.598 | 518,098 |
| 15 | 45.923 | 584,161 |
| 16 | 51.958 | 662,714 |
| 17 | 42.658 | 525,759 |
| 18 | 43.389 | 512,359 |
| 19 | 53.812 | 677,980 |
| 20 | 44.487 | 549,533 |
| 21 | 31.060 | 335,734 |
| 22 | 65.228 | 850,597 |
| 23 | 61.806 | 822,242 |
| 24 | 46.472 | 582,127 |
| 25 | 45.845 | 566,651 |
| 26 | 49.763 | 610,045 |
| 27 | 50.051 | 614,534 |
| 28 | 46.211 | 565,551 |
| 29 | 65.985 | 888,138 |
| 30 | 58.854 | 756,923 |
| 31 | 50.678 | 641,045 |
| 32 | 68.519 | 927,480 |
| 33 | 69.381 | 948,413 |
| 34 | 64.209 | 793,116 |
| 35 | 60.264 | 755,571 |
| 36 | 48.039 | 624,675 |
| 37 | 56.921 | 771,386 |
| 38 | 64.549 | 868,258 |
| 39 | 59.193 | 795,018 |
