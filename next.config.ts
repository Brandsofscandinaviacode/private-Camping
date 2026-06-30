import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for minimal deployment footprint on Raspberry Pi
  output: "standalone",

  // Disable image optimization to save memory on RPi
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
