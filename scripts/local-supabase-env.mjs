#!/usr/bin/env node

import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseStatus(raw) {
  const values = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
  }
  for (const name of ['API_URL', 'JWT_SECRET', 'MAILPIT_URL']) {
    if (!values[name]) throw new Error(`Local Supabase status is missing ${name}.`);
  }
  return values;
}

function signRoleToken(role, secret) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'supabase', role, iat: now, exp: now + 7200 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const cli = resolve('node_modules/supabase/bin/supabase');
const status = parseStatus(execFileSync(cli, ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const env = {
  ...process.env,
  APP_URL: 'http://localhost:3009',
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: signRoleToken('anon', status.JWT_SECRET),
  SUPABASE_SERVICE_ROLE_KEY: signRoleToken('service_role', status.JWT_SECRET)
};

if (process.argv[2] === '--write-env') {
  const path = resolve('apps/web/.env.local');
  const contents = [
    'APP_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ].map((name) => `${name}=${env[name]}`);
  contents.push(`MCP_JWT_SECRET=${randomBytes(32).toString('hex')}`);
  contents.push(`WORKER_SHARED_SECRET=${randomBytes(32).toString('hex')}`);
  contents.push(`E2E_MAILPIT_URL=${status.MAILPIT_URL}`);
  writeFileSync(path, `${contents.join('\n')}\n`, { mode: 0o600 });
} else if (process.argv[2] === '--' && process.argv.length > 3) {
  const child = spawn(process.argv[3], process.argv.slice(4), { env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    process.exitCode = signal ? 130 : (code ?? 1);
  });
} else {
  throw new Error('Usage: local-supabase-env.mjs --write-env | -- <command> [args...]');
}
