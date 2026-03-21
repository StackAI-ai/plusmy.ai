import { Card } from '@plusmy/ui';
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
        <h1 className="text-2xl font-semibold">Invite token required</h1>
        <p className="mt-3 text-sm leading-7 text-slate-700">
          Open the full invite URL or paste the token into the query string as `?token=...`.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
      <Card>
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Workspace invite</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight text-ink">Join a plusmy.ai workspace.</h1>
        <p className="mt-5 text-sm leading-7 text-slate-700">
          Invitations grant workspace-level access to connected providers, context assets, prompts, skills, and MCP approvals.
        </p>
      </Card>
      <AcceptInviteForm token={token} />
    </div>
  );
}
