import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reactNative = require.resolve('react-native/package.json', { paths: [resolve(repoRoot, 'apps/mobile')] });
const devtools = require.resolve('react-devtools-core/package.json', { paths: [dirname(reactNative)] });
const devtoolsRequire = createRequire(devtools);
const shellQuote = devtoolsRequire('shell-quote');
const shellQuoteVersion = devtoolsRequire('shell-quote/package.json').version;

test('mobile devtools resolves the patched shell-quote version', () => {
  assert.equal(shellQuoteVersion, '1.12.0');
});

test('shell-quote rejects operator and post-comment line terminator injection', () => {
  assert.throws(() => shellQuote.quote([{ op: ';\nid' }]), TypeError);
  assert.throws(() => shellQuote.quote([{ comment: 'safe' }, 'word\nid']), TypeError);
});

test('shell-quote preserves ordinary quoting and parsing', () => {
  assert.equal(shellQuote.quote(['hello world']), "'hello world'");
  assert.deepEqual(shellQuote.parse('hello "world today"'), ['hello', 'world today']);
  assert.equal(shellQuote.parse('word '.repeat(4096).trim()).length, 4096);
});
