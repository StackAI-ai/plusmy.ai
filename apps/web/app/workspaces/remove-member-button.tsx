'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@plusmy/ui';

export function RemoveMemberButton({ workspaceId, memberId }: { workspaceId: string; memberId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/workspace-members', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, member_id: memberId })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Removal failed.');
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setStatus('Removed.');
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <Button type="button" tone="secondary" disabled={submitting} onClick={handleClick}>
        {submitting ? 'Removing…' : 'Remove'}
      </Button>
      {status ? <p className="text-xs text-slate-500">{status}</p> : null}
    </div>
  );
}
