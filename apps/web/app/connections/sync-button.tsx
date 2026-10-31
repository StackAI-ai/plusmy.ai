'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@plusmy/ui';
import { requestConnectionSync } from './sync-request';

export function SyncConnectionButton({ workspaceId, connectionId }: { workspaceId: string; connectionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    setStatus(null);

    try {
      const result = await requestConnectionSync(workspaceId, connectionId);
      setStatus(result.message);
      if (result.ok) router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={submitting} tone="secondary" type="button">
        {submitting ? 'Queueing…' : 'Run sync'}
      </Button>
      <p className="text-xs text-slate-500" role="status">{status}</p>
    </div>
  );
}
