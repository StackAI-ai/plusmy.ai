import assert from 'node:assert/strict';
import test from 'node:test';
import { safeAppRedirectPath, safeAppRedirectUrl } from '../app/_lib/safe-redirect';

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
