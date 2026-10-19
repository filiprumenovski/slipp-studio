import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
  server: { watch: { ignored: ["**/src-tauri/**"] } },
});
