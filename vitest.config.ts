import { join } from "node:path";
import { defineConfig } from "vitest/config";

// The sandbox home cache is not writable in some environments; keep vite/vitest
// scratch space inside the project (tmp/ is git-ignored).
const tmp = join(process.cwd(), "tmp");
process.env.TMPDIR = tmp;
process.env.XDG_CACHE_HOME = join(tmp, "xdg");

export default defineConfig({
  cacheDir: join(tmp, "vite-cache"),
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
