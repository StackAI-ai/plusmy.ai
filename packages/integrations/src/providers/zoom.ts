import { Buffer } from 'node:buffer';
import { getServerEnv } from '@plusmy/config';
import type {
  ConnectionRecord,
  Json,
  McpResourceDefinition,
  McpToolDefinition,
  ProviderHealthSnapshot,
  ProviderTokenSet
} from '@plusmy/contracts';
import type {
  AuthorizationCodeInput,
  AuthorizationUrlInput,
  IntegrationDefinition,
  ProviderCallContext,
  ResolvedProviderAccount,
  SyncJobHandlerInput
} from '../types';
import { getMissingScopes } from '../scope-drift';

const oauth = {
  authorizationUrl: 'https://zoom.us/oauth/authorize',
  tokenUrl: 'https://zoom.us/oauth/token',
  defaultScopes: ['user:read', 'meeting:read', 'recording:read']
};

function getCredentials() {
  const env = getServerEnv();
  if (!env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) {
    throw new Error('Zoom OAuth credentials are missing.');
  }
  return { clientId: env.ZOOM_CLIENT_ID, clientSecret: env.ZOOM_CLIENT_SECRET };
}

function authHeader() {
  const { clientId, clientSecret } = getCredentials();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseScopes(value: unknown, fallback: string[]) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }
  return value
    .split(/[ ,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function parseZoomError(data: unknown, fallback: string) {
  const record = getRecord(data);
  const message = record?.message ?? record?.error_description ?? record?.reason ?? record?.error;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

function zoomHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function exchangeToken(body: URLSearchParams) {
  const response = await fetch(oauth.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(parseZoomError(data, 'Zoom token exchange failed.'));
  }

  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    tokenType: String(data.token_type ?? 'Bearer'),
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes: parseScopes(data.scope, oauth.defaultScopes),
    raw: data as Json
  } satisfies ProviderTokenSet;
}

async function resolveAccount(accessToken: string): Promise<ResolvedProviderAccount> {
  const response = await fetch('https://api.zoom.us/v2/users/me', { headers: zoomHeaders(accessToken) });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(parseZoomError(data, 'Zoom account resolve failed.'));
  }

  const record = getRecord(data);
  const accountId = typeof record?.id === 'string' ? record.id : 'zoom-user';
  const displayName =
    typeof record?.display_name === 'string'
      ? record.display_name
      : typeof record?.first_name === 'string'
        ? `${record.first_name}${typeof record?.last_name === 'string' ? ` ${record.last_name}` : ''}`.trim()
        : 'Zoom account';
  const email = typeof record?.email === 'string' ? record.email : null;

  return {
    externalAccountId: accountId,
    displayName,
    externalAccountEmail: email,
    metadata: record ?? {}
  };
}

async function listMeetings(accessToken: string, type: string, pageSize: number) {
  const url = new URL('https://api.zoom.us/v2/users/me/meetings');
  url.searchParams.set('type', type);
  url.searchParams.set('page_size', String(pageSize));
  const response = await fetch(url, { headers: zoomHeaders(accessToken) });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(parseZoomError(data, 'Zoom meeting list failed.'));
  }
  return Array.isArray(getRecord(data)?.meetings) ? ((getRecord(data)?.meetings as unknown[]) as Json[]) : [];
}

async function syncConnection({ credentials }: SyncJobHandlerInput) {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error('Missing Zoom access token.');

  const account = await resolveAccount(accessToken);
  const meetings = await listMeetings(accessToken, 'scheduled', 10);
  return {
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    externalAccountEmail: account.externalAccountEmail ?? null,
    metadata: {
      ...account.metadata,
      meetingsPreview: meetings.slice(0, 10)
    } as Record<string, Json>
  };
}

const tools: McpToolDefinition[] = [
  {
    name: 'zoom.search_meetings',
    title: 'Search Zoom meetings',
    description: 'Find meetings by topic for customer, project, or internal follow-up.',
    requiredProviderScopes: ['meeting:read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: { type: 'string', default: 'scheduled' },
        limit: { type: 'number', default: 25 }
      }
    }
  },
  {
    name: 'zoom.list_recordings',
    title: 'List Zoom recordings',
    description: 'List recent Zoom recordings and transcript-capable files.',
    requiredProviderScopes: ['recording:read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number', default: 25 }
      }
    }
  },
  {
    name: 'zoom.read_transcript',
    title: 'Read Zoom transcript',
    description: 'Read the transcript file for a recorded Zoom meeting when one is available.',
    requiredProviderScopes: ['recording:read'],
    inputSchema: {
      type: 'object',
      properties: {
        meetingId: { type: 'string' }
      },
      required: ['meetingId']
    }
  }
];

const liveScopes = oauth.defaultScopes.slice();

function buildHealthSnapshot(connection: ConnectionRecord): ProviderHealthSnapshot {
  if (connection.status === 'revoked') {
    return {
      provider: 'zoom',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'revoked',
      summary: 'This Zoom connection has been revoked.',
      signals: [connection.reauth_required_reason ?? 'Reconnect Zoom before meeting and transcript workflows resume.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  if (connection.status === 'reauth_required') {
    return {
      provider: 'zoom',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'reauth_required',
      summary: 'Zoom needs reauthorization.',
      signals: [connection.reauth_required_reason ?? 'Zoom flagged this install for reauthorization.'],
      requiredScopes: liveScopes,
      missingScopes: [],
      lastValidatedAt: connection.last_validated_at
    };
  }

  const missingScopes = getMissingScopes(liveScopes, connection.granted_scopes);
  if (missingScopes.length > 0) {
    return {
      provider: 'zoom',
      connectionId: connection.id,
      displayName: connection.display_name,
      status: 'attention',
      summary: 'Zoom is missing one or more required scopes.',
      signals: [`Missing scopes: ${missingScopes.join(', ')}`, 'Reconnect Zoom to restore meeting metadata and transcript workflows.'],
      requiredScopes: liveScopes,
      missingScopes,
      lastValidatedAt: connection.last_validated_at
    };
  }

  return {
    provider: 'zoom',
    connectionId: connection.id,
    displayName: connection.display_name,
    status: 'healthy',
    summary: 'Zoom meeting and recording workflows are healthy.',
    signals: ['OAuth grant active', 'Meeting and recording scopes present'],
    requiredScopes: liveScopes,
    missingScopes: [],
    lastValidatedAt: connection.last_validated_at
  };
}

export const zoomIntegration: IntegrationDefinition = {
  id: 'zoom',
  displayName: 'Zoom',
  oauth,
  buildAuthorizationUrl({ redirectUri, state, scopes }: AuthorizationUrlInput) {
    const { clientId } = getCredentials();
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }: AuthorizationCodeInput) {
    return exchangeToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    );
  },
  refreshTokens({ refreshToken }) {
    return exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    );
  },
  resolveAccount(tokenSet: ProviderTokenSet) {
    return resolveAccount(String(tokenSet.accessToken ?? ''));
  },
  listTools(_connection: ConnectionRecord) {
    return tools;
  },
  listResources(_connection: ConnectionRecord): McpResourceDefinition[] {
    return [];
  },
  health(connection: ConnectionRecord) {
    return buildHealthSnapshot(connection);
  },
  syncJobs: [{ jobType: 'sync_connection', run: syncConnection }],
  async callTool(toolName: string, input: Record<string, unknown>, context: ProviderCallContext) {
    const accessToken = context.credentials.accessToken;
    if (!accessToken) throw new Error('Missing Zoom access token.');

    if (toolName === 'zoom.search_meetings') {
      const query = String(input.query ?? '').trim().toLowerCase();
      const type = String(input.type ?? 'scheduled').trim() || 'scheduled';
      const limit = Number(input.limit ?? 25);
      const meetings = await listMeetings(accessToken, type, Number.isFinite(limit) ? limit : 25);
      const filtered = query.length > 0
        ? meetings.filter((entry) => String(getRecord(entry)?.topic ?? '').toLowerCase().includes(query))
        : meetings;
      return {
        query: query || null,
        type,
        totalFound: filtered.length,
        meetings: filtered.slice(0, Number.isFinite(limit) ? limit : 25)
      };
    }

    if (toolName === 'zoom.list_recordings') {
      const query = String(input.query ?? '').trim().toLowerCase();
      const limit = Number(input.limit ?? 25);
      const to = typeof input.to === 'string' && input.to.trim().length > 0 ? input.to.trim() : formatDate(new Date());
      const from =
        typeof input.from === 'string' && input.from.trim().length > 0
          ? input.from.trim()
          : formatDate(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30));

      const url = new URL('https://api.zoom.us/v2/users/me/recordings');
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      url.searchParams.set('page_size', String(Number.isFinite(limit) ? limit : 25));

      const response = await fetch(url, { headers: zoomHeaders(accessToken) });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseZoomError(data, 'Zoom recording list failed.'));
      }

      const meetings = Array.isArray(getRecord(data)?.meetings) ? (getRecord(data)?.meetings as unknown[]) : [];
      const filtered = query.length > 0
        ? meetings.filter((entry) => String(getRecord(entry)?.topic ?? '').toLowerCase().includes(query))
        : meetings;
      return {
        query: query || null,
        from,
        to,
        totalFound: filtered.length,
        meetings: (filtered.slice(0, Number.isFinite(limit) ? limit : 25) as Json[])
      };
    }

    if (toolName === 'zoom.read_transcript') {
      const meetingId = String(input.meetingId ?? '').trim();
      if (!meetingId) throw new Error('meetingId is required.');

      const recordingsResponse = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/recordings`, {
        headers: zoomHeaders(accessToken)
      });
      const recordingsData = await recordingsResponse.json();
      if (!recordingsResponse.ok) {
        throw new Error(parseZoomError(recordingsData, 'Zoom meeting recording lookup failed.'));
      }

      const recordingFiles = Array.isArray(getRecord(recordingsData)?.recording_files)
        ? (getRecord(recordingsData)?.recording_files as unknown[])
        : [];
      const transcriptFile = recordingFiles.find((entry) => {
        const file = getRecord(entry);
        const fileType = String(file?.file_type ?? '').toUpperCase();
        const extension = String(file?.file_extension ?? '').toUpperCase();
        return fileType.includes('TRANSCRIPT') || extension === 'VTT';
      });
      const transcriptRecord = getRecord(transcriptFile);
      const downloadUrl = typeof transcriptRecord?.download_url === 'string' ? transcriptRecord.download_url : '';
      if (!downloadUrl) {
        throw new Error('No transcript file is available for this Zoom meeting.');
      }

      const transcriptResponse = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'text/plain'
        }
      });
      const transcriptText = await transcriptResponse.text();
      if (!transcriptResponse.ok) {
        throw new Error(transcriptText || 'Zoom transcript download failed.');
      }

      return {
        meetingId,
        topic: getRecord(recordingsData)?.topic ?? null,
        transcriptFile: transcriptRecord ?? null,
        transcript: transcriptText
      };
    }

    throw new Error(`Unknown Zoom tool: ${toolName}`);
  }
};
