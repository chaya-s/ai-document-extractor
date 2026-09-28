import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@llamaindex/liteparse',
  ],
};

export default nextConfig;