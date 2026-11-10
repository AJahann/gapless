import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Workspace packages ship TypeScript source; Next must compile them.
  transpilePackages: ['@gapless/protocol', '@gapless/engine'],
};

export default nextConfig;
