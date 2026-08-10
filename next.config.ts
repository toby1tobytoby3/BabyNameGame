import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // $HOME is itself a git repo with a lockfile; pin the root so Turbopack
  // doesn't walk up and pick the wrong one.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
