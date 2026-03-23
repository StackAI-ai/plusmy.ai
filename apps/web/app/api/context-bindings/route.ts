import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@plusmy/supabase'
import {
  createContextBinding,
  deleteContextBinding,
  getAuthorizedWorkspace,
  listContextBindings,
  listUserWorkspaces
} from '@plusmy/core'
import { parseJsonBody, parseSearchParams, validationErrorResponse } from '../_lib/validation'

export const runtime = 'nodejs'

const contextBindingQuerySchema = z.object({
  workspace_id: z.string().uuid().optional()
})

const createContextBindingSchema = z.object({
  workspace_id: z.string().uuid(),
  binding_type: z.enum(['workspace', 'provider', 'tool']),
  target_key: z.string().trim().min(1).max(160),
  prompt_template_id: z.string().uuid().nullable().optional(),
  skill_definition_id: z.string().uuid().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  metadata: z.record(z.string(), z.unknown()).optional()
})

const deleteContextBindingSchema = z.object({
  workspace_id: z.string().uuid(),
  binding_id: z.string().uuid()
})

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin'
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let query: z.infer<typeof contextBindingQuerySchema>
  try {
    query = parseSearchParams(request.url, contextBindingQuerySchema)
  } catch (error) {
    return validationErrorResponse(error)
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id ?? null)
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 })
  }

  const bindings = await listContextBindings(workspace.id, user.id)
  return NextResponse.json({ workspace, bindings })
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof createContextBindingSchema>
  try {
    body = await parseJsonBody(request, createContextBindingSchema)
  } catch (error) {
    return validationErrorResponse(error)
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id)
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 })
  }

  const memberships = await listUserWorkspaces(user.id)
  const activeMembership = memberships.find((entry) => entry.id === workspace.id)
  if (!canManageWorkspace(activeMembership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    const binding = await createContextBinding({
      workspaceId: workspace.id,
      actorUserId: user.id,
      bindingType: body.binding_type,
      targetKey: body.target_key,
      promptTemplateId: body.prompt_template_id ?? null,
      skillDefinitionId: body.skill_definition_id ?? null,
      priority: body.priority ?? 100,
      metadata: body.metadata ?? {}
    })

    return NextResponse.json({ binding }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Context binding create failed.' },
      { status: 400 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof deleteContextBindingSchema>
  try {
    body = await parseJsonBody(request, deleteContextBindingSchema)
  } catch (error) {
    return validationErrorResponse(error)
  }

  const workspace = await getAuthorizedWorkspace(user.id, body.workspace_id)
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 })
  }

  const memberships = await listUserWorkspaces(user.id)
  const activeMembership = memberships.find((entry) => entry.id === workspace.id)
  if (!canManageWorkspace(activeMembership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    await deleteContextBinding({
      workspaceId: workspace.id,
      bindingId: body.binding_id,
      actorUserId: user.id
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = error instanceof Error && error.message === 'Context binding not found.' ? 404 : 400
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Context binding delete failed.' },
      { status }
    )
  }
}
