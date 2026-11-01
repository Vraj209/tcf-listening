/** Migrations need a direct endpoint; application queries keep DATABASE_URL pooled. */
export function directDatabaseUrl(value: string): string {
  if (!value) return value;
  const url = new URL(value);
  if (url.hostname.endsWith(".neon.tech")) {
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  }
  return url.toString();
}
