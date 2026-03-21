'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@plusmy/ui';

export function DisconnectConnectionButton({
  workspaceId,
  connectionId
}: {
  workspaceId: string;
  connectionId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/connections', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, connection_id: connectionId })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Disconnect failed.');
      setSubmitting(false);
      return;
    }

    setStatus('Connection revoked.');
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleClick} disabled={submitting} tone="secondary" type="button">
        {submitting ? 'Revoking…' : 'Revoke connection'}
      </Button>
      {status ? <p className="text-xs text-slate-500">{status}</p> : null}
    </div>
  );
}
