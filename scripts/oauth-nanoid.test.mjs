import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corePath = resolve(repoRoot, 'packages/core');
const packagePath = require.resolve('nanoid/package.json', { paths: [corePath] });
const securePath = require.resolve('nanoid', { paths: [corePath] });
const nonSecurePath = require.resolve('nanoid/non-secure', { paths: [corePath] });
const { nanoid } = await import(pathToFileURL(securePath).href);
const nextPackage = require.resolve('next/package.json', { paths: [resolve(repoRoot, 'apps/web')] });
const webPostcss = require.resolve('postcss/package.json', { paths: [dirname(nextPackage)] });
const expoPackage = require.resolve('expo/package.json', { paths: [resolve(repoRoot, 'apps/mobile')] });
const expoCli = require.resolve('@expo/cli/package.json', { paths: [dirname(expoPackage)] });
const expoMetro = require.resolve('@expo/metro-config/package.json', { paths: [dirname(expoCli)] });
const mobilePostcss = require.resolve('postcss/package.json', { paths: [dirname(expoMetro)] });
const nanoid3Package = require.resolve('nanoid/package.json', { paths: [dirname(webPostcss)] });
const nanoid3NonSecure = require.resolve('nanoid/non-secure', { paths: [dirname(webPostcss)] });

test('OAuth core resolves the patched nanoid major version', () => {
  assert.equal(require(packagePath).version, '5.1.16');
});

test('web and mobile PostCSS resolve the patched nanoid 3 version', () => {
  assert.equal(require(nanoid3Package).version, '3.3.20');
  const mobileNanoid = require.resolve('nanoid/package.json', { paths: [dirname(mobilePostcss)] });
  assert.equal(require(mobileNanoid).version, '3.3.20');
});

test('the secure generator preserves OAuth identifier lengths and URL-safe format', () => {
  for (const length of [24, 48, 64]) {
    const value = nanoid(length);
    assert.equal(value.length, length);
    assert.match(value, /^[A-Za-z0-9_-]+$/);
  }
});

test('non-secure generator edge inputs return without hanging', () => {
  const source = `import { createRequire } from 'node:module';
    import * as current from ${JSON.stringify(pathToFileURL(nonSecurePath).href)};
    const previous = createRequire(import.meta.url)(${JSON.stringify(nanoid3NonSecure)});
    for (const { nanoid, customAlphabet } of [current, previous]) {
      if (nanoid(-1) !== '' || customAlphabet('abc', 0)() !== '' || customAlphabet('abc', -1)() !== '') process.exit(1);
    }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 2000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
