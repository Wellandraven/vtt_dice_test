import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin tracing to this folder; a stray lockfile higher up would otherwise be taken as the root.
  outputFileTracingRoot: process.cwd(),
  // The copied engine/renderer files import siblings as `./foo.js` (ESM style) while the files on
  // disk are `.ts`. Turbopack cannot remap that, so builds use webpack with an extension alias.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
