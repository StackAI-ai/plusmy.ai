'use client';

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@plusmy/supabase/browser';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@plusmy/ui';
import { buildSignInCallbackUrl } from '../_lib/signin-return';

export function LoginForm({ returnPath, callbackFailed }: { returnPath: string; callbackFailed: boolean }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(callbackFailed ? 'That sign-in link could not be used. Request a new link.' : null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: buildSignInCallbackUrl(window.location.origin, returnPath)
        }
      });

      if (error) {
        setStatus(`Unable to send the sign-in link. ${error.message}`);
      } else {
        setStatus('Magic link sent. Check your inbox.');
        setEmail('');
      }
    } catch {
      setStatus('Unable to send the sign-in link. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use a magic link to access the operator surfaces for workspaces, connections, and MCP approvals.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <Button disabled={submitting} type="submit" className="w-full">
            {submitting ? 'Sending…' : 'Send magic link'}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">{status}</p>
        </form>
      </CardContent>
    </Card>
  );
}
