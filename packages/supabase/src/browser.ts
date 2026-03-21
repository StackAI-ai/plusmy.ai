import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '@plusmy/config';
import type { Database } from './database.types';

export function createBrowserSupabaseClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
