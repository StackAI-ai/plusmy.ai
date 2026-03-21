'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Input, Label } from '@plusmy/ui';

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name })
    });

    const payload = await response.json().catch(() => null);
    if (response.ok === false) {
      setStatus(payload?.error ?? 'Failed to create workspace.');
      setSubmitting(false);
      return;
    }

    const workspaceId = payload?.workspace?.id ? String(payload.workspace.id) : null;
    setName('');
    setStatus('Workspace created.');
    setSubmitting(false);

    if (workspaceId) {
      router.push(`/workspaces?workspace=${workspaceId}`);
      return;
    }

    router.refresh();
  }

  return (
    <Card>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="workspace-name">Workspace name</Label>
          <Input
            id="workspace-name"
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Acme Revenue Ops"
          />
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Creating…' : 'Create workspace'}
        </Button>
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      </form>
    </Card>
  );
}
