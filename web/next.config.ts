import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  // better-sqlite3 loads its native .node binding via the `bindings` package,
  // which walks up `module.parent` to find the package root. When webpack
  // bundles bindings.js, `module.parent` is null and the load throws
  // "Cannot read properties of undefined (reading 'indexOf')" at runtime.
  // We force both modules to stay as runtime require() calls.
  serverExternalPackages: ['better-sqlite3', 'bindings'],
  // Use webpack instead of Turbopack — parent src/ uses .js extensions in imports
  // which Turbopack cannot resolve to .ts files (no extensionAlias support)
  webpack: (config, { isServer }) => {
    config.resolve.alias['@polypharmguard'] = path.resolve(__dirname, '../src');
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    if (isServer) {
      // Force native-binding loaders to be resolved at runtime via Node's
      // require, not bundled. serverExternalPackages handles this for the
      // top-level listing but doesn't reach transitive imports the way the
      // explicit externals function does.
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals];
      config.externals = [
        ...externals,
        ({ request }: { request?: string }, callback: (err?: unknown, result?: string) => void) => {
          if (request === 'better-sqlite3' || request === 'bindings') {
            return callback(undefined, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
