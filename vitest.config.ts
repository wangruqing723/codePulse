import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const raycastApiStub = fileURLToPath(
  new URL("./test/raycast-api.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@raycast/api": raycastApiStub,
    },
  },
});
