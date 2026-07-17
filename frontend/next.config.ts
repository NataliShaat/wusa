import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Explicit Turbopack root to avoid workspace-root inference warnings
  turbopack: { root: "./" },
};

export default nextConfig;
