import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable image optimization to save memory on small servers
  images: {
    unoptimized: true,
  },

  // Reduce memory usage during build
  experimental: {
    // Reduce build worker memory usage
    workerThreads: false,
    cpus: 2,
  },
};

export default nextConfig;
