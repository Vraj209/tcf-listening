import assert from "node:assert/strict";
import test from "node:test";
import { clampPosition, normalizePreferences, SPEEDS } from "../src/lib/player-state";
import type { TestRecord } from "../src/lib/types";

const catalog: TestRecord[] = [
  { id: "test-1", testNumber: 1, title: "Test 01", totalQuestions: 3, questions: [1, 3, 7].map(number => ({ id: `q-${number}`, testId: "test-1", questionNumber: number, audioUrl: `/audio/question-${number}.mp3`, audioDuration: 60, audioFilename: `question-${number}.mp3`, audioMimeType: "audio/mpeg" })) },
  { id: "test-2", testNumber: 2, title: "Test 02", totalQuestions: 0, questions: [] },
  { id: "test-3", testNumber: 3, title: "Test 03", totalQuestions: 1, questions: [{ id: "test3-q4", testId: "test-3", questionNumber: 4, audioUrl: "/audio/test-3-question-4.mp3", audioDuration: null, audioFilename: "question-4.mp3", audioMimeType: "audio/mpeg" }] },
];

test("first visit uses actual first question, normal speed and disabled autoplay", () => {
  const prefs = normalizePreferences(null, catalog);
  assert.equal(prefs.testNumber, 1);
  assert.equal(prefs.questionId, "q-1");
  assert.equal(prefs.speed, 1);
  assert.equal(prefs.autoPlay, false);
  assert.deepEqual(prefs.progress, {});
});

test("restores an available question in a sparse test without inventing missing numbers", () => {
  const prefs = normalizePreferences({ testNumber: 1, questionId: "q-7", speed: 1.25, autoPlay: true, volume: 0.3 }, catalog);
  assert.equal(prefs.questionId, "q-7");
  assert.equal(prefs.speed, 1.25);
  assert.equal(prefs.autoPlay, true);
  assert.equal(prefs.volume, 0.3);
  assert.deepEqual(catalog[0].questions.map(question => question.questionNumber), [1, 3, 7]);
});

test("removed questions and questions from another test reset to first available audio", () => {
  assert.equal(normalizePreferences({ testNumber: 1, questionId: "q-2" }, catalog).questionId, "q-1");
  assert.equal(normalizePreferences({ testNumber: 3, questionId: "q-1" }, catalog).questionId, "test3-q4");
  assert.equal(normalizePreferences({ testNumber: 99, questionId: "q-1" }, catalog).testNumber, 1);
});

test("empty tests remain selected without fabricated question 1", () => {
  const prefs = normalizePreferences({ testNumber: 2, questionId: "q-1" }, catalog);
  assert.equal(prefs.testNumber, 2);
  assert.equal(prefs.questionId, "");
  assert.equal(normalizePreferences({ testNumber: 3 }, catalog).questionId, "test3-q4");
  assert.equal(normalizePreferences(null, []).questionId, "");
});

test("malformed and stale progress is discarded while genuine progress survives", () => {
  const prefs = normalizePreferences({ speed: 80, volume: Infinity, autoPlay: "true", progress: {
    "q-1": { position: 22.5, played: true },
    "q-3": { position: -5, played: "true" },
    "q-7": { position: NaN, played: false },
    "test3-q4": null,
    "removed-question": { position: 999, played: true },
  } }, catalog);
  assert.deepEqual(prefs.progress, { "q-1": { position: 22.5, played: true }, "q-3": { position: 0, played: false }, "q-7": { position: 0, played: false } });
  assert.equal(prefs.speed, 1);
  assert.equal(prefs.volume, 1);
  assert.equal(prefs.autoPlay, false);
  for (const speed of SPEEDS) assert.equal(normalizePreferences({ speed }, catalog).speed, speed);
});

test("volume and seek targets stay within playable bounds", () => {
  assert.equal(normalizePreferences({ volume: -1 }, catalog).volume, 0);
  assert.equal(normalizePreferences({ volume: 8 }, catalog).volume, 1);
  assert.equal(clampPosition(-10, 50), 0);
  assert.equal(clampPosition(61, 50), 50);
  assert.equal(clampPosition(12.25, 50), 12.25);
  assert.equal(clampPosition(Infinity, 50), 0);
  assert.equal(clampPosition(12, NaN), 0);
  assert.equal(clampPosition(12, 0), 0);
});
