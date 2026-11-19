import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// jsdom because the units under test import from firewall-policy/create.tsx, which pulls in
// browser-oriented UI libs at module load. Tests themselves render nothing — they exercise the pure
// CLI parsers / helpers.
export default defineConfig({
  // Same JSX runtime the app builds with, so a test renders what a browser renders - including the
  // translation layer. Without it the .tsx tests would compile against React's runtime and quietly
  // exercise a different program than production does.
  plugins: [react({ jsxImportSource: "i18n-jsx" })],
  resolve: {
    alias: { "i18n-jsx": fileURLToPath(new URL("./src/i18n", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
