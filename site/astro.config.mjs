import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

const site = process.env.SITE_URL ?? "https://filegrc.com";

export default defineConfig({
  site,
  integrations: [react(), sitemap()],
  server: {
    port: 3000,
  },
  vite: {
    server: {
      watch: {
        ignored: [
          "**/.git/**",
          "**/.astro/**",
          "**/dist/**",
          "**/node_modules/**",
        ],
      },
    },
  },
});
