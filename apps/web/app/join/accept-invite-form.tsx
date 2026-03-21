'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@plusmy/ui';

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/workspace-invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Unable to accept invite.');
      setSubmitting(false);
      return;
    }

    setStatus('Invite accepted. Redirecting to workspaces…');
    setSubmitting(false);
    router.push('/workspaces');
  }

  return (
    <Card>
      <div className="space-y-4">
        <p className="text-sm leading-7 text-slate-700">
          Accept this invite to join the workspace tied to the token in the URL. You need to be signed in with the invited email address.
        </p>
        <Button type="button" disabled={submitting} onClick={handleAccept}>
          {submitting ? 'Accepting…' : 'Accept invite'}
        </Button>
        {status ? <p className="text-sm text-slate-700">{status}</p> : null}
      </div>
    </Card>
  );
}
