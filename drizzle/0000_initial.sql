CREATE TABLE "listening_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_session_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"last_playback_position" double precision DEFAULT 0 NOT NULL,
	"is_played" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_session_question_unique" UNIQUE("anonymous_session_id","question_id"),
	CONSTRAINT "progress_position_nonnegative" CHECK ("listening_progress"."last_playback_position" >= 0 and "listening_progress"."last_playback_position" < 'Infinity'::float8)
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"question_number" integer NOT NULL,
	"audio_url" text NOT NULL,
	"audio_duration" double precision,
	"audio_filename" text NOT NULL,
	"audio_mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_test_number_unique" UNIQUE("test_id","question_number"),
	CONSTRAINT "questions_test_id_unique" UNIQUE("test_id","id"),
	CONSTRAINT "questions_number_positive" CHECK ("questions"."question_number" > 0),
	CONSTRAINT "questions_duration_positive" CHECK ("questions"."audio_duration" is null or ("questions"."audio_duration" > 0 and "questions"."audio_duration" < 'Infinity'::float8)),
	CONSTRAINT "questions_audio_url_present" CHECK (length("questions"."audio_url") > 0)
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_number" integer NOT NULL,
	"title" text NOT NULL,
	"total_questions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tests_number_unique" UNIQUE("test_number"),
	CONSTRAINT "tests_number_range" CHECK ("tests"."test_number" between 1 and 43),
	CONSTRAINT "tests_question_count_nonnegative" CHECK ("tests"."total_questions" >= 0)
);
--> statement-breakpoint
ALTER TABLE "listening_progress" ADD CONSTRAINT "progress_question_test_fk" FOREIGN KEY ("test_id","question_id") REFERENCES "public"."questions"("test_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "progress_session_updated_idx" ON "listening_progress" USING btree ("anonymous_session_id","updated_at");--> statement-breakpoint
CREATE INDEX "progress_question_idx" ON "listening_progress" USING btree ("test_id","question_id");
--> statement-breakpoint
INSERT INTO "tests" ("test_number", "title")
SELECT n, 'Test ' || lpad(n::text, 2, '0') FROM generate_series(1, 43) AS n
ON CONFLICT ("test_number") DO NOTHING;
