import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/; override with BASE_PATH (e.g. "/" for a custom domain).
export default defineConfig({
  base: process.env.BASE_PATH ?? "/passforge/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
