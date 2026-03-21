import { NextRequest, NextResponse } from 'next/server';
import { forceRefreshConnection } from '@plusmy/core';
import { getServerEnv } from '@plusmy/config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const workerSecret = request.headers.get('x-plusmy-worker-secret');
  if (workerSecret !== getServerEnv().WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const connectionId = String(body.connectionId ?? '');
  if (!connectionId) {
    return NextResponse.json({ error: 'connection_id_required' }, { status: 400 });
  }

  await forceRefreshConnection(connectionId);
  return NextResponse.json({ ok: true, connectionId });
}
