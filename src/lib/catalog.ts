import { readFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { questions, tests } from "../db/schema";
import type { CatalogResult, QuestionRecord, TestRecord } from "./types";

export function emptyCatalog(): TestRecord[] {
  return Array.from({ length: 43 }, (_, index) => ({
    id: `unavailable-test-${index + 1}`,
    testNumber: index + 1,
    title: `Test ${String(index + 1).padStart(2, "0")}`,
    totalQuestions: 0,
    questions: [],
  }));
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Reject malformed mappings before the browser can play an incorrect recording. */
export function validateCatalog(value: unknown): TestRecord[] {
  if (!isObject(value) || !Array.isArray(value.tests)) throw new Error("Invalid catalog.");
  const result = emptyCatalog();
  const seenTests = new Set<number>();
  const seenTestIds = new Set<string>();
  const seenQuestionIds = new Set<string>();
  for (const test of value.tests) {
    if (!isObject(test) || !Number.isInteger(test.testNumber) ||
      (test.testNumber as number) < 1 || (test.testNumber as number) > 43 ||
      !isText(test.id) || !isText(test.title) || !Array.isArray(test.questions)) {
      throw new Error("Invalid test record.");
    }
    const testNumber = test.testNumber as number;
    if (seenTests.has(testNumber) || seenTestIds.has(test.id)) throw new Error("Duplicate test record.");
    seenTests.add(testNumber);
    seenTestIds.add(test.id);
    const seenNumbers = new Set<number>();
    const mappedQuestions: QuestionRecord[] = [];
    for (const question of test.questions) {
      if (!isObject(question) || !isText(question.id) || question.testId !== test.id ||
        !Number.isInteger(question.questionNumber) || (question.questionNumber as number) < 1 ||
        !isText(question.audioUrl) || !/^(https:\/\/[^/]|\/(?!\/))/.test(question.audioUrl) ||
        !isText(question.audioFilename) || !isText(question.audioMimeType) ||
        !question.audioMimeType.startsWith("audio/") ||
        !(question.audioDuration === null || (typeof question.audioDuration === "number" &&
          Number.isFinite(question.audioDuration) && question.audioDuration > 0))) {
        throw new Error(`Invalid question mapping in test ${testNumber}.`);
      }
      const questionNumber = question.questionNumber as number;
      if (seenNumbers.has(questionNumber) || seenQuestionIds.has(question.id)) {
        throw new Error(`Duplicate question mapping in test ${testNumber}.`);
      }
      seenNumbers.add(questionNumber);
      seenQuestionIds.add(question.id);
      mappedQuestions.push({
        id: question.id,
        testId: test.id,
        questionNumber,
        audioUrl: question.audioUrl,
        audioDuration: question.audioDuration as number | null,
        audioFilename: question.audioFilename,
        audioMimeType: question.audioMimeType,
      });
    }
    result[testNumber - 1] = {
      id: test.id,
      testNumber,
      title: test.title,
      totalQuestions: mappedQuestions.length,
      questions: mappedQuestions.sort((a, b) => a.questionNumber - b.questionNumber),
    };
  }
  return result;
}

export async function getCatalog(): Promise<CatalogResult> {
  if (!process.env.DATABASE_URL) {
    try {
      const raw = await readFile(path.join(process.cwd(), "data", "catalog.json"), "utf8");
      return { tests: validateCatalog(JSON.parse(raw)), persistence: "local" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { tests: emptyCatalog(), persistence: "local" };
      }
      console.error("The local audio catalog could not be read or validated.");
      return { tests: emptyCatalog(), persistence: "local", error: "The audio library is temporarily unavailable." };
    }
  }

  try {
    const rows = await getDb().select({ test: tests, question: questions })
      .from(tests)
      .leftJoin(questions, eq(tests.id, questions.testId))
      .orderBy(asc(tests.testNumber), asc(questions.questionNumber));
    const grouped = new Map<string, TestRecord>();
    for (const { test, question } of rows) {
      if (!grouped.has(test.id)) {
        grouped.set(test.id, { ...test, totalQuestions: 0, questions: [] });
      }
      if (question) grouped.get(test.id)!.questions.push({
        ...question,
        audioUrl: `/api/audio/${question.id}`,
      });
    }
    return { tests: validateCatalog({ tests: [...grouped.values()] }), persistence: "cloud" };
  } catch {
    // Do not expose connection strings or replace a broken configured DB with old demo data.
    console.error("The configured audio database is unavailable.");
    return { tests: emptyCatalog(), persistence: "local", error: "The audio library is temporarily unavailable." };
  }
}
