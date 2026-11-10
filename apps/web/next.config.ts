import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Workspace packages ship TypeScript source; Next must compile them.
  transpilePackages: ['@gapless/protocol', '@gapless/engine'],
};

export default nextConfig;
