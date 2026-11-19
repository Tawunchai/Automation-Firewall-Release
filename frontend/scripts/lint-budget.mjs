#!/usr/bin/env node
/**
 * A ratchet for ESLint: findings may go down, never up.
 *
 * The problem this solves. `npm run lint` reported 385 findings, so it could not be a CI gate — a
 * workflow that is red before anyone touches it teaches everyone to ignore red. The two usual ways
 * out are both bad: turning the noisy rules off loses the signal permanently, and "fix all 385
 * first" blocks every other piece of work behind days of mechanical edits, several of which need
 * somebody to click through the UI before they can be called safe.
 *
 * So the current count of each rule is written down in lint-budget.json, and this fails only when a
 * rule goes ABOVE its recorded number. New code is held to zero for every rule already at zero;
 * existing debt is frozen where it is and can be paid off in any order.
 *
 * It also fails when a count drops BELOW budget without the budget being updated. That sounds
 * pedantic and is the point: the ratchet only tightens if lowering it is part of the work that
 * lowered the count. Otherwise the file drifts into a number nobody has looked at in a year, which
 * is how these things stop meaning anything.
 *
 *   npm run lint:budget           check
 *   npm run lint:budget -- --fix  rewrite lint-budget.json from the current counts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const BUDGET_FILE = join(FRONTEND, "lint-budget.json");

// ESLint reports an unused disable directive with a null ruleId; it still deserves a budget line.
const UNRULED = "unused-eslint-disable";

// ESLint's own entry point, run with this Node. Going through `npx` would need `shell: true` on
// Windows — which Node deprecates for exactly the reason it sounds like — and would resolve a
// binary by PATH lookup when the one that matters is the project's.
const ESLINT_BIN = join(FRONTEND, "node_modules", "eslint", "bin", "eslint.js");

function currentCounts() {
  let raw;
  try {
    // ESLint exits non-zero whenever it finds anything, which is the normal case here. The JSON on
    // stdout is what matters, so a non-zero exit is read off the error instead of being thrown.
    raw = execFileSync(process.execPath, [ESLINT_BIN, ".", "-f", "json"], {
      cwd: FRONTEND,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (!err.stdout) throw err;
    raw = err.stdout;
  }

  const counts = {};
  for (const file of JSON.parse(raw)) {
    for (const msg of file.messages) {
      const rule = msg.ruleId ?? UNRULED;
      counts[rule] = (counts[rule] ?? 0) + 1;
    }
  }
  return counts;
}

function sorted(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

const counts = currentCounts();

if (process.argv.includes("--fix")) {
  writeFileSync(BUDGET_FILE, JSON.stringify(sorted(counts), null, 2) + "\n", "utf8");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`lint-budget.json written — ${total} finding(s) across ${Object.keys(counts).length} rule(s).`);
  process.exit(0);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));

const over = [];
const under = [];
for (const rule of new Set([...Object.keys(budget), ...Object.keys(counts)])) {
  const allowed = budget[rule] ?? 0;
  const found = counts[rule] ?? 0;
  if (found > allowed) over.push({ rule, allowed, found });
  else if (found < allowed) under.push({ rule, allowed, found });
}

if (over.length) {
  console.error("\nESLint findings went UP:\n");
  for (const { rule, allowed, found } of over) {
    console.error(`  ${rule}\n    budget ${allowed}, found ${found}  (+${found - allowed})`);
  }
  console.error(
    "\nFix the new findings rather than raising the budget. `npx eslint .` lists them with file\n" +
    "and line. The budget exists to freeze debt that already shipped, not to absorb more of it.\n"
  );
  process.exit(1);
}

if (under.length) {
  console.error("\nESLint findings went DOWN — please lock that in:\n");
  for (const { rule, allowed, found } of under) {
    console.error(`  ${rule}\n    budget ${allowed}, found ${found}  (-${allowed - found})`);
  }
  console.error("\n  npm run lint:budget -- --fix\n\nthen commit lint-budget.json with the change that fixed them.\n");
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`ESLint within budget: ${total} known finding(s), none new.`);
