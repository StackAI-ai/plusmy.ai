alter table app.connection_sync_jobs
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists alerted_at timestamptz;

create index if not exists connection_sync_jobs_dead_letter_idx
  on app.connection_sync_jobs (status, dead_lettered_at desc, created_at desc);
