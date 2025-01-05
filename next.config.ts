import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Required to make Next.js static export work with Capacitor
  trailingSlash: false,
  // Ensure paths work on mobile
  assetPrefix: '/',
};

export default nextConfig;
