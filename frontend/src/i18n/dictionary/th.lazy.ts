/**
 * Everything Thai, in ONE lazily-imported module.
 *
 * Both halves are pulled in here rather than imported separately by ../translate.ts so the bundler
 * emits a single chunk per language: two dynamic imports would mean two round trips before the
 * first Thai screen can render, for a pair of files that are never useful apart.
 *
 * Nothing may import this statically. The whole point is that the Thai dictionary — 380 KB of
 * source — is fetched only by a session that is actually speaking Thai; a static import anywhere
 * would pull it back into the entry chunk and every English and Chinese session would pay for it
 * again. ../translate.ts reaches it through `import()` alone.
 */
import { th } from "./th";
import { thPatterns } from "./th.patterns";

export default { exact: th, patterns: thPatterns };
