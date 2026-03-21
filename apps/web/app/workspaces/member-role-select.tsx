'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
      <select
        aria-label="Update member role"
        className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm outline-none"
        disabled={submitting}
        value={role}
        onChange={(event) => handleChange(event.target.value as 'owner' | 'admin' | 'member')}
      >
        {canAssignOwner ? <option value="owner">Owner</option> : null}
        <option value="admin">Admin</option>
        <option value="member">Member</option>
      </select>
      {status ? <p className="text-xs text-slate-500">{status}</p> : null}
    </div>
  );
}
