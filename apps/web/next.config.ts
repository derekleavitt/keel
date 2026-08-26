import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Internal packages ship TypeScript source directly — no build step between
  // editing a package and seeing the effect in the app.
  transpilePackages: ['@keel/ui', '@keel/auth', '@keel/db', '@keel/contracts'],
  typedRoutes: true,
};

export default config;
