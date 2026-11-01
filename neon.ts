import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  buckets: {
    "tcf-audio-files": { access: "private" },
  },
});
