import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@plusmy/supabase'
import {
  createContextBinding,
  deleteContextBinding,
  getAuthorizedWorkspace,
  listContextBindings,
  listUserWorkspaces
} from '@plusmy/core'

export const runtime = 'nodejs'

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

  const requestedWorkspace = new URL(request.url).searchParams.get('workspace_id')
  const workspace = await getAuthorizedWorkspace(user.id, requestedWorkspace)
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

  const body = await request.json()
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''))
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
      bindingType: String(body.binding_type ?? 'workspace') as 'workspace' | 'provider' | 'tool',
      targetKey: String(body.target_key ?? ''),
      promptTemplateId: body.prompt_template_id ? String(body.prompt_template_id) : null,
      skillDefinitionId: body.skill_definition_id ? String(body.skill_definition_id) : null,
      priority: typeof body.priority === 'number' ? body.priority : Number(body.priority ?? 100),
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

  const body = await request.json()
  const workspace = await getAuthorizedWorkspace(user.id, String(body.workspace_id ?? ''))
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
      bindingId: String(body.binding_id ?? ''),
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
