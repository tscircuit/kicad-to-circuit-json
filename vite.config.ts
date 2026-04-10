import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: resolve(__dirname, "site"),
  plugins: [react()],
  resolve: {
    alias: {
      "@project-lib": resolve(__dirname, "lib/index.ts"),
    },
  },
  server: {
    fs: {
      allow: [__dirname],
    },
  },
  build: {
    outDir: resolve(__dirname, "dist-site"),
    emptyOutDir: true,
  },
})
