import { NextRequest, NextResponse } from 'next/server';
import { processDueConnectionJobs, scheduleConnectionJob } from '@plusmy/core';
import { getServerEnv } from '@plusmy/config';
import type { Json } from '@plusmy/contracts';

export const runtime = 'nodejs';

function toPayload(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {} as Record<string, Json>;
  }

  return value as Record<string, Json>;
}

export async function POST(request: NextRequest) {
  const workerSecret = request.headers.get('x-plusmy-worker-secret');
  if (workerSecret !== getServerEnv().WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const connectionId = typeof body.connectionId === 'string' ? body.connectionId : null;
  const jobType = typeof body.jobType === 'string' ? body.jobType : 'token_refresh';
  const limit = Number(body.limit ?? 5);

  if (connectionId) {
    await scheduleConnectionJob({
      connectionId,
      jobType,
      payload: toPayload(body.payload),
      runAfter: new Date().toISOString(),
      maxAttempts: Number(body.maxAttempts ?? (jobType === 'token_refresh' ? 5 : 4))
    });
  }

  const result = await processDueConnectionJobs({
    limit,
    workerId: typeof body.workerId === 'string' ? body.workerId : undefined
  });

  return NextResponse.json({ ok: true, ...result });
}
