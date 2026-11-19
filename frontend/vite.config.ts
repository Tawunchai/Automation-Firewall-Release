import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Which vendor chunk a third-party package belongs to.
//
// Why split at all: the routes are already lazy-loaded, so the app's own code is well divided —
// but every dependency still landed in two ~500 kB catch-all chunks. That means a one-line change
// to a page invalidated the browser cache for recharts and FullCalendar as well, and every deploy
// re-downloaded ~700 kB of libraries that had not changed in months.
//
// The grouping is by whole PACKAGE FAMILY, never by individual module. Splitting a package across
// chunks, or interleaving app code with a library, is what produces "Cannot access X before
// initialization" at runtime; keeping each library whole and together with its own helpers avoids
// that entirely while still giving the browser something stable to cache.
const VENDOR_CHUNKS: Record<string, string[]> = {
  // React itself + the router. `scheduler` is React's own dependency and must travel with it.
  "vendor-react": ["react", "react-dom", "react-router", "react-router-dom", "scheduler"],
  // recharts is built on d3; the d3-* modules are useless on their own. It is the ONLY charting
  // stack in the app — the device dashboard, the activity timeline and the role donut all use it.
  // apexcharts used to sit alongside it for two panels on the Users page and cost 512 kB (138 kB
  // gzip) to do so; those panels were ported to recharts and the dependency removed.
  "vendor-recharts": ["recharts", "d3-", "victory-vendor", "internmap", "delaunator", "robust-predicates"],
  "vendor-calendar": ["@fullcalendar"],
  // xterm.js — only the Config Deploy terminal imports it, so it lands in that route's own chunk
  // rather than in anyone's first paint.
  "vendor-xterm": ["@xterm"],
  "vendor-i18n": ["i18next", "react-i18next"],
  "vendor-icons": ["react-icons"],
  // three.js + react-three-fiber + drei — only the Topology page's 3D view imports this, and it is
  // the single heaviest dependency in the app. Its own chunk means nobody who never opens Topology
  // (or opens it and stays on the 2D view, since Scene3D is itself lazy) ever fetches it.
  "vendor-three": ["three", "@react-three/fiber", "@react-three/drei"],
};

// packageOf extracts the npm package name from a module id, handling @scope/name.
function packageOf(id: string): string | null {
  const afterNodeModules = id.split("node_modules/").pop();
  if (!afterNodeModules) return null;
  const parts = afterNodeModules.split("/");
  return parts[0].startsWith("@") && parts[1] ? `${parts[0]}/${parts[1]}` : parts[0];
}

function chunkFor(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined; // app code keeps its route-based splitting
  const pkg = packageOf(id);
  if (!pkg) return undefined;

  for (const [chunk, prefixes] of Object.entries(VENDOR_CHUNKS)) {
    // Matching has to respect boundaries, because the entries in VENDOR_CHUNKS are three different
    // shapes: an exact name ("recharts", "react-dom"), an explicit prefix ending in a hyphen ("d3-",
    // which must claim d3-shape, d3-array and the rest), and a scope ("@xterm", "@fullcalendar",
    // whose real package names are "@xterm/xterm" and "@fullcalendar/react").
    //
    // A bare pkg.startsWith(p) collapsed all three, which let a SHORT name swallow longer ones:
    // "react" is listed first, so "react-icons" and "react-i18next" both landed in vendor-react --
    // vendor-icons was never emitted at all and vendor-i18n held i18next alone (42 kB). The comment
    // that used to sit here claimed the opposite ("react-icons never matches react"), and the
    // ORDER of the object above was quietly deciding the bundle.
    if (
      prefixes.some(
        (p) => pkg === p || (p.endsWith("-") && pkg.startsWith(p)) || pkg.startsWith(`${p}/`),
      )
    ) {
      return chunk;
    }
  }
  return undefined; // anything unlisted stays in Rollup's default grouping
}

/**
 * Keeps the translating JSX runtime out of the dev dependency pre-bundle.
 *
 * `optimizeDeps.exclude` below states the intent, but it cannot win on its own: @vitejs/plugin-react
 * adds `<jsxImportSource>/jsx-runtime` and `/jsx-dev-runtime` to `optimizeDeps.include` from its own
 * config hook — reasonably, since for every other project that name really is a package — and
 * include beats exclude. So the entries are taken back out once the config is final, which is the
 * first moment both halves exist and still before the optimizer scans.
 *
 * Production is unaffected either way: `vite build` runs Rollup, which has no dep optimizer.
 */
function keepI18nRuntimeUnbundled(): PluginOption {
  return {
    name: "i18n-jsx-no-prebundle",
    enforce: "post",
    configResolved(resolved) {
      const include = resolved.optimizeDeps?.include;
      if (!include) return;
      resolved.optimizeDeps.include = include.filter((dep) => !dep.startsWith("i18n-jsx/"));
    },
  };
}

export default defineConfig({
  plugins: [
    // Every .tsx in src/ compiles its JSX against src/i18n instead of react/jsx-runtime, which is
    // what lets the console be translated without a `t()` call at 2,500 sites. See
    // src/i18n/jsx-runtime.ts for the whole argument; the short version is that the app's text
    // stays written as plain JSX and is translated on the way to the DOM.
    //
    // Scoped through jsxImportSource rather than an alias on react/jsx-runtime on purpose:
    // node_modules ship pre-compiled JS that imports React's runtime by name, and rewriting that
    // for the whole dependency graph would route recharts' and FullCalendar's internals through
    // this for nothing.
    react({ jsxImportSource: "i18n-jsx" }),
    keepI18nRuntimeUnbundled(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "i18n-jsx": fileURLToPath(new URL("./src/i18n", import.meta.url)) },
  },
  optimizeDeps: {
    // `i18n-jsx/jsx-runtime` is a bare specifier, so the dev-only dependency optimizer treats it as
    // a package and pre-bundles it into node_modules/.vite/deps — even though the alias points at
    // src/i18n. That did two damaging things, both invisible in `npm run build` (Rollup has no
    // optimizer) and both of them lies told only to whoever is developing:
    //
    //   1. IT FROZE THE DICTIONARIES. The optimizer re-bundles when package.json or this config
    //      changes, not when a file inside the "package" does. So every edit under src/i18n was
    //      served from a snapshot taken whenever the cache was last built. A missing translation
    //      added to the dictionary went on rendering as English, and the miss log went on naming
    //      strings that had been translated an hour earlier.
    //   2. IT MADE TWO LANGUAGE SINGLETONS. src/i18n/lang.ts got bundled into the deps copy AND
    //      served as source to everything that imports it by relative path — LanguageProvider
    //      among them. The switcher then wrote one copy while the JSX runtime read the other, so
    //      picking a language did nothing until the page was reloaded, which is exactly the
    //      interaction a person tries first.
    //
    // Excluding it keeps one instance, compiled from source, always current.
    exclude: ["i18n-jsx/jsx-runtime", "i18n-jsx/jsx-dev-runtime"],
  },
  build: {
    rollupOptions: {
      output: { manualChunks: chunkFor },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:9000",
        changeOrigin: true,
        // The Config Deploy terminal is a WebSocket on /api/terminal/... Without this the dev
        // server answers the upgrade itself with a 404 and the terminal only works in Docker.
        ws: true,
        // X-Forwarded-* — specifically X-Forwarded-Host. `changeOrigin: true` rewrites the Host
        // header to the TARGET (localhost:9000) while the Origin header still says where the
        // browser is, so the backend's WebSocket origin check (services.BrowserRequestHost) has
        // nothing to match against. At http://localhost:5173 that is survivable, because that
        // exact string is in the built-in allow-list — but `server.host` is 0.0.0.0, so a
        // developer opening the dev server by LAN IP got a terminal that refused to connect.
        xfwd: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/uploads": {
        target: "http://localhost:9000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
