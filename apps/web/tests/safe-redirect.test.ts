import assert from 'node:assert/strict';
import test from 'node:test';
import { safeAppRedirectPath, safeAppRedirectUrl } from '../app/_lib/safe-redirect';
import { buildLoginHref, buildSignInCallbackUrl, safeSignInReturnPath } from '../app/_lib/signin-return';

test('keeps local return paths and query parameters', () => {
  assert.equal(safeAppRedirectPath('/connections?workspace=abc', '/dashboard'), '/connections?workspace=abc');
  assert.equal(
    safeAppRedirectUrl('/connections?workspace=abc', 'https://plusmy.ai', '/dashboard').href,
    'https://plusmy.ai/connections?workspace=abc'
  );
});

test('rejects external and ambiguous return targets', () => {
  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', '/foo\nbar', 'dashboard', '']) {
    assert.equal(safeAppRedirectPath(target, '/dashboard'), '/dashboard');
    assert.equal(safeAppRedirectUrl(target, 'https://plusmy.ai', '/dashboard').href, 'https://plusmy.ai/dashboard');
  }
});

test('sign-in return keeps only an allowed operator path and UUID workspace', () => {
  const workspace = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const next = `/connections?workspace=${workspace}`;
  assert.equal(safeSignInReturnPath(`${next}&token=secret#private`), next);
  assert.equal(safeSignInReturnPath('/connections?workspace=secret'), '/connections');
  assert.equal(safeSignInReturnPath('/mcp-setup/quickstart'), '/mcp-setup/quickstart');
  assert.equal(new URL(buildLoginHref('/connections', workspace), 'https://plusmy.ai').searchParams.get('next'), next);
  assert.equal(new URL(buildSignInCallbackUrl('https://plusmy.ai', next)).searchParams.get('next'), next);
  assert.equal(buildSignInCallbackUrl('https://plusmy.ai', '/dashboard'), 'https://plusmy.ai/auth/callback');
});

test('sign-in return never forwards invitation tokens or unsafe destinations', () => {
  for (const target of [
    '/join?token=invite-secret', '/authorize?client_secret=secret', '/login',
    'https://evil.example', '//evil.example', '/\\evil.example', '/connections\n?token=secret',
    '/connections/' + 'x'.repeat(2048), '', null, undefined
  ]) {
    assert.equal(safeSignInReturnPath(target), '/dashboard');
    assert.equal(buildSignInCallbackUrl('https://plusmy.ai', target), 'https://plusmy.ai/auth/callback');
  }
  const callback = buildSignInCallbackUrl('https://plusmy.ai', '/connections?token=invite-secret');
  assert.equal(new URL(callback).searchParams.get('next'), '/connections');
  assert.ok(!callback.includes('invite-secret'));
});
