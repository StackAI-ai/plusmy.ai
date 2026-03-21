import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
