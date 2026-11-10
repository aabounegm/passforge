import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/; override with BASE_PATH (e.g. "/" for a custom domain).
export default defineConfig({ base: process.env.BASE_PATH ?? "/passforge/" });
