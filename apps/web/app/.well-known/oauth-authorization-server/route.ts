import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizationServerMetadata } from '@plusmy/core';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;
  return NextResponse.json(buildAuthorizationServerMetadata(baseUrl));
}
