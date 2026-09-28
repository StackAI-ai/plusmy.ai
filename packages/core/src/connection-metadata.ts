import type { Json } from '@plusmy/contracts';

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === 'raw' || normalized === 'key' ||
    /(token|secret|password|credential|authorization|apikey|cookie|signature|privatekey|bearer)/.test(normalized);
}

export function sanitizeConnectionMetadata(
  metadata: Record<string, unknown> | null | undefined,
  credentials: Array<string | null | undefined> = []
): Record<string, Json> {
  const secretValues = credentials.filter((value): value is string => typeof value === 'string' && value.length >= 8);

  function sanitize(value: unknown): Json | undefined {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return secretValues.some((secret) => value.includes(secret)) ? undefined : value;
    }
    if (Array.isArray(value)) {
      return value.map(sanitize).filter((item): item is Json => item !== undefined);
    }
    if (value && typeof value === 'object') {
      const clean: Record<string, Json> = {};
      for (const [key, nested] of Object.entries(value)) {
        if (isSensitiveKey(key)) continue;
        const sanitized = sanitize(nested);
        if (sanitized !== undefined) clean[key] = sanitized;
      }
      return clean;
    }
    return undefined;
  }

  return sanitize(metadata ?? {}) as Record<string, Json>;
}
