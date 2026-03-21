import { supportedProviders } from '@plusmy/contracts';

export type ConnectionHealthFilter = 'all' | 'healthy' | 'attention' | 'pending' | 'reauth_required' | 'revoked' | 'stale';
export type ConnectionProviderFilter = 'all' | (typeof supportedProviders)[number]['providerId'];

export interface ConnectionLike {
  provider: string;
  status: string;
  last_refreshed_at: string | null;
}

export const connectionProviderFilters = [
  { value: 'all', label: 'All providers' },
  ...supportedProviders.map((provider) => ({
    value: provider.providerId,
    label: provider.name
  }))
] as const satisfies readonly { value: ConnectionProviderFilter; label: string }[];

export const connectionHealthFilters = [
  { value: 'all', label: 'Any health' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'pending', label: 'Pending' },
  { value: 'reauth_required', label: 'Reauth required' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'stale', label: 'Stale refresh' }
] as const satisfies readonly { value: ConnectionHealthFilter; label: string }[];

const providerFilterValues = new Set<ConnectionProviderFilter>(connectionProviderFilters.map((filter) => filter.value));
const healthFilterValues = new Set<ConnectionHealthFilter>(connectionHealthFilters.map((filter) => filter.value));

function isStaleRefresh(value: string | null, maxAgeDays = 14) {
  if (!value) return true;
  const ageMs = Date.now() - new Date(value).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs > maxAgeMs;
}

export function getConnectionHealth(connection: ConnectionLike) {
  if (connection.status === 'revoked') {
    return { value: 'revoked' as const, label: 'Revoked', tone: 'brass' as const };
  }

  if (connection.status === 'reauth_required') {
    return { value: 'reauth_required' as const, label: 'Reauth required', tone: 'brass' as const };
  }

  if (connection.status === 'pending') {
    return { value: 'pending' as const, label: 'Pending', tone: 'default' as const };
  }

  if (connection.status === 'active' && isStaleRefresh(connection.last_refreshed_at)) {
    return { value: 'stale' as const, label: 'Stale refresh', tone: 'brass' as const };
  }

  return { value: 'healthy' as const, label: 'Healthy', tone: 'moss' as const };
}

export function matchesConnectionHealth(connection: ConnectionLike, filter: ConnectionHealthFilter) {
  if (filter === 'all') return true;

  const health = getConnectionHealth(connection);
  if (filter === 'attention') return health.value !== 'healthy';

  return health.value === filter;
}

export function filterConnections<T extends ConnectionLike>(
  connections: readonly T[],
  provider: ConnectionProviderFilter,
  health: ConnectionHealthFilter
) {
  return connections.filter(
    (connection) =>
      (provider === 'all' || connection.provider === provider) && matchesConnectionHealth(connection, health)
  );
}

export function normalizeConnectionProviderFilter(value: string | null) {
  return value && providerFilterValues.has(value as ConnectionProviderFilter)
    ? (value as ConnectionProviderFilter)
    : ('all' as const);
}

export function normalizeConnectionHealthFilter(value: string | null) {
  return value && healthFilterValues.has(value as ConnectionHealthFilter)
    ? (value as ConnectionHealthFilter)
    : ('all' as const);
}

export function buildConnectionsHref(
  workspaceId: string,
  currentSearchParams: Record<string, string | string[] | undefined>,
  overrides: Partial<Record<'provider' | 'health', string | null>>
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(currentSearchParams)) {
    const resolvedValue = Array.isArray(value) ? value[0] : value;
    if (typeof resolvedValue === 'string' && resolvedValue.length > 0) {
      params.set(key, resolvedValue);
    }
  }

  params.set('workspace', workspaceId);

  if ('provider' in overrides) {
    if (overrides.provider) params.set('provider', overrides.provider);
    else params.delete('provider');
  }

  if ('health' in overrides) {
    if (overrides.health) params.set('health', overrides.health);
    else params.delete('health');
  }

  return `/connections?${params.toString()}`;
}
