import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` otherwise APPENDS a managed block to CLAUDE.md on every start
  // (node_modules/next/dist/server/lib/generate-agent-files.js). CLAUDE.md is
  // this project's rule book and sits above SPEC.md in the hierarchy — a build
  // tool must not be able to write into it, and a future Next release changing
  // that text would silently change the agent's instructions. Off, so the file
  // has exactly one author.
  agentRules: false,
  typescript: {
    // The build must fail on type errors — Block H, DoD #1.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
