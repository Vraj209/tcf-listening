import { sql, relations } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const tests = pgTable("tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  testNumber: integer("test_number").notNull(),
  title: text("title").notNull(),
  totalQuestions: integer("total_questions").notNull().default(0),
  ...timestamps,
}, (table) => [
  unique("tests_number_unique").on(table.testNumber),
  check("tests_number_range", sql`${table.testNumber} between 1 and 43`),
  check("tests_question_count_nonnegative", sql`${table.totalQuestions} >= 0`),
]);

export const questions = pgTable("questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  questionNumber: integer("question_number").notNull(),
  // Neon bucket object key; the browser receives only /api/audio/<id>.
  audioUrl: text("audio_url").notNull(),
  audioDuration: doublePrecision("audio_duration"),
  audioFilename: text("audio_filename").notNull(),
  audioMimeType: text("audio_mime_type").notNull(),
  ...timestamps,
}, (table) => [
  unique("questions_test_number_unique").on(table.testId, table.questionNumber),
  unique("questions_test_id_unique").on(table.testId, table.id),
  check("questions_number_positive", sql`${table.questionNumber} > 0`),
  check("questions_duration_positive", sql`${table.audioDuration} is null or (${table.audioDuration} > 0 and ${table.audioDuration} < 'Infinity'::float8)`),
  check("questions_audio_url_present", sql`length(${table.audioUrl}) > 0`),
]);

export const listeningProgress = pgTable("listening_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  anonymousSessionId: uuid("anonymous_session_id").notNull(),
  testId: uuid("test_id").notNull(),
  questionId: uuid("question_id").notNull(),
  lastPlaybackPosition: doublePrecision("last_playback_position").notNull().default(0),
  isPlayed: boolean("is_played").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("progress_session_question_unique").on(table.anonymousSessionId, table.questionId),
  foreignKey({
    name: "progress_question_test_fk",
    columns: [table.testId, table.questionId],
    foreignColumns: [questions.testId, questions.id],
  }).onDelete("cascade"),
  index("progress_session_updated_idx").on(table.anonymousSessionId, table.updatedAt),
  index("progress_question_idx").on(table.testId, table.questionId),
  check("progress_position_nonnegative", sql`${table.lastPlaybackPosition} >= 0 and ${table.lastPlaybackPosition} < 'Infinity'::float8`),
]);

export const testsRelations = relations(tests, ({ many }) => ({ questions: many(questions) }));
export const questionsRelations = relations(questions, ({ one }) => ({
  test: one(tests, { fields: [questions.testId], references: [tests.id] }),
}));
