import type { ContextAssetType, McpResourceContent, McpResourceDefinition } from '@plusmy/contracts';
import { createServiceRoleClient } from '@plusmy/supabase';
import { chunkText, createEmbedding } from './embeddings';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function parseResourceUri(uri: string) {
  const match = uri.match(/^plusmy:\/\/(prompt|skill)\/([a-f0-9-]+)$/i);
  if (!match) return null;
  return { kind: match[1], id: match[2] };
}

export async function listContextAssets(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('context_assets')
    .select('id,title,type,source_uri,owner_user_id,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });

  return (data ?? []).filter((item) => !item.owner_user_id || item.owner_user_id === userId);
}

export async function createContextAsset(input: {
  workspaceId: string;
  ownerUserId: string | null;
  type: ContextAssetType;
  title: string;
  content: string;
  sourceUri?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServiceRoleClient();
  const { data: asset, error } = await supabase
    .schema('app')
    .from('context_assets')
    .insert({
      workspace_id: input.workspaceId,
      owner_user_id: input.ownerUserId,
      type: input.type,
      title: input.title,
      content: input.content,
      source_uri: input.sourceUri ?? null,
      metadata: input.metadata ?? {}
    })
    .select('*')
    .single();

  if (error || !asset) throw error ?? new Error('Failed to create context asset.');

  const chunks = chunkText(input.content);
  for (const [index, chunk] of chunks.entries()) {
    const embedding = await createEmbedding(chunk);
    await supabase.schema('app').from('context_asset_chunks').insert({
      workspace_id: input.workspaceId,
      asset_id: asset.id,
      chunk_index: index,
      content: chunk,
      token_count: Math.ceil(chunk.length / 4),
      embedding,
      metadata: {
        embedded: Boolean(embedding),
        model: embedding ? 'text-embedding-3-small' : null
      }
    });
  }

  return asset;
}

export async function listPromptTemplates(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('prompt_templates')
    .select('id,name,slug,description,owner_user_id,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });

  return (data ?? []).filter((item) => !item.owner_user_id || item.owner_user_id === userId);
}

export async function createPromptTemplate(input: {
  workspaceId: string;
  ownerUserId: string | null;
  name: string;
  description?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('app')
    .from('prompt_templates')
    .insert({
      workspace_id: input.workspaceId,
      owner_user_id: input.ownerUserId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
      content: input.content,
      metadata: input.metadata ?? {}
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create prompt template.');
  return data;
}

export async function listSkillDefinitions(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('skill_definitions')
    .select('id,name,slug,description,owner_user_id,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });

  return (data ?? []).filter((item) => !item.owner_user_id || item.owner_user_id === userId);
}

export async function createSkillDefinition(input: {
  workspaceId: string;
  ownerUserId: string | null;
  name: string;
  description?: string | null;
  instructions: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('app')
    .from('skill_definitions')
    .insert({
      workspace_id: input.workspaceId,
      owner_user_id: input.ownerUserId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
      instructions: input.instructions,
      metadata: input.metadata ?? {}
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create skill definition.');
  return data;
}

export async function listWorkspaceResources(workspaceId: string, userId: string | null | undefined) {
  const [prompts, skills] = await Promise.all([
    listPromptTemplates(workspaceId, userId),
    listSkillDefinitions(workspaceId, userId)
  ]);

  const promptResources = prompts.map(
    (item): McpResourceDefinition => ({
      uri: `plusmy://prompt/${item.id}`,
      name: item.name,
      description: item.description ?? 'Prompt template',
      mimeType: 'text/markdown'
    })
  );

  const skillResources = skills.map(
    (item): McpResourceDefinition => ({
      uri: `plusmy://skill/${item.id}`,
      name: item.name,
      description: item.description ?? 'Skill definition',
      mimeType: 'text/markdown'
    })
  );

  return [...promptResources, ...skillResources];
}

export async function readWorkspaceResource(workspaceId: string, userId: string | null | undefined, uri: string): Promise<McpResourceContent[]> {
  const parsed = parseResourceUri(uri);
  if (!parsed) return [];

  const supabase = createServiceRoleClient();
  if (parsed.kind === 'prompt') {
    const { data } = await supabase
      .schema('app')
      .from('prompt_templates')
      .select('id,content,owner_user_id')
      .eq('workspace_id', workspaceId)
      .eq('id', parsed.id)
      .maybeSingle();

    if (!data || (data.owner_user_id && data.owner_user_id !== userId)) return [];
    return [{ uri, mimeType: 'text/markdown', text: data.content }];
  }

  const { data } = await supabase
    .schema('app')
    .from('skill_definitions')
    .select('id,instructions,owner_user_id')
    .eq('workspace_id', workspaceId)
    .eq('id', parsed.id)
    .maybeSingle();

  if (!data || (data.owner_user_id && data.owner_user_id !== userId)) return [];
  return [{ uri, mimeType: 'text/markdown', text: data.instructions }];
}

export async function matchContextChunks(workspaceId: string, query: string, limit = 8) {
  const embedding = await createEmbedding(query);
  if (!embedding) return [];

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.schema('app').rpc('match_context_chunks', {
    p_workspace_id: workspaceId,
    p_query_embedding: embedding,
    p_limit: limit,
    p_filters: {}
  });

  if (error) throw error;
  return data ?? [];
}
