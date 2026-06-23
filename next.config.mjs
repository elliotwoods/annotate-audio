/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // The audio peaks/BPM web workers use the standard
    // `new Worker(new URL('./x.worker.ts', import.meta.url))` pattern, which Next's webpack
    // build supports natively. essentia.js' emscripten glue, however, has a Node-only branch
    // that statically references `fs`/`path`/`crypto`; in the browser/worker bundle those
    // builtins don't exist, so stub them out (the branch never runs in the browser).
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
