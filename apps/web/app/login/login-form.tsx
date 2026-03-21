'use client';

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@plusmy/supabase/browser';
import { Button, Card } from '@plusmy/ui';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const supabase = createBrowserSupabaseClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo
      }
    });

    if (error) {
      setStatus(error.message);
    } else {
      setStatus('Magic link sent. Check your inbox.');
      setEmail('');
    }

    setSubmitting(false);
  }

  return (
    <Card>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="text-sm font-semibold text-slate-700" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0"
            placeholder="you@company.com"
          />
        </div>
        <Button disabled={submitting} type="submit">
          {submitting ? 'Sending…' : 'Send magic link'}
        </Button>
        {status ? <p className="text-sm text-slate-700">{status}</p> : null}
      </form>
    </Card>
  );
}
