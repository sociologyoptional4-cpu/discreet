import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Lets a phone on the same Wi-Fi load the dev server (e.g. https://192.168.x.x:3000/record).
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
