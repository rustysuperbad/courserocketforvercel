-- Per-stage RAG artifacts. Do not store raw learner text in output.
create table if not exists public.rag_run_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null,
  owner_uid text not null,
  lesson_id text,
  stage text not null,
  prompt_name text,
  prompt_hash text,
  model_id text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  cost_usd numeric(12,6),
  output jsonb not null default '{}'::jsonb,
  gate_results jsonb,
  status text not null check (status in ('ok', 'failed', 'blocked', 'needs_review', 'ready')),
  created_at timestamptz not null default now()
);

create index if not exists rag_run_artifacts_run_idx on public.rag_run_artifacts(run_id, created_at);
create index if not exists rag_run_artifacts_owner_idx on public.rag_run_artifacts(owner_uid, created_at desc);

alter table public.rag_run_artifacts enable row level security;

drop policy if exists rag_run_artifacts_owner_read on public.rag_run_artifacts;
create policy rag_run_artifacts_owner_read
  on public.rag_run_artifacts
  for select
  to authenticated
  using (owner_uid = public.current_firebase_uid());

revoke insert, update, delete on public.rag_run_artifacts from authenticated, anon;
grant select on public.rag_run_artifacts to authenticated;
grant all on public.rag_run_artifacts to service_role;
