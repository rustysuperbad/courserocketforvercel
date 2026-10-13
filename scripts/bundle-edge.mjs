import { spawnSync } from "node:child_process";

const common = [
  "--bundle",
  "--format=esm",
  "--platform=browser",
  "--target=es2022",
  "--external:node:crypto",
  "--external:node:fs",
  "--external:node:fs/promises",
  "--external:node:path",
  "--external:node:url",
];

function bundle(entry, outfile) {
  const result = spawnSync("npx", ["--yes", "esbuild", entry, `--outfile=${outfile}`, ...common], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

bundle("functions/src/gateway.ts", "supabase/functions/api/handler.js");
bundle("functions/src/inngestServe.ts", "supabase/functions/inngest/handler.js");
