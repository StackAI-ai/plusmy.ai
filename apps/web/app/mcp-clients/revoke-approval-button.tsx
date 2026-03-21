'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@plusmy/ui';

export function RevokeApprovalButton({
  workspaceId,
  approvalId
}: {
  workspaceId: string;
  approvalId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/oauth-clients/approvals', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, approval_id: approvalId })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Approval revoke failed.');
      setSubmitting(false);
      return;
    }

    setStatus('Approval revoked.');
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={submitting} tone="secondary" type="button">
        {submitting ? 'Revoking…' : 'Revoke approval'}
      </Button>
      {status ? <p className="text-xs text-slate-500">{status}</p> : null}
    </div>
  );
}
