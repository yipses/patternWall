/**
 * GitHub Pages project sites serve from a subpath (/<repo>/), while local dev,
 * `npm run start` and the Playwright suite all serve from the root. Next needs
 * to know which at build time, because it bakes asset URLs into the HTML.
 *
 * Set PATTERNWALL_BASE_PATH=/patternWall for a Pages build; leave it unset
 * everywhere else. A custom domain or a user/org root site needs no value.
 */
const basePath = process.env.PATTERNWALL_BASE_PATH?.replace(/\/$/, '') ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
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
