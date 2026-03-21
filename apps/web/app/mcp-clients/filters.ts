import type { OAuthClientApprovalRecord } from '@plusmy/contracts';
import type { ConnectionRecord } from '@plusmy/contracts';

export type ApprovalHealthFilter = 'all' | 'active' | 'stale' | 'awaiting_exchange' | 'scope_drift' | 'revoked' | 'degraded';

export type ProviderScopeDriftSummary = {
  provider: ConnectionRecord['provider'];
  providerLabel: string;
  connectionId: string;
  missingScopes: string[];
  affectedTools: string[];
};

export const approvalHealthFilters = [
  { value: 'all', label: 'All approvals' },
  { value: 'active', label: 'Active' },
  { value: 'awaiting_exchange', label: 'Awaiting exchange' },
  { value: 'stale', label: 'Stale' },
  { value: 'scope_drift', label: 'Scope drift' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'degraded', label: 'Degraded' }
] as const satisfies readonly { value: ApprovalHealthFilter; label: string }[];

const approvalFilterValues = new Set<ApprovalHealthFilter>(approvalHealthFilters.map((filter) => filter.value));

export function isRecent(isoTimestamp: string | null | undefined, windowDays: number) {
  if (!isoTimestamp) return false;
  return Date.now() - new Date(isoTimestamp).getTime() <= windowDays * 24 * 60 * 60 * 1000;
}

export function isApprovalAwaitingTokenExchange(approval: OAuthClientApprovalRecord) {
  if (approval.status !== 'active' || !isRecent(approval.approved_at, 3)) {
    return false;
  }

  if (!approval.last_used_at) {
    return true;
  }

  return new Date(approval.last_used_at).getTime() < new Date(approval.approved_at).getTime();
}

export function isStaleApproval(approval: OAuthClientApprovalRecord) {
  return approval.status === 'active' && !isRecent(approval.last_used_at, 14) && !isApprovalAwaitingTokenExchange(approval);
}

export function getApprovalHealthReasons(
  approval: OAuthClientApprovalRecord,
  providerScopeDriftSummaries: ProviderScopeDriftSummary[]
) {
  if (approval.status === 'revoked') {
    const revokedByUserId = getApprovalMetadataString(approval, 'revoked_by_user_id');
    const label = revokedByUserId && revokedByUserId !== approval.user_id ? 'Revoked by operator' : 'Revoked';
    const detail =
      getApprovalMetadataString(approval, 'revocation_reason') ??
      (approval.revoked_at ? `Revoked at ${approval.revoked_at}.` : 'This approval has already been revoked.');

    return [{ key: 'revoked', tone: 'brass' as const, label, detail }];
  }

  if (isApprovalAwaitingTokenExchange(approval)) {
    return [{
      key: 'awaiting_token_exchange',
      tone: 'default' as const,
      label: 'Awaiting token exchange',
      detail: 'Recently approved or reauthorized. The client still needs to exchange a fresh code before token activity updates.'
    }];
  }

  if (providerScopeDriftSummaries.length > 0) {
    const detail = providerScopeDriftSummaries
      .map(
        (entry) =>
          `${entry.providerLabel} is missing ${entry.missingScopes.join(', ')} for ${entry.affectedTools.join(', ')}.`
      )
      .join(' ');

    return [{
      key: 'scope_drift',
      tone: 'brass' as const,
      label: 'Scope drift',
      detail
    }];
  }

  if (isStaleApproval(approval)) {
    return [{
      key: 'stale',
      tone: 'brass' as const,
      label: 'Stale approval',
      detail: 'No token usage recorded in the last 14 days.'
    }];
  }

  if (isRecent(approval.last_used_at, 7)) {
    return [{
      key: 'recently_used',
      tone: 'moss' as const,
      label: 'Recently used',
      detail: 'Token usage was recorded during the last 7 days.'
    }];
  }

  return [{
    key: 'active',
    tone: 'moss' as const,
    label: 'Active',
    detail: 'This approval can still mint or refresh MCP access tokens.'
  }];
}

export function getApprovalHealthFilter(approval: OAuthClientApprovalRecord, providerScopeDriftSummaries: ProviderScopeDriftSummary[]) {
  const reason = getApprovalHealthReasons(approval, providerScopeDriftSummaries)[0];
  switch (reason.key) {
    case 'revoked':
      return 'revoked' as const;
    case 'awaiting_token_exchange':
      return 'awaiting_exchange' as const;
    case 'scope_drift':
      return 'scope_drift' as const;
    case 'stale':
      return 'stale' as const;
    case 'active':
      return 'active' as const;
    default:
      return 'degraded' as const;
  }
}

export function matchesApprovalHealth(
  approval: OAuthClientApprovalRecord,
  filter: ApprovalHealthFilter,
  providerScopeDriftSummaries: ProviderScopeDriftSummary[]
) {
  if (filter === 'all') return true;
  if (filter === 'degraded') {
    return getApprovalHealthFilter(approval, providerScopeDriftSummaries) !== 'active';
  }
  return getApprovalHealthFilter(approval, providerScopeDriftSummaries) === filter;
}

export function filterApprovals(
  approvals: readonly OAuthClientApprovalRecord[],
  filter: ApprovalHealthFilter,
  providerScopeDriftSummaries: ProviderScopeDriftSummary[]
) {
  return approvals.filter((approval) => matchesApprovalHealth(approval, filter, providerScopeDriftSummaries));
}

export function normalizeApprovalHealthFilter(value: string | null) {
  return value && approvalFilterValues.has(value as ApprovalHealthFilter) ? (value as ApprovalHealthFilter) : 'all';
}

export function getApprovalActorLabel(
  approval: OAuthClientApprovalRecord,
  currentUserId: string,
  memberDisplayNames: Map<string, string | null>
) {
  if (approval.user_id === currentUserId) {
    return 'Approved by you';
  }

  const displayName = memberDisplayNames.get(approval.user_id);
  if (displayName) {
    return `Approved by ${displayName}`;
  }

  return `Approved by ${approval.user_id}`;
}

export function buildMcpClientsHref(
  workspaceId: string,
  currentSearchParams: Record<string, string | string[] | undefined>,
  overrides: Partial<Record<'approval_health', string | null>>
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(currentSearchParams)) {
    const resolvedValue = Array.isArray(value) ? value[0] : value;
    if (typeof resolvedValue === 'string' && resolvedValue.length > 0) {
      params.set(key, resolvedValue);
    }
  }

  params.set('workspace', workspaceId);

  if ('approval_health' in overrides) {
    if (overrides.approval_health) params.set('approval_health', overrides.approval_health);
    else params.delete('approval_health');
  }

  return `/mcp-clients?${params.toString()}`;
}

function getApprovalMetadataString(approval: OAuthClientApprovalRecord, key: string) {
  const metadata = approval.metadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;

  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}
