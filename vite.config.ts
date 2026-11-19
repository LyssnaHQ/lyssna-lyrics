import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const source = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react\/jsx-runtime$/, replacement: source("./src/host-jsx.ts") },
      { find: /^react$/, replacement: source("./src/host-react.ts") },
    ],
  },
  build: {
    target: "chrome120",
    lib: { entry: "src/plugin.tsx", formats: ["es"], fileName: () => "plugin.mjs" },
  },
});
