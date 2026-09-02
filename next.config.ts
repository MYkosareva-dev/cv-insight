import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // The build must fail on type errors — Block H, DoD #1.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
