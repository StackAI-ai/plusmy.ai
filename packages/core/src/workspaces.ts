import { createServiceRoleClient } from '@plusmy/supabase';
import { logAuditEvent } from './connections';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export async function listUserWorkspaces(userId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .schema('app')
    .from('workspace_members')
    .select('role, workspace:workspaces(id,name,slug,plan,created_at)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  return (data ?? []).map((entry) => ({
    role: entry.role,
    ...(Array.isArray(entry.workspace) ? entry.workspace[0] : entry.workspace)
  }));
}

export async function createWorkspaceBootstrap(input: { userId: string; name: string; slug?: string | null }) {
  const supabase = createServiceRoleClient();
  const slug = slugify(input.slug ?? input.name);

  const { data: workspace, error } = await supabase
    .schema('app')
    .from('workspaces')
    .insert({
      name: input.name,
      slug,
      created_by: input.userId
    })
    .select('*')
    .single();

  if (error || !workspace) throw error ?? new Error('Failed to create workspace.');

  await supabase.schema('app').from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: input.userId,
    role: 'owner'
  });

  await supabase.schema('app').from('prompt_templates').insert({
    workspace_id: workspace.id,
    owner_user_id: input.userId,
    name: 'General assistant',
    slug: 'general-assistant',
    description: 'Default workspace prompt scaffold',
    content: 'Operate on behalf of the workspace. Prefer factual answers, cite tools you used, and keep private data scoped to the current request.'
  });

  await supabase.schema('app').from('skill_definitions').insert({
    workspace_id: workspace.id,
    owner_user_id: input.userId,
    name: 'Operator skill',
    slug: 'operator-skill',
    description: 'Default execution rules for workspace operators',
    instructions: 'Before taking action, confirm the workspace and provider scope. Prefer read-only operations unless the prompt explicitly requests writes.'
  });

  await logAuditEvent({
    workspaceId: workspace.id,
    actorType: 'user',
    actorUserId: input.userId,
    action: 'workspace.created',
    resourceType: 'workspace',
    resourceId: workspace.id
  });

  return workspace;
}

export async function getWorkspaceOverview(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient()
  const [connections, prompts, skills, assets, bindings] = await Promise.all([
    supabase.schema('app').from('connections').select('id,scope,owner_user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    supabase.schema('app').from('prompt_templates').select('id,owner_user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    supabase.schema('app').from('skill_definitions').select('id,owner_user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    supabase.schema('app').from('context_assets').select('id,owner_user_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    supabase.schema('app').from('context_bindings').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
  ])

  return {
    connections: connections.count ?? 0,
    prompts: prompts.count ?? 0,
    skills: skills.count ?? 0,
    assets: assets.count ?? 0,
    bindings: bindings.count ?? 0,
    userId: userId ?? null
  }
}
