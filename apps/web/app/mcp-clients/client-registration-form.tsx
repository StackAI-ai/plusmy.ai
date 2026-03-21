'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@plusmy/ui';

export function ClientRegistrationForm() {
  const router = useRouter();
  const [name, setName] = useState('Cursor');
  const [redirectUri, setRedirectUri] = useState('http://localhost:3000/callback');
  const [authMethod, setAuthMethod] = useState<'none' | 'client_secret_post'>('none');
  const [status, setStatus] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    setSecret(null);

    const response = await fetch('/api/oauth-clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: authMethod
      })
    });

    const payload = await response.json().catch(() => null);
    if (response.ok === false) {
      setStatus(payload?.error ?? 'Client registration failed.');
      setSubmitting(false);
      return;
    }

    setStatus(`Registered ${payload.client.client_name}.`);
    setSecret(payload.client.client_secret ?? null);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <Card>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="client-name">
            MCP client name
          </label>
          <input
            id="client-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="redirect-uri">
            Redirect URI
          </label>
          <input
            id="redirect-uri"
            type="url"
            value={redirectUri}
            onChange={(event) => setRedirectUri(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="auth-method">
            Token auth method
          </label>
          <select
            id="auth-method"
            value={authMethod}
            onChange={(event) => setAuthMethod(event.target.value === 'client_secret_post' ? 'client_secret_post' : 'none')}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
          >
            <option value="none">Public client (PKCE only)</option>
            <option value="client_secret_post">Confidential client</option>
          </select>
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Registering…' : 'Register client'}
        </Button>
        {status ? <p className="text-sm text-slate-700">{status}</p> : null}
        {secret ? <p className="text-xs text-slate-500">Client secret: {secret}</p> : null}
      </form>
    </Card>
  );
}
