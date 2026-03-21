import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@plusmy/config';
import type { Database } from './database.types';

export function createServiceRoleClient() {
  const env = getServerEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
