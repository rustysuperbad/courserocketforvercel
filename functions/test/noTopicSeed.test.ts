import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(process.cwd(), "..");

const BANNED = [
  "No approved sources for this topic yet",
  "ingest sources first",
  "Try a networking topic",
  "networking-concepts.json",
  "networking-sources.json",
  "seed-networking",
  "NETWORKING_SOURCE_CHUNKS",
];

const BANNED_FILES = [
  "functions/data/networking-concepts.json",
  "functions/data/networking-sources.json",
  "functions/src/networking-concepts.json",
  "functions/src/seed-networking.ts",
  "functions/src/catalog.ts",
  "functions/eval/networking-prompts.json",
];

test("topic-specific seeds, whitelists and the old ingest error cannot reappear", () => {
  for (const rel of BANNED_FILES) {
    assert.equal(existsSync(join(ROOT, rel)), false, `seed file came back: ${rel}`);
  }
  const pattern = BANNED.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const roots = [
    join(ROOT, "functions/src"),
    join(ROOT, "functions/data"),
    join(ROOT, "functions/eval"),
    join(ROOT, "functions/prompts"),
    join(ROOT, "src/lib"),
  ].filter((dir) => existsSync(dir));
  let output = "";
  try {
    output = execFileSync("rg", [
      "-n",
      "-g", "!noTopicSeed.test.ts",
      pattern,
      ...roots,
    ], { encoding: "utf8" });
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    if (err.status === 1) output = "";
    else output = String(err.stdout || error);
  }
  assert.equal(output.trim(), "", `banned seed/copy leaked:\n${output}`);
});
