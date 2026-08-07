/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    dirs: ["src"],
  },
  // The ADASOS agent library (../src, compiled to ../dist) is frozen backend
  // code imported directly by our server-side adapter layer -- keep it out
  // of client bundles and let webpack resolve it from outside this app's
  // own root.
  outputFileTracingRoot: process.cwd(),
  experimental: {
    // Default is os.cpus().length - 1 (3 worker child processes on this
    // 4-core machine). On a memory-constrained host, those extra Node
    // processes are what get killed under memory pressure, which crashes
    // the whole `next dev` process once jest-worker's retry limit is hit
    // ("Jest worker encountered N child process exceptions, exceeding retry
    // limit"). Capping to a single worker trades some compile parallelism
    // for not exhausting system memory.
    cpus: 1,
  },
};

export default nextConfig;
