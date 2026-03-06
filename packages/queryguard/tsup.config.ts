import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "supabase/index": "src/supabase/index.ts",
    "react/index": "src/react/index.tsx",
    "server/index": "src/server/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ["react", "react-dom"],
  esbuildOptions(options) {
    options.banner = {
      js: "/* QueryGuard v0.1.0 — MIT License — https://github.com/wilsonguenther-dev/queryguard */",
    };
  },
});
