'use client';

import { useState } from 'react';
import { Button, Card, Label, Textarea } from '@plusmy/ui';

type Match = {
  chunk_id: string;
  title: string;
  content: string;
  similarity: number;
};

export function ContextSearchForm({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const response = await fetch('/api/context-search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, query, limit: 6 })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(payload?.error ?? 'Search failed.');
      setSubmitting(false);
      return;
    }

    setMatches(payload.matches ?? []);
    setStatus(`${(payload.matches ?? []).length} matches`);
    setSubmitting(false);
  }

  return (
    <Card>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="context-query">Semantic search</Label>
          <Textarea
            id="context-query"
            rows={4}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find onboarding instructions for Slack approvals"
          />
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Searching…' : 'Search context'}
        </Button>
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      </form>
      {matches.length ? (
        <div className="mt-5 space-y-3">
          {matches.map((match) => (
            <div key={match.chunk_id} className="rounded-2xl border border-border/70 bg-card/90 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-ink">{match.title}</p>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{match.similarity?.toFixed?.(3) ?? match.similarity}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{match.content}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
