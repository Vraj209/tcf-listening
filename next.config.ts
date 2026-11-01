import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["terminal.local"],
  webpack(config, { dev }) {
    // Persistent filesystem snapshots repeatedly fail while hashing symlinked
    // directories on this Windows host. Keep the normal cache on other platforms.
    if (process.platform === "win32" && !dev) config.cache = false;
    return config;
  },
  async headers() { return [{ source: "/(.*)", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" }
  ] }]; }
};
export default nextConfig;
