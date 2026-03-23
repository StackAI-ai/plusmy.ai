'use client';

import { useState } from 'react';
import { Button } from '@plusmy/ui';

type RotateClientSecretButtonProps = {
  clientId: string;
};

export function RotateClientSecretButton({ clientId }: RotateClientSecretButtonProps) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleRotate() {
    const confirmed = window.confirm('Rotate this client secret? Existing tokens stay valid, but the client must store the new secret for future token exchanges.');
    if (!confirmed) return;

    setIsLoading(true);
    setSecret(null);
    setError(null);

    try {
      const response = await fetch('/api/oauth-clients/rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : 'Secret rotation failed.');
        return;
      }

      setSecret(typeof payload.client_secret === 'string' ? payload.client_secret : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Secret rotation failed.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={handleRotate} disabled={isLoading}>
        {isLoading ? 'Rotating…' : 'Rotate secret'}
      </Button>
      {secret ? (
        <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">New client secret</p>
          <p className="mt-2 break-all font-mono text-xs">{secret}</p>
          <p className="mt-2">Store this value now. It will not be shown again.</p>
        </div>
      ) : null}
      {error ? <p className="text-xs text-amber-700">{error}</p> : null}
    </div>
  );
}
