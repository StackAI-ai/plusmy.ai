'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@plusmy/ui';

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [status, setStatus] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    setInviteLink(null);

    const response = await fetch('/api/workspace-invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, email, role })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Invite failed.');
      setSubmitting(false);
      return;
    }

    const baseUrl = window.location.origin;
    setEmail('');
    setStatus(`Invite created for ${payload.invite.email}.`);
    setInviteLink(`${baseUrl}/join?token=${payload.invite.invite_token}`);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <Card>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="invite-email">
            Invite teammate
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
            placeholder="operator@company.com"
            required
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="invite-role">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'member')}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Sending…' : 'Create invite'}
        </Button>
        {status ? <p className="text-sm text-slate-700">{status}</p> : null}
        {inviteLink ? <p className="text-xs text-slate-500">Invite link: {inviteLink}</p> : null}
      </form>
    </Card>
  );
}
