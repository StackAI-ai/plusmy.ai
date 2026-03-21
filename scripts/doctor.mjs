#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const requiredEnvKeys = [
  'APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MCP_JWT_SECRET',
  'WORKER_SHARED_SECRET'
];

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return new Map();
  }

  const values = new Map();
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return values;
}

function check(label, passed, detail, failures, warnings, warning = false) {
  const prefix = warning ? 'WARN' : passed ? 'PASS' : 'FAIL';
  console.log(`${prefix.padEnd(4)} ${label} ${detail ? `- ${detail}` : ''}`.trim());

  if (!passed && !warning) failures.push(label);
  if (warning) warnings.push(label);
}

const failures = [];
const warnings = [];

const rootNodeModules = resolve(repoRoot, 'node_modules');
const webNodeModules = resolve(repoRoot, 'apps/web/node_modules');
check('Dependencies installed', existsSync(rootNodeModules) && existsSync(webNodeModules), 'root and apps/web node_modules present', failures, warnings);

const envExamplePath = resolve(repoRoot, '.env.example');
const envLocalPath = resolve(repoRoot, 'apps/web/.env.local');
const envExample = readEnvFile(envExamplePath);
const envLocal = readEnvFile(envLocalPath);

check('.env.example present', existsSync(envExamplePath), envExamplePath, failures, warnings);
check('apps/web/.env.local present', existsSync(envLocalPath), envLocalPath, failures, warnings);

const missingEnvKeys = requiredEnvKeys.filter((key) => !envLocal.get(key));
check('Required app env keys', missingEnvKeys.length === 0, missingEnvKeys.length ? `missing ${missingEnvKeys.join(', ')}` : 'all required keys configured', failures, warnings);

const placeholderKeys = requiredEnvKeys.filter((key) => {
  const value = envLocal.get(key) ?? '';
  return !value || value.includes('placeholder') || value.includes('YOUR_PROJECT') || value.includes('replace-with');
});
check(
  'Required env values look real',
  placeholderKeys.length === 0,
  placeholderKeys.length ? `placeholder-looking values for ${placeholderKeys.join(', ')}` : 'no obvious placeholders detected',
  failures,
  warnings,
  placeholderKeys.length > 0
);

const appUrl = envLocal.get('APP_URL');
check(
  'APP_URL prefers local dev port 3009',
  appUrl === 'http://localhost:3009',
  appUrl ? `current value ${appUrl}` : 'APP_URL not set',
  failures,
  warnings,
  appUrl !== 'http://localhost:3009'
);

const supabaseConfigPath = resolve(repoRoot, 'supabase/config.toml');
const migrationsPath = resolve(repoRoot, 'supabase/migrations');
const migrationFiles = existsSync(migrationsPath)
  ? readdirSync(migrationsPath).filter((file) => file.endsWith('.sql'))
  : [];
check('Supabase config present', existsSync(supabaseConfigPath), supabaseConfigPath, failures, warnings);
check(
  'Supabase migrations present',
  migrationFiles.length > 0,
  migrationFiles.length ? `${migrationFiles.length} migration files found` : 'no migration files found',
  failures,
  warnings
);

const bundledSupabaseCli = resolve(repoRoot, 'node_modules/supabase/bin/supabase');
const supabaseVersionCommand = existsSync(bundledSupabaseCli)
  ? spawnSync(bundledSupabaseCli, ['--version'], { cwd: repoRoot, encoding: 'utf8' })
  : spawnSync('supabase', ['--version'], { cwd: repoRoot, encoding: 'utf8' });
const supabaseVersion = supabaseVersionCommand.stdout.trim() || supabaseVersionCommand.stderr.trim();
check(
  'Supabase CLI available',
  supabaseVersionCommand.status === 0,
  supabaseVersion || 'unable to determine supabase version',
  failures,
  warnings
);

const devCommand = spawnSync('pnpm', ['--version'], { cwd: repoRoot, encoding: 'utf8' });
check('pnpm available', devCommand.status === 0, devCommand.stdout.trim() || devCommand.stderr.trim(), failures, warnings);

console.log('');
if (failures.length) {
  console.log(`Doctor found ${failures.length} blocking issue(s) and ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`Doctor passed with ${warnings.length} warning(s).`);
