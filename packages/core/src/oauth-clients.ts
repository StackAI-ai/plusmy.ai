import { createServiceRoleClient } from '@plusmy/supabase';
import { registerDynamicClient } from './oauth';
import type { OAuthClientRegistrationInput } from '@plusmy/contracts';

export async function listOAuthClients(createdBy: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('oauth_clients')
    .select('client_id,client_name,redirect_uris,grant_types,response_types,token_endpoint_auth_method,created_at')
    .eq('created_by', createdBy)
    .order('created_at', { ascending: false });

  return data ?? [];
}

export async function createOAuthClient(createdBy: string, input: OAuthClientRegistrationInput) {
  return await registerDynamicClient(input, createdBy);
}
