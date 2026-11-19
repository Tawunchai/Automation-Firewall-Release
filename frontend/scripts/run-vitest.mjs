// Launch vitest with a drive letter vitest can live with.
//
// vitest 5.0.0 resolves the `vitest` package into TWO module instances when the
// working directory's Windows drive letter is cased differently from the project
// root it computes (`c:\...` vs `C:/...`). The test files then import a second,
// never-initialised copy of the runner, so every file dies at suite REGISTRATION
// with `TypeError: Cannot read properties of undefined (reading 'config')` and
// the run reports `Tests  no tests` — 123 files failing, not one of them at
// fault. Git Bash's `cd /c/Network-Automation` hands npm exactly that lowercase
// cwd, which is why the suite looked broken only from some shells.
//
// So: uppercase the drive letter and hand off. Everything else is passed through
// untouched, which keeps `npm run test -- src/lib/bucket.test.ts` working.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Only Windows local paths have a drive letter to get wrong; elsewhere both of
// these are plain pass-throughs.
const upperDrive = (p) =>
  /^[a-z]:[\\/]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p;

// `vitest/package.json` is exported; the bin itself is not, so go via the
// manifest rather than guessing the file name.
const require = createRequire(import.meta.url);
const manifestPath = require.resolve("vitest/package.json");
// The script path needs the same treatment as the cwd: a lowercase-drive bin
// path puts the child right back into the two-instance bug it is here to avoid.
const vitestBin = upperDrive(
  join(dirname(manifestPath), require(manifestPath).bin.vitest),
);

const { status, error } = spawnSync(
  process.execPath,
  [vitestBin, ...process.argv.slice(2)],
  { cwd: upperDrive(process.cwd()), stdio: "inherit" },
);

if (error) {
  console.error(error);
  process.exit(1);
}
process.exit(status ?? 1);
