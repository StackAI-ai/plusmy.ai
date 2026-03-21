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
      <CardHeader>
        <CardTitle>Register client</CardTitle>
        <CardDescription>Create an OAuth client that can use the plusmy.ai authorization server with PKCE.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="client-name">MCP client name</Label>
          <Input
            id="client-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="redirect-uri">Redirect URI</Label>
          <Input
            id="redirect-uri"
            type="url"
            value={redirectUri}
            onChange={(event) => setRedirectUri(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-method">Token auth method</Label>
          <Select value={authMethod} onValueChange={(value) => setAuthMethod(value === 'client_secret_post' ? 'client_secret_post' : 'none')}>
            <SelectTrigger id="auth-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Public client (PKCE only)</SelectItem>
              <SelectItem value="client_secret_post">Confidential client</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Registering…' : 'Register client'}
        </Button>
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        {secret ? <p className="font-mono text-xs text-muted-foreground">Client secret: {secret}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
