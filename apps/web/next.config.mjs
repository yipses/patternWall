/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  // Lint runs as its own root script so it can cover the whole workspace with
  // --max-warnings=0; running it again here would only duplicate the work.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
