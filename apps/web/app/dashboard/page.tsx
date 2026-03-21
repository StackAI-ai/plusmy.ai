import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui'
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
import { LinkBadge } from '../_components/link-badge'
import { buildAuditHref } from '../_lib/audit-href'
import { buildConnectionsHref } from '../connections/filters'

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
        <CardHeader>
          <CardTitle className="text-2xl">Sign in required</CardTitle>
          <CardDescription>
            The dashboard reads live workspace state from Supabase Auth and the `app` schema. Sign in before
            creating a workspace or attaching integrations.
          </CardDescription>
        </CardHeader>
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
  const deadLetterConnectionJobs = connectionJobs.filter((job) => job.status === 'dead_letter').length
  const activeApprovals = approvals.filter((approval) => approval.status === 'active').length
  const revokedApprovals = approvals.filter((approval) => approval.status === 'revoked').length
  const approvalSignal = approvals.length === 0 ? 'none' : `${activeApprovals} active / ${approvals.length} total`
  const reauthConnectionsHref = activeWorkspace
    ? buildConnectionsHref(activeWorkspace.id, {}, { health: 'reauth_required' })
    : null
  const failedJobsAuditHref = activeWorkspace
    ? buildAuditHref(activeWorkspace.id, { resource: 'connection_job', action: 'connection_job.', status: 'error' })
    : null
  const deadLetterJobsAuditHref = activeWorkspace
    ? buildAuditHref(activeWorkspace.id, { resource: 'connection_job', action: 'connection_job.dead_lettered', status: 'error' })
    : null
  const approvalsHref = activeWorkspace ? `/mcp-clients?workspace=${activeWorkspace.id}` : null
  const attentionCount = reauthRequiredConnections + deadLetterConnectionJobs + failedConnectionJobs

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-3">
            <CardTitle className="text-2xl">Workspace control plane</CardTitle>
            <CardDescription>
              Live view of the selected workspace, its integration footprint, and the shared prompt and skill
              surface behind the MCP server.
            </CardDescription>
          </div>
          <Badge tone="moss">{activeWorkspace ? activeWorkspace.name : 'No workspace yet'}</Badge>
        </CardHeader>
      </Card>

      {activeWorkspace && attentionCount > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Operator notifications</CardTitle>
            <CardDescription>
              Immediate workspace actions for degraded provider installs and background job failures.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {reauthRequiredConnections > 0 ? (
              <p>
                <LinkBadge href={reauthConnectionsHref} tone="brass">
                  {reauthRequiredConnections} connections need reauthorization
                </LinkBadge>{' '}
                Provider access has expired or drifted and needs a fresh consent flow.
              </p>
            ) : null}
            {deadLetterConnectionJobs > 0 ? (
              <p>
                <LinkBadge href={deadLetterJobsAuditHref} tone="brass">
                  {deadLetterConnectionJobs} jobs are dead-lettered
                </LinkBadge>{' '}
                Retry budgets are exhausted and operators need to inspect the affected installs.
              </p>
            ) : null}
            {failedConnectionJobs > 0 ? (
              <p>
                <LinkBadge href={failedJobsAuditHref} tone="brass">
                  {failedConnectionJobs} sync jobs failed recently
                </LinkBadge>{' '}
                Review provider errors before they turn into dead-letter incidents.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Workspaces</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{workspaces.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">
              {activeConnections}/{overview?.connections ?? 0}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {pendingConnections} pending · {reauthRequiredConnections} reauth required
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Prompt templates</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{overview?.prompts ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Skill definitions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{overview?.skills ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Context assets</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{overview?.assets ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Binding rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{overview?.bindings ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">MCP approvals</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{approvalSignal}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {revokedApprovals ? `${revokedApprovals} revoked` : 'No revoked approvals'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Sync jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold text-foreground">{processingConnectionJobs + queuedConnectionJobs}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {processingConnectionJobs} processing · {queuedConnectionJobs} queued · {deadLetterConnectionJobs} dead-lettered
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Workspace health signals</CardTitle>
          <CardDescription>Operational summary for providers, jobs, and delegated approvals.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm leading-7 text-muted-foreground">
          <li className="flex flex-wrap items-center gap-2">
            <LinkBadge href={reauthConnectionsHref} tone={healthTone(reauthRequiredConnections > 0)}>
              {reauthRequiredConnections} connections need reauth
            </LinkBadge>
            {connections.length ? `${connections.length} total provider installs` : 'No provider installs yet'}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <LinkBadge href={failedJobsAuditHref} tone={healthTone(failedConnectionJobs > 0)}>
              {failedConnectionJobs} failed sync jobs
            </LinkBadge>
            <LinkBadge href={deadLetterJobsAuditHref} tone={healthTone(deadLetterConnectionJobs > 0)}>
              {deadLetterConnectionJobs} dead-letter jobs
            </LinkBadge>
            {processingConnectionJobs > 0 ? `${processingConnectionJobs} jobs running now` : 'No jobs currently processing'}
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <LinkBadge href={approvalsHref} tone={healthTone(approvals.length === 0)}>
              {approvals.length} approvals
            </LinkBadge>
            {canReviewWorkspaceApprovals ? 'Workspace-level MCP approvals included' : 'Showing only user-scoped approvals'}
          </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
