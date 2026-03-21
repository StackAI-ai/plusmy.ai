'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@plusmy/ui';

export function MemberRoleSelect({
  workspaceId,
  memberId,
  currentRole,
  canAssignOwner
}: {
  workspaceId: string;
  memberId: string;
  currentRole: 'owner' | 'admin' | 'member';
  canAssignOwner: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState(currentRole);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleChange(nextRole: 'owner' | 'admin' | 'member') {
    setRole(nextRole);
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/workspace-members', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, member_id: memberId, role: nextRole })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setRole(currentRole);
      setStatus(payload?.error ?? 'Role update failed.');
      setSubmitting(false);
      return;
    }

    setStatus('Role updated.');
    setSubmitting(false);
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <Select disabled={submitting} value={role} onValueChange={(value) => handleChange(value as 'owner' | 'admin' | 'member')}>
        <SelectTrigger aria-label="Update member role" className="h-9 rounded-full px-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {canAssignOwner ? <SelectItem value="owner">Owner</SelectItem> : null}
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="member">Member</SelectItem>
        </SelectContent>
      </Select>
      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
    </div>
  );
}
