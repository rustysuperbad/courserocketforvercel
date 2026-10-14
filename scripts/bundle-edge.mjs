import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function v3PromptsDefine() {
  const dir = "functions/prompts/v3";
  const map = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    map[file.slice(0, -3)] = readFileSync(join(dir, file), "utf8").trim();
  }
  return JSON.stringify(JSON.stringify(map));
}

const common = [
  "--bundle",
  "--format=esm",
  "--platform=browser",
  "--target=es2022",
  `--define:__V3_PROMPTS__=${v3PromptsDefine()}`,
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
