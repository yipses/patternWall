/**
 * GitHub Pages project sites serve from a subpath (/<repo>/), while local dev,
 * `npm run start` and the Playwright suite all serve from the root. Next needs
 * to know which at build time, because it bakes asset URLs into the HTML.
 *
 * Set PATTERNWALL_BASE_PATH=/patternWall for a Pages build; leave it unset
 * everywhere else. A custom domain or a user/org root site needs no value.
 */
const basePath = process.env.PATTERNWALL_BASE_PATH?.replace(/\/$/, '') ?? '';

/**
 * Build stamp, baked in at build time so a published page can say which version
 * of itself you are looking at. A green deploy is not proof the site changed —
 * that gap cost real debugging time once — so the page carries the answer.
 * GITHUB_SHA is set by Actions; locally there is no commit to name.
 *
 * The stamp is stashed on `process.env` rather than being a fresh `new Date()`
 * each time this module is evaluated, because **Next loads this config more
 * than once per build** and the loads are seconds apart. The prerendered HTML
 * was getting an earlier timestamp than the client bundle — 3.6s to 11.3s
 * earlier, measured over six builds — and `SiteFooter` renders it to the
 * minute. So whenever the two loads straddled a minute boundary, the server
 * said one thing and the client's first render said another: a text hydration
 * mismatch, React error #418, on roughly 6% of warm builds and 19% of cold
 * ones. It took two sightings and a full investigation to place, because
 * nothing about the page is nondeterministic — the build was.
 *
 * Assigning through the environment makes every later load reuse the first
 * value, and the child processes Next forks inherit it. Verified by building
 * repeatedly and diffing the stamp in `out/index.html` against the one in
 * `out/_next/**.js`: identical every time, where before they never matched.
 */
process.env.NEXT_PUBLIC_BUILD_TIME ??= new Date().toISOString();

const buildStamp = {
  NEXT_PUBLIC_BUILD_TIME: process.env.NEXT_PUBLIC_BUILD_TIME,
  NEXT_PUBLIC_BUILD_COMMIT: (process.env.GITHUB_SHA ?? '').slice(0, 7),
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  env: buildStamp,
  reactStrictMode: true,
  images: { unoptimized: true },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // Pages serves 404.html for unknown paths; without this, deep links that Next
  // exported as `/p/flow-dots.html` would only resolve with the extension.
  trailingSlash: true,
  // Lint runs as its own root script so it can cover the whole workspace with
  // --max-warnings=0; running it again here would only duplicate the work.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
