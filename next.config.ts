import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Disable TypeScript checking during build
    ignoreBuildErrors: true,
  },
  eslint: {
    // Also disable ESLint during build (optional)
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
