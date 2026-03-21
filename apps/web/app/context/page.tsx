import type { ContextBindingType } from '@plusmy/contracts'
import { Badge, Card } from '@plusmy/ui'
import { createServerSupabaseClient } from '@plusmy/supabase'
import {
  getAuthorizedWorkspace,
  listContextAssets,
  listContextBindings,
  listPromptTemplates,
  listSkillDefinitions,
  listUserWorkspaces
} from '@plusmy/core'
import { ContextBindingForm } from './binding-form'
import { ContextIngestForm } from './context-ingest-form'
import { DeleteContextBindingButton } from './delete-binding-button'
import { ContextSearchForm } from './search-form'
import { getSearchParam, type AppSearchParams } from '../_lib/search-params'

function scopeLabel(ownerUserId: string | null | undefined) {
  return ownerUserId ? 'personal' : 'workspace'
}

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin'
}

function bindingTypeLabel(bindingType: ContextBindingType) {
  if (bindingType === 'workspace') return 'Workspace default'
  if (bindingType === 'provider') return 'Provider'
  return 'Tool'
}

function bindingTargetLabel(bindingType: ContextBindingType, targetKey: string) {
  if (bindingType === 'workspace' && targetKey === 'default') {
    return 'Default workspace context'
  }

  if (bindingType === 'provider') {
    return targetKey.charAt(0).toUpperCase() + targetKey.slice(1)
  }

  return targetKey
}

export default async function ContextPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Context engine</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Sign in to load prompts, skill definitions, and semantic context assets into your workspace.
        </p>
      </Card>
    )
  }

  const workspaces = await listUserWorkspaces(user.id)
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace')
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId)
  const activeMembership = workspace ? workspaces.find((entry) => entry.id === workspace.id) : null
  const canManageBindings = canManageWorkspace(activeMembership?.role)

  const [assets, prompts, skills, bindings] = workspace
    ? await Promise.all([
        listContextAssets(workspace.id, user.id),
        listPromptTemplates(workspace.id, user.id),
        listSkillDefinitions(workspace.id, user.id),
        listContextBindings(workspace.id, user.id)
      ])
    : [[], [], [], []]

  const sharedPrompts = prompts
    .filter((prompt) => !prompt.owner_user_id)
    .map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      description: prompt.description ?? null
    }))
  const sharedSkills = skills
    .filter((skill) => !skill.owner_user_id)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description ?? null
    }))

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

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
            <Card>
              <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Binding rules</p>
              <p className="mt-3 text-4xl font-semibold text-ink">{bindings.length}</p>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                {bindings.slice(0, 4).map((binding) => (
                  <p key={binding.id}>{bindingTargetLabel(binding.binding_type, binding.target_key)}</p>
                ))}
              </div>
            </Card>
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Context assets</h2>
                <Badge tone="moss">{assets.length}</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {assets.length === 0 ? (
                  <p className="text-sm text-slate-700">No context assets yet.</p>
                ) : (
                  assets.map((asset) => (
                    <div key={asset.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-ink">{asset.title}</p>
                        <Badge tone={asset.owner_user_id ? 'brass' : 'moss'}>{scopeLabel(asset.owner_user_id)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{asset.type}</p>
                      {asset.source_uri ? <p className="mt-2 break-all text-xs text-slate-500">{asset.source_uri}</p> : null}
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{asset.updated_at}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Prompt templates</h2>
                <Badge tone="moss">{prompts.length}</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {prompts.length === 0 ? (
                  <p className="text-sm text-slate-700">No prompt templates yet.</p>
                ) : (
                  prompts.map((prompt) => (
                    <div key={prompt.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-ink">{prompt.name}</p>
                        <Badge tone={prompt.owner_user_id ? 'brass' : 'moss'}>{scopeLabel(prompt.owner_user_id)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{prompt.description ?? 'No description yet.'}</p>
                      <p className="mt-2 text-xs text-slate-500">{`plusmy://prompt/${prompt.id}`}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{prompt.updated_at}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Skill definitions</h2>
                <Badge tone="moss">{skills.length}</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {skills.length === 0 ? (
                  <p className="text-sm text-slate-700">No skill definitions yet.</p>
                ) : (
                  skills.map((skill) => (
                    <div key={skill.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-ink">{skill.name}</p>
                        <Badge tone={skill.owner_user_id ? 'brass' : 'moss'}>{scopeLabel(skill.owner_user_id)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{skill.description ?? 'No description yet.'}</p>
                      <p className="mt-2 text-xs text-slate-500">{`plusmy://skill/${skill.id}`}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{skill.updated_at}</p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
        {workspace ? <ContextIngestForm workspaceId={workspace.id} /> : <Card>Create a workspace first.</Card>}
      </div>
      {workspace ? <ContextSearchForm workspaceId={workspace.id} /> : null}

      {workspace ? (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Context bindings</h2>
                <p className="mt-3 text-sm leading-7 text-slate-700">
                  Bind workspace-shared prompts and skills to the default workspace context, a provider surface, or an individual tool target.
                </p>
              </div>
              <Badge tone={bindings.length ? 'moss' : 'brass'}>{bindings.length}</Badge>
            </div>

            {!canManageBindings ? (
              <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate-500">
                Workspace owners and admins manage binding rules.
              </p>
            ) : null}

            <div className="mt-6 space-y-3">
              {bindings.length === 0 ? (
                <p className="text-sm text-slate-700">No context bindings configured yet.</p>
              ) : (
                bindings.map((binding) => (
                  <div key={binding.id} className="rounded-2xl border border-black/5 bg-white/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">{bindingTargetLabel(binding.binding_type, binding.target_key)}</p>
                          <Badge tone="brass">{bindingTypeLabel(binding.binding_type)}</Badge>
                          <Badge>priority {binding.priority}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-700">{binding.target_key}</p>
                      </div>
                      {canManageBindings ? (
                        <DeleteContextBindingButton workspaceId={workspace.id} bindingId={binding.id} />
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl bg-black/5 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Prompt template</p>
                        <p className="mt-2 text-sm text-slate-700">
                          {binding.prompt_template?.name ?? 'No prompt attached'}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-black/5 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Skill definition</p>
                        <p className="mt-2 text-sm text-slate-700">
                          {binding.skill_definition?.name ?? 'No skill attached'}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">{binding.updated_at}</p>
                  </div>
                ))
              )}
            </div>
          </Card>

          {canManageBindings ? (
            <ContextBindingForm workspaceId={workspace.id} prompts={sharedPrompts} skills={sharedSkills} />
          ) : (
            <Card>
              <h2 className="text-xl font-semibold">Binding controls</h2>
              <p className="mt-3 text-sm leading-7 text-slate-700">
                Ask a workspace owner or admin to attach shared prompts and skills to tool targets. Members can still review the resulting rules here.
              </p>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  )
}
