import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: [
    '@plusmy/ui',
    '@plusmy/config',
    '@plusmy/contracts',
    '@plusmy/supabase',
    '@plusmy/core',
    '@plusmy/integrations',
    '@plusmy/mcp'
  ]
};

export default nextConfig;
