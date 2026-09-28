import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { safeAppRedirectUrl } from '../../_lib/safe-redirect';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next') ?? '/dashboard';
  const supabase = await createServerSupabaseClient();

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL('/login?error=callback_failed', url.origin));
    return NextResponse.redirect(safeAppRedirectUrl(next, url.origin, '/dashboard'));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as any
    });
    if (error) return NextResponse.redirect(new URL('/login?error=callback_failed', url.origin));
    return NextResponse.redirect(safeAppRedirectUrl(next, url.origin, '/dashboard'));
  }

  return NextResponse.redirect(new URL('/login?error=callback_failed', url.origin));
}
