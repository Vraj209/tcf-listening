import type { ListeningProgressRecord } from "./types";

export const SESSION_COOKIE = "tcf-listening-session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseProgressInput(value: unknown): ListeningProgressRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!isUuid(input.questionId) || typeof input.lastPlaybackPosition !== "number" ||
    !Number.isFinite(input.lastPlaybackPosition) || input.lastPlaybackPosition < 0 ||
    input.lastPlaybackPosition > 86400 || typeof input.isPlayed !== "boolean") return null;
  return {
    questionId: input.questionId,
    lastPlaybackPosition: input.lastPlaybackPosition,
    isPlayed: input.isPlayed,
  };
}

/** Browser writes must originate from this application, not a third-party form. */
export function isSameOriginWrite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser clients are still scoped to their own cookie.
  try {
    const expectedHost = request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
}
