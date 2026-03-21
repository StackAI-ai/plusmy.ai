'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@plusmy/ui';

export function RevokeInviteButton({ workspaceId, inviteId }: { workspaceId: string; inviteId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/workspace-invites', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, invite_id: inviteId })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Invite revoke failed.');
      setSubmitting(false);
      return;
    }

    setStatus('Revoked.');
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <Button type="button" tone="secondary" disabled={submitting} onClick={handleClick}>
        {submitting ? 'Revoking…' : 'Revoke'}
      </Button>
      {status ? <p className="text-xs text-slate-500">{status}</p> : null}
    </div>
  );
}
