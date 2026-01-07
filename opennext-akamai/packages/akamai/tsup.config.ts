import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types/index.ts",
    "src/cache/edgekv.ts",
    "src/cache/object-storage.ts",
    "src/cache/multi-tier.ts",
    "src/queue/redis-streams.ts",
    "src/wrappers/edgeworkers.ts",
    "src/wrappers/fermyon.ts",
    "src/converters/akamai-cdn.ts",
    "src/adapters/lke.ts",
    "src/cli/index.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "ioredis",
    "commander",
    "picocolors",
    "glob",
    "mime-types",
  ],
});
