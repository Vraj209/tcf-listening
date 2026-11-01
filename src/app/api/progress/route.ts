import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { listeningProgress, questions } from "@/db/schema";
import { isSameOriginWrite, isUuid, parseProgressInput, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/progress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

function session(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  return isUuid(existing) ? existing : randomUUID();
}

function withSession(response: NextResponse, sessionId: string) {
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ progress: [], persistence: "local" }, { headers });
  const sessionId = session(request);
  try {
    const progress = await getDb().select({
      questionId: listeningProgress.questionId,
      lastPlaybackPosition: listeningProgress.lastPlaybackPosition,
      isPlayed: listeningProgress.isPlayed,
    }).from(listeningProgress).where(eq(listeningProgress.anonymousSessionId, sessionId));
    return withSession(NextResponse.json({ progress, persistence: "cloud" }, { headers }), sessionId);
  } catch {
    return NextResponse.json({ progress: [], persistence: "local", error: "Progress sync is temporarily unavailable." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginWrite(request)) return NextResponse.json({ error: "Origin not allowed." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Expected JSON." }, { status: 415, headers });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 2048) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
  }
  let input;
  try {
    const body = await request.text();
    if (body.length > 2048) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
    input = parseProgressInput(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers });
  }
  if (!input) return NextResponse.json({ error: "Invalid progress." }, { status: 400, headers });
  if (!process.env.DATABASE_URL) return NextResponse.json({ saved: false, persistence: "local" }, { headers });

  const sessionId = session(request);
  try {
    const db = getDb();
    const [question] = await db.select({ testId: questions.testId, audioDuration: questions.audioDuration })
      .from(questions).where(eq(questions.id, input.questionId)).limit(1);
    if (!question) return NextResponse.json({ error: "Question not found." }, { status: 404, headers });
    const position = question.audioDuration === null
      ? input.lastPlaybackPosition
      : Math.min(input.lastPlaybackPosition, question.audioDuration);

    await db.insert(listeningProgress).values({
      anonymousSessionId: sessionId,
      testId: question.testId,
      questionId: input.questionId,
      lastPlaybackPosition: position,
      isPlayed: input.isPlayed,
    }).onConflictDoUpdate({
      target: [listeningProgress.anonymousSessionId, listeningProgress.questionId],
      set: {
        lastPlaybackPosition: position,
        isPlayed: sql`${listeningProgress.isPlayed} or ${input.isPlayed}`,
        updatedAt: new Date(),
      },
    });
    return withSession(NextResponse.json({ saved: true, persistence: "cloud" }, { headers }), sessionId);
  } catch {
    return NextResponse.json({ saved: false, persistence: "local", error: "Progress sync is temporarily unavailable." }, { status: 503, headers });
  }
}
