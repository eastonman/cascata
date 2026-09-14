#!/usr/bin/env bun
/**
 * Fails the build if the shipped bundle outgrows its budget.
 *
 * Cascata has no runtime dependencies and is meant to keep it that way, so the
 * useful thing to catch is not slow creep but a single commit that pulls a
 * library in. The budgets are therefore set at roughly 1.7x the current size:
 * loose enough never to fire on ordinary feature work, tight enough that
 * bundling anything substantial trips it.
 *
 * Raw bytes rather than gzip: gzip flatters a bundle that repeats itself, and
 * the number that matters for a first visit on a phone is what crosses the
 * wire uncompressed in the worst case.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const BUDGETS: Record<string, number> = {
  ".js": 75 * 1024,
  ".css": 8 * 1024,
};

const DIST = "dist/assets";

function fmt(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

const totals: Record<string, number> = {};
let files: string[];
try {
  files = await readdir(DIST);
} catch {
  console.error(`No ${DIST}. Run \`bun run build\` first.`);
  process.exit(1);
}

for (const name of files) {
  const ext = name.slice(name.lastIndexOf("."));
  if (!(ext in BUDGETS)) continue;
  const { size } = await stat(join(DIST, name));
  totals[ext] = (totals[ext] ?? 0) + size;
}

let failed = false;
for (const [ext, budget] of Object.entries(BUDGETS)) {
  const used = totals[ext] ?? 0;
  const pct = Math.round((used / budget) * 100);
  const line = `${ext.padEnd(5)} ${fmt(used).padStart(9)} / ${fmt(budget).padStart(9)}  (${pct}%)`;
  if (used > budget) {
    console.error(`OVER  ${line}`);
    failed = true;
  } else {
    console.log(`ok    ${line}`);
  }
}

if (failed) {
  console.error(
    "\nBundle over budget. If the growth is intended, raise the budget in this " +
      "file in the same commit, so the increase is reviewed rather than absorbed.",
  );
  process.exit(1);
}
