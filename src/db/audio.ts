/** Native audio clients request one byte interval at a time, including suffix ranges. */
export function validByteRange(value: string): boolean {
  if (value.length > 100 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(value)) return false;
  const [start, end] = value.slice(6).split("-");
  if (start && !Number.isSafeInteger(Number(start))) return false;
  if (end && !Number.isSafeInteger(Number(end))) return false;
  if (!start) return Number(end) > 0;
  return !end || Number(end) >= Number(start);
}

export function audioResponseHeaders(upstream: Headers, fallbackMime: string): Headers {
  const result = new Headers({
    "Content-Type": fallbackMime.startsWith("audio/") ? fallbackMime : "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.get(name);
    if (value) result.set(name, value);
  }
  return result;
}
