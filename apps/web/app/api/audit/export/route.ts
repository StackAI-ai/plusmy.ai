import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@plusmy/supabase';
import {
  getAuthorizedWorkspace,
  listAuditLogsForExport,
  listToolInvocationsForExport,
  listUserWorkspaces
} from '@plusmy/core';
import { parseSearchParams, validationErrorResponse } from '../../_lib/validation';

export const runtime = 'nodejs';

const exportQuerySchema = z.object({
  workspace_id: z.string().uuid(),
  type: z.enum(['audit', 'invocations']).optional(),
  format: z.enum(['csv', 'json']).optional(),
  limit: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional(),
  actor: z.enum(['user', 'mcp_client', 'system']).optional(),
  actor_type: z.enum(['user', 'mcp_client', 'system']).optional(),
  actor_user_id: z.string().uuid().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  action_prefix: z.string().optional(),
  client_id: z.string().optional(),
  provider: z.string().optional(),
  tool: z.string().optional(),
  tool_name: z.string().optional(),
  connection_id: z.string().uuid().optional()
});

function canManageWorkspace(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function normalizeLimit(value: string | null | undefined) {
  const parsed = Number(value ?? 5000);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.min(Math.max(Math.trunc(parsed), 1), 10000);
}

function normalizeDate(value: string | null | undefined, label: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function sanitizeCsvValue(value: string) {
  if (/^[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsv(value: unknown) {
  if (value == null) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const sanitized = sanitizeCsvValue(raw);
  if (/[",\n\r]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

function buildCsv<T extends object>(rows: T[], columns: Array<{ key: keyof T; label: string }>) {
  const header = columns.map((column) => escapeCsv(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsv(row[column.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let query: z.infer<typeof exportQuerySchema>;
  try {
    query = parseSearchParams(request.url, exportQuerySchema);
  } catch (error) {
    return validationErrorResponse(error);
  }

  const workspace = await getAuthorizedWorkspace(user.id, query.workspace_id);
  if (!workspace) {
    return NextResponse.json({ error: 'workspace_required' }, { status: 404 });
  }

  const workspaces = await listUserWorkspaces(user.id);
  const membership = workspaces.find((entry) => entry.id === workspace.id);
  if (!canManageWorkspace(membership?.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let from: string | null = null;
  let to: string | null = null;
  try {
    from = normalizeDate(query.from ?? null, 'from');
    to = normalizeDate(query.to ?? null, 'to');
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid date range.' },
      { status: 400 }
    );
  }

  const exportType = query.type ?? 'audit';
  const limit = normalizeLimit(query.limit);
  const order = query.order ?? 'desc';
  const format = query.format ?? 'csv';

  if (exportType === 'audit') {
    const rows = await listAuditLogsForExport(workspace.id, {
      limit,
      status: query.status ?? null,
      actorType: (query.actor ?? query.actor_type ?? null) as 'user' | 'mcp_client' | 'system' | null,
      resourceType: query.resource_type ?? null,
      resourceId: query.resource_id ?? null,
      actionPrefix: query.action_prefix ?? null,
      clientId: query.client_id ?? null,
      from,
      to,
      order
    });

    if (format === 'json') {
      return NextResponse.json({ workspace, rows });
    }

    const csv = buildCsv(rows, [
      { key: 'id', label: 'id' },
      { key: 'created_at', label: 'created_at' },
      { key: 'actor_type', label: 'actor_type' },
      { key: 'actor_user_id', label: 'actor_user_id' },
      { key: 'actor_client_id', label: 'actor_client_id' },
      { key: 'action', label: 'action' },
      { key: 'resource_type', label: 'resource_type' },
      { key: 'resource_id', label: 'resource_id' },
      { key: 'status', label: 'status' },
      { key: 'ip', label: 'ip' },
      { key: 'user_agent', label: 'user_agent' },
      { key: 'request_id', label: 'request_id' },
      { key: 'metadata', label: 'metadata' }
    ]);

    const filename = `plusmy-audit-${workspace.slug ?? workspace.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`
      }
    });
  }

  const rows = await listToolInvocationsForExport(workspace.id, {
    limit,
    status: query.status ?? null,
    provider: query.provider ?? null,
    toolName: query.tool_name ?? query.tool ?? null,
    actorClientId: query.client_id ?? null,
    actorUserId: query.actor_user_id ?? null,
    connectionId: query.connection_id ?? null,
    from,
    to,
    order
  });

  if (format === 'json') {
    return NextResponse.json({ workspace, rows });
  }

  const csv = buildCsv(rows, [
    { key: 'id', label: 'id' },
    { key: 'created_at', label: 'created_at' },
    { key: 'provider', label: 'provider' },
    { key: 'tool_name', label: 'tool_name' },
    { key: 'status', label: 'status' },
    { key: 'latency_ms', label: 'latency_ms' },
    { key: 'actor_user_id', label: 'actor_user_id' },
    { key: 'actor_client_id', label: 'actor_client_id' },
    { key: 'connection_id', label: 'connection_id' },
    { key: 'input', label: 'input' },
    { key: 'output', label: 'output' },
    { key: 'error_message', label: 'error_message' }
  ]);

  const filename = `plusmy-invocations-${workspace.slug ?? workspace.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`
    }
  });
}
