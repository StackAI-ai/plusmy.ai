'use client';

import { useMemo, useState } from 'react';
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
  SelectValue,
  Textarea
} from '@plusmy/ui';

type Mode = 'asset' | 'prompt' | 'skill';
type ScopeMode = 'workspace' | 'personal';

export function ContextIngestForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('asset');
  const [scope, setScope] = useState<ScopeMode>('workspace');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUri, setSourceUri] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const endpoint = useMemo(() => {
    if (mode === 'prompt') return '/api/prompts';
    if (mode === 'skill') return '/api/skills';
    return '/api/context-assets';
  }, [mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const payload =
      mode === 'asset'
        ? {
            workspace_id: workspaceId,
            scope,
            type: 'document',
            title,
            content: body,
            source_uri: sourceUri || null
          }
        : mode === 'prompt'
          ? {
              workspace_id: workspaceId,
              scope,
              name: title,
              description,
              content: body
            }
          : {
              workspace_id: workspaceId,
              scope,
              name: title,
              description,
              instructions: body
            };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(json?.error ?? 'Request failed.');
      setSubmitting(false);
      return;
    }

    setTitle('');
    setBody('');
    setDescription('');
    setSourceUri('');
    setStatus(`${scope} ${mode} created.`);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingest content</CardTitle>
        <CardDescription>Load workspace or personal assets, prompt templates, and skill definitions.</CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {(['asset', 'prompt', 'skill'] as Mode[]).map((value) => (
            <Button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              variant={mode === value ? 'default' : 'outline'}
              size="sm"
            >
              {value}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="context-scope">Visibility</Label>
          <Select value={scope} onValueChange={(value) => setScope(value === 'personal' ? 'personal' : 'workspace')}>
            <SelectTrigger id="context-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workspace">Workspace shared</SelectItem>
              <SelectItem value="personal">Personal only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="context-title">{mode === 'asset' ? 'Asset title' : 'Name'}</Label>
          <Input
            id="context-title"
            type="text"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        {mode !== 'asset' ? (
          <div className="space-y-2">
            <Label htmlFor="context-description">Description</Label>
            <Input
              id="context-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        ) : null}
        {mode === 'asset' ? (
          <div className="space-y-2">
            <Label htmlFor="context-source-uri">Source URI</Label>
            <Input
              id="context-source-uri"
              type="text"
              value={sourceUri}
              onChange={(event) => setSourceUri(event.target.value)}
              placeholder="notion://page/123 or https://docs.google.com/..."
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="context-body">{mode === 'skill' ? 'Instructions' : 'Content'}</Label>
          <Textarea
            id="context-body"
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
          />
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Saving…' : `Create ${mode}`}
        </Button>
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
