import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Use webpack instead of Turbopack — parent src/ uses .js extensions in imports
  // which Turbopack cannot resolve to .ts files (no extensionAlias support)
  webpack: (config) => {
    config.resolve.alias['@polypharmguard'] = path.resolve(__dirname, '../src');
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
