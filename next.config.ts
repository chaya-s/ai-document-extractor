import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  serverExternalPackages: [
    '@llamaindex/liteparse',
  ],
};

export default nextConfig;