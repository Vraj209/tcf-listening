import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { audioResponseHeaders, validByteRange } from "@/db/audio";
import { hasAudioStorage, signedAudioUrl, validAudioKey } from "@/db/storage";
import { questions } from "@/db/schema";
import { isUuid } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ questionId: string }> };
const error = (message: string, status: number) => new Response(message, {
  status,
  headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
});

async function serve(request: Request, context: RouteContext, method: "GET" | "HEAD") {
  const { questionId } = await context.params;
  if (!isUuid(questionId)) return error("Audio not found.", 404);
  if (!process.env.DATABASE_URL || !hasAudioStorage()) {
    return error("Audio is temporarily unavailable.", 503);
  }
  const range = request.headers.get("range");
  if (range && !validByteRange(range)) return error("Invalid byte range.", 400);
  try {
    const [question] = await getDb().select({ audioUrl: questions.audioUrl, audioMimeType: questions.audioMimeType })
      .from(questions).where(eq(questions.id, questionId)).limit(1);
    if (!question) return error("Audio not found.", 404);
    // The legacy audio_url column holds a branch-independent object key.
    if (!validAudioKey(question.audioUrl)) return error("Audio is temporarily unavailable.", 503);
    const url = await signedAudioUrl(question.audioUrl, method);

    const headers = new Headers({
      "Accept-Encoding": "identity",
    });
    if (range) headers.set("Range", range);
    const ifRange = request.headers.get("if-range");
    if (range && ifRange && ifRange.length <= 200) headers.set("If-Range", ifRange);

    // Native fetch streams without buffering and preserves HTTP range responses.
    // Never follow redirects while carrying the server-side storage signature.
    // Deployment Protection secures this route in the private Vercel deployment.
    const upstream = await fetch(url, {
      method,
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
    });
    if (upstream.status === 404) {
      await upstream.body?.cancel();
      return error("Audio not found.", 404);
    }
    if (![200, 206, 416].includes(upstream.status)) {
      await upstream.body?.cancel();
      return error("Audio is temporarily unavailable.", 502);
    }
    const responseHeaders = audioResponseHeaders(upstream.headers, question.audioMimeType);
    if (method === "HEAD" || upstream.status === 416) {
      await upstream.body?.cancel();
      if (upstream.status === 416) responseHeaders.delete("content-length");
      return new Response(null, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return error("Audio is temporarily unavailable.", request.signal.aborted ? 499 : 502);
  }
}

export const GET = (request: Request, context: RouteContext) => serve(request, context, "GET");
export const HEAD = (request: Request, context: RouteContext) => serve(request, context, "HEAD");
