import type {
  BoundContextResource,
  BoundContextResourceKind,
  ContextAssetType,
  ContextBindingRecord,
  ContextBindingType,
  ContextChunkMatch,
  ContextInjectionResult,
  Json,
  McpResourceContent,
  McpResourceDefinition,
  ProviderRuntimeContext
} from '@plusmy/contracts'
import { createServiceRoleClient } from '@plusmy/supabase'
import { logAuditEvent } from './connections'
import { chunkText, createEmbedding } from './embeddings'

const allowedContextBindingTypes = new Set<ContextBindingType>(['workspace', 'provider', 'tool'])
const contextBindingSelect = `
  id,
  workspace_id,
  binding_type,
  target_key,
  prompt_template_id,
  skill_definition_id,
  priority,
  metadata,
  created_at,
  updated_at,
  prompt_template:prompt_templates(id,name,slug,description,owner_user_id),
  skill_definition:skill_definitions(id,name,slug,description,owner_user_id)
`

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

interface PromptTemplateResourceRecord {
  id: string
  name: string
  slug: string
  description: string | null
  content: string
  owner_user_id: string | null
}

interface SkillDefinitionResourceRecord {
  id: string
  name: string
  slug: string
  description: string | null
  instructions: string
  owner_user_id: string | null
}

interface WorkspaceResourceRecord {
  uri: string
  mimeType: string
  text: string
  name: string
  description: string | null
}

interface ContextChunkMatchRow {
  chunk_id: string
  asset_id: string
  title: string
  content: string
  similarity: number
  metadata: Json
}

function parseResourceUri(uri: string) {
  const directMatch = uri.match(/^plusmy:\/\/(prompt|skill)\/([a-f0-9-]+)$/i)
  if (directMatch) {
    return {
      format: 'direct' as const,
      kind: directMatch[1].toLowerCase() as BoundContextResourceKind,
      id: directMatch[2]
    }
  }

  const bindingMatch = uri.match(/^plusmy:\/\/binding\/(workspace|provider|tool)\/([^/]+)\/(prompt|skill)\/([a-f0-9-]+)$/i)
  if (!bindingMatch) return null

  return {
    format: 'binding' as const,
    bindingType: normalizeBindingType(bindingMatch[1].toLowerCase()),
    targetKey: decodeURIComponent(bindingMatch[2]),
    kind: bindingMatch[3].toLowerCase() as BoundContextResourceKind,
    id: bindingMatch[4]
  }
}

function normalizeJoinedRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function normalizeContextBindingRow(row: {
  id: string
  workspace_id: string
  binding_type: string
  target_key: string
  prompt_template_id: string | null
  skill_definition_id: string | null
  priority: number
  metadata: Json
  created_at: string
  updated_at: string
  prompt_template?: {
    id: string
    name: string
    slug: string
    description: string | null
    owner_user_id: string | null
  } | Array<{
    id: string
    name: string
    slug: string
    description: string | null
    owner_user_id: string | null
  }> | null
  skill_definition?: {
    id: string
    name: string
    slug: string
    description: string | null
    owner_user_id: string | null
  } | Array<{
    id: string
    name: string
    slug: string
    description: string | null
    owner_user_id: string | null
  }> | null
}): ContextBindingRecord {
  const prompt = normalizeJoinedRecord(row.prompt_template)
  const skill = normalizeJoinedRecord(row.skill_definition)

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    binding_type: normalizeBindingType(row.binding_type),
    target_key: row.target_key,
    prompt_template_id: row.prompt_template_id,
    skill_definition_id: row.skill_definition_id,
    priority: row.priority,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    prompt_template: prompt
      ? {
          id: prompt.id,
          name: prompt.name,
          slug: prompt.slug,
          description: prompt.description ?? null
        }
      : null,
    skill_definition: skill
      ? {
          id: skill.id,
          name: skill.name,
          slug: skill.slug,
          description: skill.description ?? null
        }
      : null
  }
}

function normalizeBindingType(value: string): ContextBindingType {
  if (!allowedContextBindingTypes.has(value as ContextBindingType)) {
    throw new Error('Unsupported context binding type.')
  }

  return value as ContextBindingType
}

function normalizeBindingTarget(bindingType: ContextBindingType, targetKey: string | null | undefined) {
  const normalized = String(targetKey ?? '')
    .trim()
    .toLowerCase()

  if (bindingType === 'workspace') {
    return normalized || 'default'
  }

  if (!normalized || !/^[a-z0-9._:-]+$/.test(normalized)) {
    throw new Error('Binding target keys must use lowercase letters, numbers, dots, underscores, dashes, or colons.')
  }

  return normalized
}

function buildBindingResourceUri(resource: {
  bindingType: ContextBindingType
  targetKey: string
  kind: BoundContextResourceKind
  resourceId: string
}) {
  return `plusmy://binding/${resource.bindingType}/${encodeURIComponent(resource.targetKey)}/${resource.kind}/${resource.resourceId}`
}

function bindingSpecificity(bindingType: ContextBindingType) {
  if (bindingType === 'tool') return 3
  if (bindingType === 'provider') return 2
  return 1
}

function bindingScopeLabel(bindingType: ContextBindingType, targetKey: string) {
  if (bindingType === 'workspace') return 'Workspace default'
  if (bindingType === 'provider') return `Provider ${targetKey}`
  return `Tool ${targetKey}`
}

function buildBindingResourceName(resource: BoundContextResource) {
  const scope = bindingScopeLabel(resource.bindingType, resource.targetKey)
  const kind = resource.kind === 'prompt' ? 'Prompt' : 'Skill'
  return `${scope} · ${kind} · ${resource.name}`
}

function buildBindingResourceDescription(resource: BoundContextResource) {
  const kind = resource.kind === 'prompt' ? 'Prompt template' : 'Skill definition'
  const scope = bindingScopeLabel(resource.bindingType, resource.targetKey)
  return resource.description ?? `${kind} bound to ${scope.toLowerCase()}.`
}

function normalizeContextQueryPart(value: string | null | undefined, maxChars = 1600) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return null
  return normalized.slice(0, maxChars)
}

function buildContextQuery(parts: Array<string | null | undefined>, maxChars = 4000) {
  const seen = new Set<string>()
  const normalizedParts = parts
    .map((part) => normalizeContextQueryPart(part))
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      if (seen.has(part)) return false
      seen.add(part)
      return true
    })

  let query = ''
  for (const part of normalizedParts) {
    const next = query ? `${query}\n${part}` : part
    if (next.length > maxChars) {
      query = next.slice(0, maxChars).trim()
      break
    }
    query = next
  }

  return query.trim()
}

function matchesBindingTarget(
  binding: ContextBindingRecord,
  target: {
    provider?: string | null
    toolName?: string | null
    includeAllBindings?: boolean
    bindingType?: ContextBindingType | null
    targetKey?: string | null
  }
) {
  if (target.bindingType && binding.binding_type !== target.bindingType) {
    return false
  }

  if (target.targetKey) {
    return binding.target_key === normalizeBindingTarget(target.bindingType ?? binding.binding_type, target.targetKey)
  }

  if (target.includeAllBindings) {
    return true
  }

  if (binding.binding_type === 'workspace') {
    return binding.target_key === 'default'
  }

  if (binding.binding_type === 'provider') {
    return binding.target_key === String(target.provider ?? '').trim().toLowerCase()
  }

  return binding.target_key === String(target.toolName ?? '').trim().toLowerCase()
}

function compareBoundContextResources(left: BoundContextResource, right: BoundContextResource) {
  const specificity = bindingSpecificity(right.bindingType) - bindingSpecificity(left.bindingType)
  if (specificity !== 0) return specificity

  if (left.priority !== right.priority) return left.priority - right.priority
  return left.name.localeCompare(right.name)
}

async function getPromptTemplateContentMap(workspaceId: string, promptTemplateIds: string[]) {
  const ids = Array.from(new Set(promptTemplateIds))
  if (ids.length === 0) return new Map<string, PromptTemplateResourceRecord>()

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('prompt_templates')
    .select('id,name,slug,description,content,owner_user_id')
    .eq('workspace_id', workspaceId)
    .in('id', ids)

  return new Map(
    ((data ?? []) as PromptTemplateResourceRecord[])
      .filter((item) => !item.owner_user_id)
      .map((item) => [item.id, item])
  )
}

async function getSkillDefinitionContentMap(workspaceId: string, skillDefinitionIds: string[]) {
  const ids = Array.from(new Set(skillDefinitionIds))
  if (ids.length === 0) return new Map<string, SkillDefinitionResourceRecord>()

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('skill_definitions')
    .select('id,name,slug,description,instructions,owner_user_id')
    .eq('workspace_id', workspaceId)
    .in('id', ids)

  return new Map(
    ((data ?? []) as SkillDefinitionResourceRecord[])
      .filter((item) => !item.owner_user_id)
      .map((item) => [item.id, item])
  )
}

async function resolveBoundContextResources(
  workspaceId: string,
  userId: string | null | undefined,
  target: {
    provider?: string | null
    toolName?: string | null
    includeAllBindings?: boolean
    bindingType?: ContextBindingType | null
    targetKey?: string | null
    dedupeByResource?: boolean
  } = {}
) {
  const bindings = (await listContextBindings(workspaceId, userId)).filter((binding) => matchesBindingTarget(binding, target))
  if (bindings.length === 0) return [] as BoundContextResource[]

  const [promptMap, skillMap] = await Promise.all([
    getPromptTemplateContentMap(
      workspaceId,
      bindings.map((binding) => binding.prompt_template_id).filter((value): value is string => Boolean(value))
    ),
    getSkillDefinitionContentMap(
      workspaceId,
      bindings.map((binding) => binding.skill_definition_id).filter((value): value is string => Boolean(value))
    )
  ])

  const resources: BoundContextResource[] = []

  for (const binding of bindings) {
    if (binding.prompt_template_id) {
      const prompt = promptMap.get(binding.prompt_template_id)
      if (prompt) {
        resources.push({
          bindingType: binding.binding_type,
          targetKey: binding.target_key,
          priority: binding.priority,
          kind: 'prompt',
          resourceId: prompt.id,
          name: prompt.name,
          description: prompt.description ?? null,
          uri: buildBindingResourceUri({
            bindingType: binding.binding_type,
            targetKey: binding.target_key,
            kind: 'prompt',
            resourceId: prompt.id
          }),
          mimeType: 'text/markdown',
          text: prompt.content
        })
      }
    }

    if (binding.skill_definition_id) {
      const skill = skillMap.get(binding.skill_definition_id)
      if (skill) {
        resources.push({
          bindingType: binding.binding_type,
          targetKey: binding.target_key,
          priority: binding.priority,
          kind: 'skill',
          resourceId: skill.id,
          name: skill.name,
          description: skill.description ?? null,
          uri: buildBindingResourceUri({
            bindingType: binding.binding_type,
            targetKey: binding.target_key,
            kind: 'skill',
            resourceId: skill.id
          }),
          mimeType: 'text/markdown',
          text: skill.instructions
        })
      }
    }
  }

  const sorted = resources.sort(compareBoundContextResources)
  if (!target.dedupeByResource) {
    return sorted
  }

  const deduped = new Map<string, BoundContextResource>()
  for (const resource of sorted) {
    const key = `${resource.kind}:${resource.resourceId}`
    if (!deduped.has(key)) {
      deduped.set(key, resource)
    }
  }

  return Array.from(deduped.values())
}

async function getWorkspaceSharedPromptTemplate(workspaceId: string, promptTemplateId: string) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('prompt_templates')
    .select('id,workspace_id,owner_user_id')
    .eq('id', promptTemplateId)
    .maybeSingle()

  if (!data || data.workspace_id !== workspaceId || data.owner_user_id) {
    throw new Error('Prompt bindings require a workspace-shared prompt template.')
  }

  return data
}

async function getWorkspaceSharedSkillDefinition(workspaceId: string, skillDefinitionId: string) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('skill_definitions')
    .select('id,workspace_id,owner_user_id')
    .eq('id', skillDefinitionId)
    .maybeSingle()

  if (!data || data.workspace_id !== workspaceId || data.owner_user_id) {
    throw new Error('Skill bindings require a workspace-shared skill definition.')
  }

  return data
}

export async function listContextAssets(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('context_assets')
    .select('id,title,type,source_uri,owner_user_id,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })

  return (data ?? []).filter((item) => !item.owner_user_id || item.owner_user_id === userId)
}

export async function createContextAsset(input: {
  workspaceId: string
  ownerUserId: string | null
  type: ContextAssetType
  title: string
  content: string
  sourceUri?: string | null
  metadata?: Record<string, unknown>
}) {
  const supabase = createServiceRoleClient()
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
    .single()

  if (error || !asset) throw error ?? new Error('Failed to create context asset.')

  const chunks = chunkText(input.content)
  for (const [index, chunk] of chunks.entries()) {
    const embedding = await createEmbedding(chunk)
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
    })
  }

  return asset
}

export async function listPromptTemplates(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('prompt_templates')
    .select('id,name,slug,description,owner_user_id,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })

  return (data ?? []).filter((item) => !item.owner_user_id || item.owner_user_id === userId)
}

export async function createPromptTemplate(input: {
  workspaceId: string
  ownerUserId: string | null
  name: string
  description?: string | null
  content: string
  metadata?: Record<string, unknown>
}) {
  const supabase = createServiceRoleClient()
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
    .single()

  if (error || !data) throw error ?? new Error('Failed to create prompt template.')
  return data
}

export async function listSkillDefinitions(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('skill_definitions')
    .select('id,name,slug,description,owner_user_id,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })

  return (data ?? []).filter((item) => !item.owner_user_id || item.owner_user_id === userId)
}

export async function createSkillDefinition(input: {
  workspaceId: string
  ownerUserId: string | null
  name: string
  description?: string | null
  instructions: string
  metadata?: Record<string, unknown>
}) {
  const supabase = createServiceRoleClient()
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
    .single()

  if (error || !data) throw error ?? new Error('Failed to create skill definition.')
  return data
}

export async function listContextBindings(workspaceId: string, userId: string | null | undefined) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .schema('app')
    .from('context_bindings')
    .select(contextBindingSelect)
    .eq('workspace_id', workspaceId)
    .order('binding_type', { ascending: true })
    .order('target_key', { ascending: true })
    .order('priority', { ascending: true })

  return (data ?? [])
    .filter((row) => {
      const prompt = normalizeJoinedRecord(row.prompt_template)
      const skill = normalizeJoinedRecord(row.skill_definition)
      const promptVisible = !prompt?.owner_user_id || prompt.owner_user_id === userId
      const skillVisible = !skill?.owner_user_id || skill.owner_user_id === userId
      return promptVisible && skillVisible
    })
    .map((row) =>
      normalizeContextBindingRow(
        row as {
          id: string
          workspace_id: string
          binding_type: string
          target_key: string
          prompt_template_id: string | null
          skill_definition_id: string | null
          priority: number
          metadata: Json
          created_at: string
          updated_at: string
          prompt_template?: {
            id: string
            name: string
            slug: string
            description: string | null
            owner_user_id: string | null
          } | Array<{
            id: string
            name: string
            slug: string
            description: string | null
            owner_user_id: string | null
          }> | null
          skill_definition?: {
            id: string
            name: string
            slug: string
            description: string | null
            owner_user_id: string | null
          } | Array<{
            id: string
            name: string
            slug: string
            description: string | null
            owner_user_id: string | null
          }> | null
        }
      )
    )
}

export async function createContextBinding(input: {
  workspaceId: string
  actorUserId: string
  bindingType: ContextBindingType
  targetKey: string
  promptTemplateId?: string | null
  skillDefinitionId?: string | null
  priority?: number | null
  metadata?: Record<string, unknown>
}) {
  const supabase = createServiceRoleClient()
  const bindingType = normalizeBindingType(input.bindingType)
  const targetKey = normalizeBindingTarget(bindingType, input.targetKey)
  const promptTemplateId = input.promptTemplateId?.trim() || null
  const skillDefinitionId = input.skillDefinitionId?.trim() || null
  const priority =
    typeof input.priority === 'number' && Number.isFinite(input.priority) ? Math.max(0, Math.trunc(input.priority)) : 100

  if (!promptTemplateId && !skillDefinitionId) {
    throw new Error('Select at least one workspace-shared prompt or skill to bind.')
  }

  if (promptTemplateId) {
    await getWorkspaceSharedPromptTemplate(input.workspaceId, promptTemplateId)
  }

  if (skillDefinitionId) {
    await getWorkspaceSharedSkillDefinition(input.workspaceId, skillDefinitionId)
  }

  const { data, error } = await supabase
    .schema('app')
    .from('context_bindings')
    .insert({
      workspace_id: input.workspaceId,
      binding_type: bindingType,
      target_key: targetKey,
      prompt_template_id: promptTemplateId,
      skill_definition_id: skillDefinitionId,
      priority,
      metadata: input.metadata ?? {}
    })
    .select(contextBindingSelect)
    .single()

  if (error || !data) throw error ?? new Error('Failed to create context binding.')

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'context.binding_created',
    resourceType: 'context_binding',
    resourceId: data.id,
    metadata: {
      binding_type: bindingType,
      target_key: targetKey
    }
  })

  return normalizeContextBindingRow(
    data as {
      id: string
      workspace_id: string
      binding_type: string
      target_key: string
      prompt_template_id: string | null
      skill_definition_id: string | null
      priority: number
      metadata: Json
      created_at: string
      updated_at: string
      prompt_template?: {
        id: string
        name: string
        slug: string
        description: string | null
        owner_user_id: string | null
      } | Array<{
        id: string
        name: string
        slug: string
        description: string | null
        owner_user_id: string | null
      }> | null
      skill_definition?: {
        id: string
        name: string
        slug: string
        description: string | null
        owner_user_id: string | null
      } | Array<{
        id: string
        name: string
        slug: string
        description: string | null
        owner_user_id: string | null
      }> | null
    }
  )
}

export async function deleteContextBinding(input: {
  workspaceId: string
  bindingId: string
  actorUserId: string
}) {
  const supabase = createServiceRoleClient()
  const { data: binding } = await supabase
    .schema('app')
    .from('context_bindings')
    .select('id,binding_type,target_key')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.bindingId)
    .maybeSingle()

  if (!binding) {
    throw new Error('Context binding not found.')
  }

  const { error } = await supabase
    .schema('app')
    .from('context_bindings')
    .delete()
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.bindingId)

  if (error) throw error

  await logAuditEvent({
    workspaceId: input.workspaceId,
    actorType: 'user',
    actorUserId: input.actorUserId,
    action: 'context.binding_deleted',
    resourceType: 'context_binding',
    resourceId: binding.id,
    metadata: {
      binding_type: binding.binding_type,
      target_key: binding.target_key
    }
  })

  return binding
}

export async function listWorkspaceResources(workspaceId: string, userId: string | null | undefined) {
  const boundResources = await resolveBoundContextResources(workspaceId, userId, {
    includeAllBindings: true
  })

  if (boundResources.length > 0) {
    return boundResources.map(
      (resource): McpResourceDefinition => ({
        uri: resource.uri,
        name: buildBindingResourceName(resource),
        description: buildBindingResourceDescription(resource),
        mimeType: resource.mimeType
      })
    )
  }

  const [prompts, skills] = await Promise.all([
    listPromptTemplates(workspaceId, userId),
    listSkillDefinitions(workspaceId, userId)
  ])

  const promptResources = prompts.map(
    (item): McpResourceDefinition => ({
      uri: `plusmy://prompt/${item.id}`,
      name: item.name,
      description: item.description ?? 'Prompt template',
      mimeType: 'text/markdown'
    })
  )

  const skillResources = skills.map(
    (item): McpResourceDefinition => ({
      uri: `plusmy://skill/${item.id}`,
      name: item.name,
      description: item.description ?? 'Skill definition',
      mimeType: 'text/markdown'
    })
  )

  return [...promptResources, ...skillResources]
}

async function resolveWorkspaceResourceRecord(
  workspaceId: string,
  userId: string | null | undefined,
  uri: string
): Promise<WorkspaceResourceRecord | null> {
  const parsed = parseResourceUri(uri)
  if (!parsed) return null

  if (parsed.format === 'binding') {
    const boundResources = await resolveBoundContextResources(workspaceId, userId, {
      includeAllBindings: true,
      bindingType: parsed.bindingType,
      targetKey: parsed.targetKey
    })
    const resource = boundResources.find((entry) => entry.uri === uri && entry.kind === parsed.kind && entry.resourceId === parsed.id)
    if (!resource) return null
    return {
      uri,
      mimeType: resource.mimeType,
      text: resource.text,
      name: resource.name,
      description: resource.description
    }
  }

  const supabase = createServiceRoleClient()
  if (parsed.kind === 'prompt') {
    const { data } = await supabase
      .schema('app')
      .from('prompt_templates')
      .select('id,name,description,content,owner_user_id')
      .eq('workspace_id', workspaceId)
      .eq('id', parsed.id)
      .maybeSingle()

    if (!data || (data.owner_user_id && data.owner_user_id !== userId)) return null
    return {
      uri,
      mimeType: 'text/markdown',
      text: data.content,
      name: data.name,
      description: data.description ?? null
    }
  }

  const { data } = await supabase
    .schema('app')
    .from('skill_definitions')
    .select('id,name,description,instructions,owner_user_id')
    .eq('workspace_id', workspaceId)
    .eq('id', parsed.id)
    .maybeSingle()

  if (!data || (data.owner_user_id && data.owner_user_id !== userId)) return null
  return {
    uri,
    mimeType: 'text/markdown',
    text: data.instructions,
    name: data.name,
    description: data.description ?? null
  }
}

export async function readWorkspaceResource(workspaceId: string, userId: string | null | undefined, uri: string): Promise<McpResourceContent[]> {
  const resource = await resolveWorkspaceResourceRecord(workspaceId, userId, uri)
  if (!resource) return []

  return [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }]
}

export async function readWorkspaceResourceWithContext(workspaceId: string, userId: string | null | undefined, uri: string) {
  const resource = await resolveWorkspaceResourceRecord(workspaceId, userId, uri)
  if (!resource) {
    return {
      contents: [] as McpResourceContent[],
      contextInjection: { query: '', matches: [] } satisfies ContextInjectionResult,
      resourceName: null as string | null
    }
  }

  const contextInjection = await resolveContextInjection(
    workspaceId,
    [resource.name, resource.description ?? null, resource.text, resource.uri],
    3
  )

  return {
    contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }] as McpResourceContent[],
    contextInjection,
    resourceName: resource.name
  }
}

export async function resolveProviderRuntimeContext(
  workspaceId: string,
  userId: string | null | undefined,
  target: {
    provider: string
    toolName?: string | null
  }
): Promise<ProviderRuntimeContext> {
  const resources = await resolveBoundContextResources(workspaceId, userId, {
    provider: target.provider,
    toolName: target.toolName,
    dedupeByResource: true
  })

  return {
    resources,
    prompts: resources.filter((resource) => resource.kind === 'prompt'),
    skills: resources.filter((resource) => resource.kind === 'skill')
  }
}

export async function resolveContextInjection(workspaceId: string, parts: Array<string | null | undefined>, limit = 3): Promise<ContextInjectionResult> {
  const query = buildContextQuery(parts)
  if (!query) {
    return { query: '', matches: [] }
  }

  return {
    query,
    matches: await matchContextChunks(workspaceId, query, limit)
  }
}

export async function matchContextChunks(workspaceId: string, query: string, limit = 8): Promise<ContextChunkMatch[]> {
  const embedding = await createEmbedding(query)
  if (!embedding) return []

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.schema('app').rpc('match_context_chunks', {
    p_workspace_id: workspaceId,
    p_query_embedding: embedding,
    p_limit: limit,
    p_filters: {}
  })

  if (error) throw error
  return ((data ?? []) as ContextChunkMatchRow[]).map((item) => ({
    chunkId: item.chunk_id,
    assetId: item.asset_id,
    title: item.title,
    content: item.content,
    similarity: item.similarity,
    metadata: item.metadata ?? {}
  }))
}
