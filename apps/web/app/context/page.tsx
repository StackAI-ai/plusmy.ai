import { Badge, Card } from '@plusmy/ui';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  listContextAssets,
  listPromptTemplates,
  listSkillDefinitions,
  listUserWorkspaces
} from '@plusmy/core';
import { ContextIngestForm } from './context-ingest-form';
import { ContextSearchForm } from './search-form';
import { getSearchParam, type AppSearchParams } from '../_lib/search-params';

export default async function ContextPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Context engine</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Sign in to load prompts, skill definitions, and semantic context assets into your workspace.
        </p>
      </Card>
    );
  }

  const workspaces = await listUserWorkspaces(user.id);
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace');
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId);

  const [assets, prompts, skills] = workspace
    ? await Promise.all([
        listContextAssets(workspace.id, user.id),
        listPromptTemplates(workspace.id, user.id),
        listSkillDefinitions(workspace.id, user.id)
      ])
    : [[], [], []];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Vectorized context and skill engine</h1>
                <p className="mt-3 text-sm leading-7 text-slate-700">
                  Context assets are chunked and optionally embedded on ingest, then exposed as MCP resources and similarity matches through the API layer.
                </p>
              </div>
              <Badge>{workspace?.name ?? 'No workspace'}</Badge>
            </div>
          </Card>

          <section className="grid gap-4 md:grid-cols-3">
            <Card>
              <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Assets</p>
              <p className="mt-3 text-4xl font-semibold text-ink">{assets.length}</p>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                {assets.slice(0, 4).map((asset) => (
                  <p key={asset.id}>{asset.title}</p>
                ))}
              </div>
            </Card>
            <Card>
              <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Prompt templates</p>
              <p className="mt-3 text-4xl font-semibold text-ink">{prompts.length}</p>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                {prompts.slice(0, 4).map((prompt) => (
                  <p key={prompt.id}>{prompt.name}</p>
                ))}
              </div>
            </Card>
            <Card>
              <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Skill definitions</p>
              <p className="mt-3 text-4xl font-semibold text-ink">{skills.length}</p>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                {skills.slice(0, 4).map((skill) => (
                  <p key={skill.id}>{skill.name}</p>
                ))}
              </div>
            </Card>
          </section>
        </div>
        {workspace ? <ContextIngestForm workspaceId={workspace.id} /> : <Card>Create a workspace first.</Card>}
      </div>
      {workspace ? <ContextSearchForm workspaceId={workspace.id} /> : null}
    </div>
  );
}
