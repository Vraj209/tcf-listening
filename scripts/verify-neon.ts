import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { listeningProgress, questions } from "../src/db/schema";
import { AUDIO_BUCKET } from "../src/db/storage";
import { SESSION_COOKIE } from "../src/lib/progress";
import type { CatalogResult, ListeningProgressRecord } from "../src/lib/types";
import { validateSourceManifest } from "./download-all-audio";

async function verify() {
  for (const path of [".env.local", ".env"]) {
    try { process.loadEnvFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const { values, positionals } = parseArgs({ options: { all: { type: "boolean", default: false } }, allowPositionals: true });
  assert.ok(positionals.length <= 1, "Usage: npm run verify:neon -- [http://localhost:3000] [--all]");
  const base = new URL(positionals[0] || "http://localhost:3000");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Run this check against the local app connected to Neon.");
  const request = (path: string, options?: RequestInit) => fetch(new URL(path, base), {
    ...options, signal: AbortSignal.timeout(30_000), redirect: "manual",
  });
  const page = await request("/");
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "DATABASE_URL"] as const) {
    assert.ok(process.env[key], `${key} must be configured`);
    assert.ok(!html.includes(process.env[key]!), `${key} leaked into HTML`);
  }
  console.log("PASS page: HTTP 200, no service credentials in HTML");

  const response = await request("/api/tests");
  assert.equal(response.status, 200);
  const catalog = await response.json() as CatalogResult;
  assert.equal(catalog.persistence, "cloud");
  assert.equal(catalog.error, undefined);
  assert.equal(catalog.tests.length, 43);
  type File = { path: string; testNumber: number; questionNumber: number; sha256: string; bytes: number; mimeType: string };
  let files: File[];
  if (values.all) {
    const manifest = validateSourceManifest(JSON.parse(await readFile("data/all-tests-audio-sources.json", "utf8")));
    for (const test of catalog.tests) {
      assert.equal(test.questions.length, manifest.expectedQuestions[String(test.testNumber)], `Test ${test.testNumber} question count`);
      assert.equal(test.totalQuestions, test.questions.length);
    }
    files = manifest.files.map((file) => ({ ...file, path: `audio-import/${file.path}`, bytes: file.sizeBytes, mimeType: file.audioMimeType }));
  } else {
    files = (JSON.parse(await readFile("data/audio-manifest.json", "utf8")) as { files: File[] }).files;
  }
  const first = catalog.tests[0].questions[0];
  assert.ok(first, "Import the supplied recordings before verifying");
  console.log(`PASS Postgres catalog: persistence=cloud, ${catalog.tests.length} tests, ${catalog.tests.reduce((sum, test) => sum + test.questions.length, 0)} questions`);

  async function verifyFile(file: File) {
    const question = catalog.tests.find((test) => test.testNumber === file.testNumber)?.questions
      .find((item) => item.questionNumber === file.questionNumber);
    assert.ok(question, `Missing Test ${file.testNumber} Question ${file.questionNumber}`);
    assert.equal(question.audioUrl, `/api/audio/${question.id}`);
    const audio = await request(question.audioUrl);
    assert.equal(audio.status, 200, `Audio failed for Question ${file.questionNumber}`);
    assert.equal(audio.headers.get("content-type"), file.mimeType);
    const bytes = new Uint8Array(await audio.arrayBuffer());
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
  let next = 0;
  let checked = 0;
  async function worker() {
    while (next < files.length) {
      await verifyFile(files[next++]);
      checked++;
      if (values.all && checked % 100 === 0) console.log(`Verified ${checked}/${files.length} cloud recordings.`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`PASS Neon storage: ${files.length}/${files.length} recordings streamed through the app; every SHA-256 matches`);

  const formats = [...new Map(files.map((file) => [file.mimeType, file])).values()];
  for (const sample of formats) {
    const question = catalog.tests.find((test) => test.testNumber === sample.testNumber)!.questions.find((item) => item.questionNumber === sample.questionNumber)!;
    const source = new Uint8Array(await readFile(sample.path));
    const head = await request(question.audioUrl, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get("content-length")), source.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    for (const [range, start, end] of [["bytes=0-1023", 0, 1023], ["bytes=-128", source.length - 128, source.length - 1]] as const) {
      const partial = await request(question.audioUrl, { headers: { Range: range } });
      assert.equal(partial.status, 206);
      assert.equal(partial.headers.get("content-range"), `bytes ${start}-${end}/${source.length}`);
      assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), source.slice(start, end + 1));
    }
    const invalid = await request(question.audioUrl, { headers: { Range: "bytes=3-1" } });
    assert.equal(invalid.status, 400);
    const beyond = await request(question.audioUrl, { headers: { Range: `bytes=${source.length + 100}-` } });
    assert.equal(beyond.status, 416);
    await beyond.arrayBuffer();
  }
  console.log(`PASS playback HTTP semantics: HEAD 200, byte/suffix ranges 206, invalid 400, out-of-bounds 416 (${formats.map((file) => file.mimeType).join(", ")})`);

  const db = getDb();
  const [stored] = await db.select({ key: questions.audioUrl }).from(questions).where(eq(questions.id, first.id));
  assert.ok(stored?.key.startsWith("tcf/"));
  const raw = `${process.env.AWS_ENDPOINT_URL_S3!.replace(/\/$/, "")}/${AUDIO_BUCKET}/${stored.key.split("/").map(encodeURIComponent).join("/")}`;
  const anonymous = await fetch(raw, { signal: AbortSignal.timeout(30_000), redirect: "manual" });
  assert.ok([401, 403].includes(anonymous.status), "Private object must reject unsigned requests");
  await anonymous.arrayBuffer();
  console.log(`PASS private bucket: unsigned object request denied (${anonymous.status})`);

  const sessionId = randomUUID();
  const cookie = `${SESSION_COOKIE}=${sessionId}`;
  const input = { questionId: first.id, lastPlaybackPosition: 3.25, isPlayed: true };
  try {
    const write = await request("/api/progress", {
      method: "POST", headers: { Cookie: cookie, Origin: base.origin, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(write.status, 200);
    assert.deepEqual(await write.json(), { saved: true, persistence: "cloud" });
    const reread = await request("/api/progress", { headers: { Cookie: cookie } });
    assert.equal(reread.status, 200);
    const saved = await reread.json() as { persistence: string; progress: ListeningProgressRecord[] };
    assert.equal(saved.persistence, "cloud");
    assert.deepEqual(saved.progress, [input]);
    const [row] = await db.select().from(listeningProgress).where(eq(listeningProgress.anonymousSessionId, sessionId));
    assert.equal(row.questionId, first.id);
    assert.equal(row.lastPlaybackPosition, 3.25);
    assert.equal(row.isPlayed, true);
    const other = await request("/api/progress", { headers: { Cookie: `${SESSION_COOKIE}=${randomUUID()}` } });
    assert.deepEqual((await other.json()).progress, []);
    const forbidden = await request("/api/progress", {
      method: "POST", headers: { Origin: "https://unrelated.example", "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    assert.equal(forbidden.status, 403);
    console.log("PASS Postgres progress: POST/GET round-trip, verified stored row, isolated sessions, cross-origin write denied");
  } finally {
    // Delete only the temporary anonymous session generated by this verification run.
    await db.delete(listeningProgress).where(eq(listeningProgress.anonymousSessionId, sessionId));
  }
  console.log("PASS cleanup: temporary verification progress removed");
  console.log("Neon end-to-end verification passed.");
}

verify().catch((error) => {
  // Avoid printing fetch URLs or driver errors that might contain credentials.
  console.error(error instanceof assert.AssertionError ? error.message : "Verification failed: check the running app and Neon configuration.");
  process.exitCode = 1;
});
