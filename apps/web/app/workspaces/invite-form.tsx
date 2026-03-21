'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@plusmy/ui';

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [status, setStatus] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    setInviteLink(null);

    const response = await fetch('/api/workspace-invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, email, role })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Invite failed.');
      setSubmitting(false);
      return;
    }

    const baseUrl = window.location.origin;
    setEmail('');
    setStatus(`Invite created for ${payload.invite.email}.`);
    setInviteLink(`${baseUrl}/join?token=${payload.invite.invite_token}`);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite teammate</CardTitle>
        <CardDescription>Generate a join link and assign the initial workspace role.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="invite-email">Invite teammate</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="operator@company.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}>
            <SelectTrigger id="invite-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Sending…' : 'Create invite'}
        </Button>
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        {inviteLink ? <p className="font-mono text-xs text-muted-foreground">Invite link: {inviteLink}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
