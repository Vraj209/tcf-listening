import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateCatalog } from "../src/lib/catalog";
import { isSameOriginWrite, parseProgressInput } from "../src/lib/progress";
import { audioResponseHeaders, validByteRange } from "../src/db/audio";
import { validAudioKey } from "../src/db/storage";
import { directDatabaseUrl } from "../src/db/connection";

const id = "a53de49c-4bb8-4f3a-a15f-c4b79ad46b6d";
const question = {
  id, testId: "test-1", questionNumber: 3,
  audioUrl: "/audio/test-01/question-03.mp3", audioDuration: 42,
  audioFilename: "question-03.mp3", audioMimeType: "audio/mpeg",
};
const catalog = { tests: [{ id: "test-1", testNumber: 1, title: "Test 01", totalQuestions: 99, questions: [question] }] };

test("catalog preserves actual sparse question order and derives available count", () => {
  const parsed = validateCatalog(catalog);
  assert.equal(parsed.length, 43);
  assert.equal(parsed[0].totalQuestions, 1);
  assert.equal(parsed[0].questions[0].questionNumber, 3);
  assert.equal(parsed[1].questions.length, 0);
});

test("catalog rejects duplicate or mismatched audio mappings", () => {
  assert.throws(() => validateCatalog({ tests: [{ ...catalog.tests[0], questions: [question, { ...question, id: "other" }] }] }), /Duplicate/);
  assert.throws(() => validateCatalog({ tests: [{ ...catalog.tests[0], questions: [{ ...question, testId: "wrong-test" }] }] }), /Invalid/);
  assert.throws(() => validateCatalog({ tests: [{ ...catalog.tests[0], questions: [{ ...question, audioUrl: "javascript:alert(1)" }] }] }), /Invalid/);
});

test("supplied audio manifest contains valid unique mappings", async () => {
  const parsed = validateCatalog(JSON.parse(await readFile("data/catalog.json", "utf8")));
  assert.equal(parsed.length, 43);
  for (const item of parsed) assert.equal(item.totalQuestions, item.questions.length);
});

test("progress rejects invalid IDs, negative values, NaN and unbounded positions", () => {
  const valid = { questionId: id, lastPlaybackPosition: 12.5, isPlayed: true };
  assert.deepEqual(parseProgressInput(valid), valid);
  for (const value of [-1, Number.NaN, Infinity, 86401, "12"]) {
    assert.equal(parseProgressInput({ ...valid, lastPlaybackPosition: value }), null);
  }
  assert.equal(parseProgressInput({ ...valid, questionId: "not-a-uuid" }), null);
  assert.equal(parseProgressInput({ ...valid, isPlayed: "true" }), null);
});

test("progress rejects cross-site writes", () => {
  assert.equal(isSameOriginWrite(new Request("https://listening.example/api/progress", { headers: { origin: "https://attacker.example" } })), false);
  assert.equal(isSameOriginWrite(new Request("https://listening.example/api/progress", { headers: { origin: "https://listening.example", "sec-fetch-site": "same-origin" } })), true);
  assert.equal(isSameOriginWrite(new Request("https://listening.example/api/progress", { headers: { "sec-fetch-site": "cross-site" } })), false);
});

test("private audio accepts only imported object keys and rejects URLs and path escapes", () => {
  assert.equal(validAudioKey("tcf/test-01/question-01-abcdef1234567890-unique.mp3"), true);
  for (const key of ["https://attacker.example/q.mp3", "/tcf/q.mp3", "tcf/../secret", "tcf/%2e%2e/secret",
    "tcf//q.mp3", "tcf/q.mp3?signature=bad", "tcf\\q.mp3", "other/q.mp3", "tcf/" + "a".repeat(1024)]) {
    assert.equal(validAudioKey(key), false);
  }
});

test("migration connection removes only the Neon pooler suffix", () => {
  const pooled = "postgresql://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
  assert.equal(new URL(directDatabaseUrl(pooled)).hostname, "ep-example.us-east-2.aws.neon.tech");
  assert.equal(new URL(directDatabaseUrl(pooled)).searchParams.get("sslmode"), "require");
  assert.equal(directDatabaseUrl("postgresql://user:pass@custom-pooler.example/db"), "postgresql://user:pass@custom-pooler.example/db");
  assert.equal(directDatabaseUrl(""), "");
});

test("audio proxy preserves range semantics and allows safe single ranges", () => {
  for (const value of ["bytes=0-", "bytes=0-1023", "bytes=-500"]) assert.equal(validByteRange(value), true);
  for (const value of ["bytes=-0", "bytes=100-20", "bytes=1-3,5-7", "bytes=", "bytes=1.5-20"]) assert.equal(validByteRange(value), false);
  const headers = audioResponseHeaders(new Headers({
    "content-range": "bytes 0-1023/4000", "content-length": "1024", "accept-ranges": "bytes",
    "set-cookie": "must-not-leak", "authorization": "must-not-leak",
  }), "audio/mpeg");
  assert.equal(headers.get("content-range"), "bytes 0-1023/4000");
  assert.equal(headers.get("content-length"), "1024");
  assert.equal(headers.get("accept-ranges"), "bytes");
  assert.equal(headers.get("set-cookie"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("cache-control"), "private, no-store");
});
