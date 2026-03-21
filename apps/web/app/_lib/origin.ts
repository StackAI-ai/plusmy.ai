import { headers } from 'next/headers';

function normalizeOrigin(candidate: string | null | undefined) {
  if (!candidate) return null;

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

export async function getAppOrigin() {
  const envOrigin = normalizeOrigin(process.env.APP_URL);
  if (envOrigin) return envOrigin;

  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const proto = requestHeaders.get('x-forwarded-proto') ?? (host?.includes('localhost') ? 'http' : 'https');

  if (host) {
    return `${proto}://${host}`;
  }

  return 'http://localhost:3000';
}
