'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@plusmy/ui';

function formatInviteError(message: string) {
  if (message === 'Invite expired.') {
    return 'This invite expired. Ask the workspace owner for a new link.';
  }

  if (message === 'Invite already accepted.') {
    return 'This invite was already used.';
  }

  if (message === 'Invite email does not match current user.') {
    return 'Sign in with the invited email address before accepting this invite.';
  }

  if (message === 'You are already a member of this workspace.') {
    return 'You are already in this workspace. Open Workspaces instead.';
  }

  return message;
}

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
      setStatus(formatInviteError(payload?.error ?? 'Unable to accept invite.'));
      setSubmitting(false);
      return;
    }

    setStatus('Invite accepted. Redirecting to workspaces…');
    setSubmitting(false);
    router.push('/workspaces');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accept invitation</CardTitle>
        <CardDescription>
          Accept this invite to join the workspace tied to the token in the URL. You need to be signed in with
          the invited email address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" disabled={submitting} onClick={handleAccept}>
          {submitting ? 'Accepting…' : 'Accept invite'}
        </Button>
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      </CardContent>
    </Card>
  );
}
