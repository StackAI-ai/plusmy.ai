const operatorPaths = new Set([
  '/dashboard', '/workspaces', '/connections', '/platforms', '/context', '/audit',
  '/mcp-clients', '/mcp-setup', '/mcp-setup/quickstart', '/onboarding'
]);
const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultPath = '/dashboard';

// Only non-secret operator state may travel through the email auth provider.
export function safeSignInReturnPath(value: string | null | undefined) {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return defaultPath;
  }

  const url = new URL(value, 'https://return.invalid');
  if (url.origin !== 'https://return.invalid' || !operatorPaths.has(url.pathname)) return defaultPath;
  const workspace = url.searchParams.get('workspace');
  if (!workspace || !workspaceIdPattern.test(workspace)) return url.pathname;
  return `${url.pathname}?${new URLSearchParams({ workspace }).toString()}`;
}

export function buildLoginHref(pathname: string, workspaceId?: string | null) {
  const query = workspaceId ? `?${new URLSearchParams({ workspace: workspaceId })}` : '';
  return `/login?${new URLSearchParams({ next: safeSignInReturnPath(`${pathname}${query}`) })}`;
}

export function buildSignInCallbackUrl(origin: string, returnPath: string | null | undefined) {
  const callback = new URL('/auth/callback', origin);
  const next = safeSignInReturnPath(returnPath);
  if (next !== defaultPath) callback.searchParams.set('next', next);
  return callback.toString();
}
