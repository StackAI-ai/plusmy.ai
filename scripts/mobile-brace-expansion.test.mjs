import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expo = require.resolve('expo/package.json', { paths: [resolve(root, 'apps/mobile')] });
const cli = require.resolve('@expo/cli/package.json', { paths: [dirname(expo)] });
const metro = require.resolve('@expo/metro-config/package.json', { paths: [dirname(cli)] });
const glob = require.resolve('glob/package.json', { paths: [dirname(cli)] });
const minimatch3 = require.resolve('minimatch', { paths: [dirname(metro)] });
const minimatch9 = require.resolve('minimatch', { paths: [dirname(glob)] });
const brace1 = require.resolve('brace-expansion', { paths: [dirname(minimatch3)] });
const brace2 = require.resolve('brace-expansion', { paths: [dirname(minimatch9)] });

test('Expo tooling resolves both patched brace-expansion major versions', () => {
  assert.equal(require(require.resolve('brace-expansion/package.json', { paths: [dirname(minimatch3)] })).version, '1.1.21');
  assert.equal(require(require.resolve('brace-expansion/package.json', { paths: [dirname(minimatch9)] })).version, '2.1.7');
});

test('both minimatch versions retain ordinary brace-glob behavior', () => {
  const match3 = require(minimatch3);
  const { minimatch: match9 } = require(minimatch9);
  for (const match of [match3, match9]) {
    assert.equal(match('src/a1.ts', 'src/{a,b}{1..2}.ts'), true);
    assert.equal(match('src/b2.ts', 'src/{a,b}{1..2}.ts'), true);
    assert.equal(match('src/c3.ts', 'src/{a,b}{1..2}.ts'), false);
  }
});

test('zero-step and repeated empty braces return without hanging', () => {
  const source = `for (const path of ${JSON.stringify([brace1, brace2])}) {
    const expand = require(path);
    for (const input of ['{1..3..0}', '{}'.repeat(30)]) {
      if (!Array.isArray(expand(input))) process.exit(1);
    }
  }`;
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', source], {
    encoding: 'utf8', timeout: 3000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
