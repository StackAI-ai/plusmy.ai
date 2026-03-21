import { Card, Badge } from '@plusmy/ui'
import { createServerSupabaseClient } from '@plusmy/supabase'
import {
  getAuthorizedWorkspace,
  getWorkspaceOverview,
  listOAuthClientApprovals,
  listConnectionJobs,
  listConnectionsForWorkspace,
  listUserWorkspaces
} from '@plusmy/core'
import { getSearchParam, type AppSearchParams } from '../_lib/search-params'

function healthTone(hasIssue: boolean) {
  return hasIssue ? 'brass' : 'moss'
}

export default async function DashboardPage({ searchParams }: { searchParams?: AppSearchParams }) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">Sign in required</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          The dashboard reads live workspace state from Supabase Auth and the `app` schema. Sign in before creating a workspace or attaching integrations.
        </p>
      </Card>
    )
  }

  const workspaces = await listUserWorkspaces(user.id)
  const requestedWorkspaceId = await getSearchParam(searchParams, 'workspace')
  const activeWorkspace = await getAuthorizedWorkspace(user.id, requestedWorkspaceId)
  const activeMembership = activeWorkspace ? workspaces.find((entry) => entry.id === activeWorkspace.id) : null
  const canReviewWorkspaceApprovals = activeMembership?.role === 'owner' || activeMembership?.role === 'admin'
  const [overview, connections, connectionJobs, approvals] = activeWorkspace
    ? await Promise.all([
        getWorkspaceOverview(activeWorkspace.id, user.id),
        listConnectionsForWorkspace(activeWorkspace.id, user.id),
        listConnectionJobs(activeWorkspace.id, 80),
        listOAuthClientApprovals({
          workspaceId: activeWorkspace.id,
          userId: user.id,
          includeWorkspaceApprovals: canReviewWorkspaceApprovals
        })
      ])
    : [null, [], [], []]

  const activeConnections = connections.filter((connection) => connection.status === 'active').length
  const pendingConnections = connections.filter((connection) => connection.status === 'pending').length
  const reauthRequiredConnections = connections.filter((connection) => connection.status === 'reauth_required').length
  const queuedConnectionJobs = connectionJobs.filter((job) => job.status === 'queued').length
  const processingConnectionJobs = connectionJobs.filter((job) => job.status === 'processing').length
  const failedConnectionJobs = connectionJobs.filter((job) => job.status === 'failed').length
  const activeApprovals = approvals.filter((approval) => approval.status === 'active').length
  const revokedApprovals = approvals.filter((approval) => approval.status === 'revoked').length
  const approvalSignal = approvals.length === 0 ? 'none' : `${activeApprovals} active / ${approvals.length} total`

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Workspace control plane</h1>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Live view of the selected workspace, its integration footprint, and the shared prompt and skill surface behind the MCP server.
            </p>
          </div>
          <Badge tone="moss">{activeWorkspace ? activeWorkspace.name : 'No workspace yet'}</Badge>
        </div>
      </Card>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Workspaces</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{workspaces.length}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Connections</p>
          <p className="mt-3 text-4xl font-semibold text-ink">
            {activeConnections}/{overview?.connections ?? 0}
          </p>
          <p className="mt-2 text-sm text-slate-700">{pendingConnections} pending · {reauthRequiredConnections} reauth required</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Prompt templates</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.prompts ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Skill definitions</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.skills ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Context assets</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.assets ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Binding rules</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{overview?.bindings ?? 0}</p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">MCP approvals</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{approvalSignal}</p>
          <p className="mt-2 text-sm text-slate-700">
            {revokedApprovals ? `${revokedApprovals} revoked` : 'No revoked approvals'}
          </p>
        </Card>
        <Card>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Sync jobs</p>
          <p className="mt-3 text-4xl font-semibold text-ink">{processingConnectionJobs + queuedConnectionJobs}</p>
          <p className="mt-2 text-sm text-slate-700">
            {processingConnectionJobs} processing · {queuedConnectionJobs} queued · {failedConnectionJobs} failed
          </p>
        </Card>
      </section>

      <Card>
        <h2 className="text-xl font-semibold">Workspace health signals</h2>
        <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
          <li className="flex flex-wrap items-center gap-2">
            <Badge tone={healthTone(reauthRequiredConnections > 0)}>{reauthRequiredConnections} connections need reauth</Badge>
            {connections.length ? `${connections.length} total provider installs` : 'No provider installs yet'}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <Badge tone={healthTone(failedConnectionJobs > 0)}>{failedConnectionJobs} failed sync jobs</Badge>
            {processingConnectionJobs > 0 ? `${processingConnectionJobs} jobs running now` : 'No jobs currently processing'}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <Badge tone={healthTone(approvals.length === 0)}>{approvals.length} approvals</Badge>
            {canReviewWorkspaceApprovals ? 'Workspace-level MCP approvals included' : 'Showing only user-scoped approvals'}
          </li>
        </ul>
      </Card>
    </div>
  )
}
