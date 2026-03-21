import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';
import { AcceptInviteForm } from './accept-invite-form';

export default async function JoinPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Invite token required</CardTitle>
          <CardDescription>
            Open the full invite URL or paste the token into the query string as `?token=...`.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
      <Card>
        <CardHeader>
          <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">Workspace invite</p>
          <CardTitle className="text-4xl leading-tight">Join a plusmy.ai workspace.</CardTitle>
          <CardDescription>
            Invitations grant workspace-level access to connected providers, context assets, prompts, skills, and
            MCP approvals.
          </CardDescription>
        </CardHeader>
      </Card>
      <AcceptInviteForm token={token} />
    </div>
  );
}
