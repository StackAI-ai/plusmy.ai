import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// No DATABASE_URL or existing server is accepted. This owns a Unix-socket-only,
// disposable PG17 cluster. Vault is a transactional fixture, NOT Supabase Vault.
const bin = process.env.PLUSMY_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const migration = (name: string) => readFileSync(resolve('supabase/migrations', name), 'utf8');

test('job fences on disposable PostgreSQL, including real row-lock interleavings', { timeout: 60_000 }, async (t) => {
  assert.ok(existsSync(join(bin, 'initdb')), 'Set PLUSMY_TEST_PG_BIN to a PostgreSQL 17 bin directory');
  assert.match(execFileSync(join(bin, 'postgres'), ['--version'], { encoding: 'utf8' }), /PostgreSQL\) 17\./);
  const directory = mkdtempSync(join(tmpdir(), 'plusmy-claims-'));
  const data = join(directory, 'data');
  // Inherited PGSERVICE/PGHOSTADDR must never redirect this fixture to another DB.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
    PGAPPNAME: 'plusmy-job-fence-tests', PGOPTIONS: '-c statement_timeout=10000' };
  const args = ['-X', '-qAt', '-h', directory, '-p', '55497', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  function sql(query: string) {
    return execFileSync(join(bin, 'psql'), [...args, '-c', query], { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  }
  function asyncSql(query: string) {
    return new Promise<string>((accept, reject) => {
      const child = spawn(join(bin, 'psql'), [...args, '-c', query], { env });
      let output = ''; let error = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { error += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? accept(output.trim()) : reject(new Error(error)));
    });
  }
  async function session() {
    const child = spawn(join(bin, 'psql'), args, { env });
    let output = ''; let error = ''; let sequence = 0;
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    return {
      async run(query: string) {
        const marker = `marker_${sequence++}`;
        child.stdin.write(`${query};\n\\echo ${marker}\n`);
        for (let i = 0; i < 500; i++) {
          if (output.includes(marker)) { output = ''; return; }
          if (child.exitCode !== null) throw new Error(error);
          await new Promise((done) => setTimeout(done, 10));
        }
        throw new Error(`Session barrier timed out: ${error}`);
      },
      close() { child.stdin.end('rollback;\n\\q\n'); }
    };
  }
  let started = false;
  try {
    execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale'], { stdio: 'pipe', env });
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-o',
      `-F -k ${directory} -p 55497 -c listen_addresses='' -c max_connections=10`, '-w', 'start'], { stdio: 'pipe', env });
    started = true;
    const initial = migration('20260321090000_initial_schema.sql');
    const tables = initial.slice(initial.indexOf('create table if not exists app.connections ('), initial.indexOf('create table if not exists app.context_assets ('));
    sql(`create role anon; create role authenticated; create role service_role;
      create schema app; create schema auth; create schema vault;
      create type app.connection_scope as enum ('workspace', 'personal');
      create type app.connection_status as enum ('pending', 'active', 'reauth_required', 'revoked');
      create table app.workspaces(id uuid primary key, name text, slug text);
      create table auth.users(id uuid primary key);
      create table app.providers(id text primary key, display_name text);
      ${tables}
      create table vault.test_secrets(id uuid primary key default gen_random_uuid(), value text);
      create function app.put_secret(p_value text, p_id uuid, p_name text, p_description text) returns uuid language plpgsql as $$
      declare v_id uuid := coalesce(p_id, gen_random_uuid()); begin
        insert into vault.test_secrets values (v_id, p_value) on conflict (id) do update set value = excluded.value;
        return v_id; end; $$;
      create function app.resolve_secret(p_secret_id uuid) returns text language sql as $$ select value from vault.test_secrets where id = p_secret_id $$;
      ${migration('20260321143000_connection_job_workers.sql')}
      ${migration('20260321183000_connection_job_dead_letter.sql')}
      ${migration('20260321202000_connection_job_stale_recovery.sql')}
      drop function app.claim_connection_sync_jobs(text, integer);
      ${migration('20260928050000_connection_job_alert_delivery.sql')}
      ${migration('20260928060000_scrub_connection_metadata.sql')}
      ${migration('20260928070000_fence_connection_refresh.sql')}`);

    // Exercise an upgrade with both legacy queued and processing jobs present.
    sql(`insert into app.workspaces values ('ad000000-0000-0000-0000-000000000001','Upgrade','upgrade');
      insert into app.providers values ('upgrade','Upgrade');
      insert into app.connections (id,connection_key,workspace_id,provider,status,display_name) values
      ('ad000000-0000-0000-0000-000000000002','upgrade','ad000000-0000-0000-0000-000000000001','upgrade','active','Upgrade');
      insert into app.connection_sync_jobs (connection_id,job_type,status) values
      ('ad000000-0000-0000-0000-000000000002','sync_connection','processing'),
      ('ad000000-0000-0000-0000-000000000002','sync_connection','queued');
      begin; ${migration('20260928080000_fence_connection_jobs.sql')} commit;`);
    await t.test('upgrade backfills queued generations and cancels unfenced processing work', () => {
      assert.equal(sql(`select count(*) from app.connection_sync_jobs where connection_generation is not null`), '2');
      assert.equal(sql(`select count(*) from app.connection_sync_jobs where status = 'canceled' and last_error like 'Interrupted%'`), '1');
      assert.equal(sql(`select count(*) from app.connection_sync_jobs where status = 'queued'`), '1');
      sql(`delete from app.connections where provider = 'upgrade'`);
    });
    await t.test('SQL state-machine, credential, ACL and generation assertions', () => {
      const suite = readFileSync(resolve('supabase/tests/connection_jobs.sql'), 'utf8');
      const assertions = suite.split('-- assertions:start')[1]?.split('-- assertions:end')[0];
      assert.ok(assertions, 'database test block is present');
      sql(`begin; ${assertions} rollback;`);
    });

    const c = 'ad000000-0000-0000-0000-000000000002';
    function setup(type = 'sync_connection') {
      sql(`delete from app.connections where id = '${c}';
        insert into app.connections (id,connection_key,workspace_id,provider,status,display_name,expires_at)
        values ('${c}','upgrade','ad000000-0000-0000-0000-000000000001','upgrade','active','Original',now()+interval '1 hour');
        select app.schedule_connection_job_v2('${c}','${type}',p_generation => (select job_generation from app.connections where id = '${c}'));`);
      return JSON.parse(sql(`select row_to_json(j) from app.claim_connection_sync_jobs_v2('worker',1) j`)) as { id: string; claim_id: string };
    }
    await t.test('concurrent schedulers deduplicate under the connection lock', async () => {
      setup();
      const query = `select app.schedule_connection_job_v2('${c}','sync_connection',p_generation => (select job_generation from app.connections where id='${c}'))`;
      const ids = await Promise.all([asyncSql(query), asyncSql(query)]);
      assert.equal(ids[0], ids[1]);
      assert.equal(sql(`select count(*) from app.connection_sync_jobs where status='queued'`), '1');
    });
    await t.test('concurrent claimers skip a locked connection and cannot duplicate a claim', async () => {
      const job = setup();
      sql(`update app.connection_sync_jobs set status='queued',started_at=null where id='${job.id}'`);
      const holder = await session();
      try {
        await holder.run(`begin; select id from app.connections where id='${c}' for update`);
        assert.equal(await asyncSql(`select count(*) from app.claim_connection_sync_jobs_v2('other',1)`), '0');
        await holder.run('commit');
        const counts = await Promise.all([
          asyncSql(`select count(*) from app.claim_connection_sync_jobs_v2('a',1)`),
          asyncSql(`select count(*) from app.claim_connection_sync_jobs_v2('b',1)`)
        ]);
        assert.equal(counts.map(Number).reduce((a, b) => a + b), 1);
      } finally { holder.close(); }
    });
    await t.test('revoke holding the row lock wins against an already dispatched completion RPC', async () => {
      const job = setup('token_refresh');
      const holder = await session();
      try {
        await holder.run(`begin; update app.connections set status='revoked' where id='${c}'`);
        const finishing = asyncSql(`select app.finish_connection_job('${job.id}','${job.claim_id}','succeeded')`);
        for (let i = 0; i < 100; i++) {
          if (sql(`select count(*) from pg_stat_activity where application_name='plusmy-job-fence-tests' and wait_event_type='Lock'`) !== '0') break;
          if (i === 99) assert.fail('completion never reached the row-lock barrier');
          await new Promise((done) => setTimeout(done, 10));
        }
        await holder.run('commit');
        assert.equal(await finishing, '');
        assert.equal(sql(`select status from app.connection_sync_jobs where id='${job.id}'`), 'canceled');
        assert.equal(sql(`select count(*) from app.connection_sync_jobs where status='queued'`), '0');
      } finally { holder.close(); }
    });
    await t.test('completion holding the row lock wins first, then revoke cancels its atomic followup', async () => {
      const job = setup('token_refresh');
      const holder = await session();
      try {
        await holder.run(`begin; select app.finish_connection_job('${job.id}','${job.claim_id}','succeeded')`);
        const revoking = asyncSql(`update app.connections set status='revoked' where id='${c}'`);
        for (let i = 0; i < 100; i++) {
          if (sql(`select count(*) from pg_stat_activity where application_name='plusmy-job-fence-tests' and wait_event_type='Lock'`) !== '0') break;
          if (i === 99) assert.fail('revoke never reached the row-lock barrier');
          await new Promise((done) => setTimeout(done, 10));
        }
        await holder.run('commit');
        await revoking;
        assert.equal(sql(`select status from app.connection_sync_jobs where id='${job.id}'`), 'succeeded');
        assert.equal(sql(`select count(*) from app.connection_sync_jobs where status='queued'`), '0');
      } finally { holder.close(); }
    });
  } finally {
    if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe', env });
    rmSync(directory, { recursive: true, force: true });
  }
});
