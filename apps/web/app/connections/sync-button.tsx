'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@plusmy/ui';

export function SyncConnectionButton({ workspaceId, connectionId }: { workspaceId: string; connectionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/connections/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, connection_id: connectionId })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error === 'connection_changed'
        ? 'This connection changed. Refresh the page and try again.'
        : payload?.error === 'connection_inactive'
          ? 'This connection is not active. Reconnect or finish setup before syncing.'
          : payload?.error === 'connection_job_fencing_unavailable'
            ? 'Sync is temporarily unavailable. Try again later.'
            : payload?.error ?? 'Sync could not be queued.');
      setSubmitting(false);
      return;
    }

    setStatus('Sync queued.');
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={submitting} tone="secondary" type="button">
        {submitting ? 'Queueing…' : 'Run sync'}
      </Button>
      {status ? <p className="text-xs text-slate-500">{status}</p> : null}
    </div>
  );
}
