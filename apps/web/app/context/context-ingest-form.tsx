'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@plusmy/ui';

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
      <div className="mb-4 flex gap-2">
        {(['asset', 'prompt', 'skill'] as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${mode === value ? 'bg-[#13201d] text-white' : 'bg-black/5 text-[#13201d]'}`}
          >
            {value}
          </button>
        ))}
      </div>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="context-scope">
            Visibility
          </label>
          <select
            id="context-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value === 'personal' ? 'personal' : 'workspace')}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
          >
            <option value="workspace">Workspace shared</option>
            <option value="personal">Personal only</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="context-title">
            {mode === 'asset' ? 'Asset title' : 'Name'}
          </label>
          <input
            id="context-title"
            type="text"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
          />
        </div>
        {mode !== 'asset' ? (
          <div>
            <label className="text-sm font-semibold text-slate-700" htmlFor="context-description">
              Description
            </label>
            <input
              id="context-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
            />
          </div>
        ) : null}
        {mode === 'asset' ? (
          <div>
            <label className="text-sm font-semibold text-slate-700" htmlFor="context-source-uri">
              Source URI
            </label>
            <input
              id="context-source-uri"
              type="text"
              value={sourceUri}
              onChange={(event) => setSourceUri(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
              placeholder="notion://page/123 or https://docs.google.com/..."
            />
          </div>
        ) : null}
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="context-body">
            {mode === 'skill' ? 'Instructions' : 'Content'}
          </label>
          <textarea
            id="context-body"
            required
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            className="mt-2 w-full rounded-3xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
          />
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Saving…' : `Create ${mode}`}
        </Button>
        {status ? <p className="text-sm text-slate-700">{status}</p> : null}
      </form>
    </Card>
  );
}
