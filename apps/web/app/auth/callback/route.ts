import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@plusmy/supabase';
import { safeAppRedirectUrl } from '../../_lib/safe-redirect';
import { buildLoginHref, safeSignInReturnPath } from '../../_lib/signin-return';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next') ?? '/dashboard';
  const failedLogin = new URL(buildLoginHref(safeSignInReturnPath(next)), url.origin);
  failedLogin.searchParams.set('error', 'callback_failed');
  const supabase = await createServerSupabaseClient();

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(failedLogin);
    return NextResponse.redirect(safeAppRedirectUrl(next, url.origin, '/dashboard'));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as any
    });
    if (error) return NextResponse.redirect(failedLogin);
    return NextResponse.redirect(safeAppRedirectUrl(next, url.origin, '/dashboard'));
  }

  return NextResponse.redirect(failedLogin);
}
