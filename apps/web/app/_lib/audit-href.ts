export type AuditFilterMap = Record<string, string | null | undefined>;

export function buildAuditHref(
  workspaceId: string | null | undefined,
  updates: AuditFilterMap,
  current: AuditFilterMap = {}
) {
  const params = new URLSearchParams();

  if (workspaceId) {
    params.set('workspace', workspaceId);
  }

  for (const [key, value] of Object.entries(current)) {
    if (value) {
      params.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!value) {
      params.delete(key);
      continue;
    }

    params.set(key, value);
  }

  const query = params.toString();
  return query ? `/audit?${query}` : '/audit';
}
