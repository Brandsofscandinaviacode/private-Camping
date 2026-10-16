import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for minimal deployment footprint on Raspberry Pi
  output: "standalone",

  // Admin, login and the Claude/MCP consent page must never be framed
  // (clickjacking an "Godkend" click). Guest pages are left embeddable.
  async headers() {
    const noFrame = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    return [
      { source: "/admin/:path*", headers: noFrame },
      { source: "/admin", headers: noFrame },
      { source: "/login", headers: noFrame },
      { source: "/oauth/:path*", headers: noFrame },
    ];
  },

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
