-- pipeline-v3 durable runs, artifacts, sources metadata, evidence, published course rows, quota.

create table if not exists public.v3_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','blocked','needs_clarification')),
  stage text not null default 'queued',
  percent integer not null default 0 check (percent between 0 and 100),
  input_hash text not null,
  learner_message text,
  spec jsonb,
  course jsonb,
  per_lesson jsonb not null default '[]'::jsonb,
  publishable boolean not null default false,
  cost_usd numeric(10,4) not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v3_runs_owner_created_idx on public.v3_runs(firebase_uid, created_at desc);

create table if not exists public.v3_stage_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.v3_runs(id) on delete cascade,
  firebase_uid text not null,
  stage text not null,
  prompt_name text,
  prompt_hash text,
  model_id text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  cost_usd numeric(10,4),
  output jsonb,
  gate_results jsonb,
  created_at timestamptz not null default now()
);
create index if not exists v3_stage_artifacts_run_idx on public.v3_stage_artifacts(run_id, created_at);

create table if not exists public.v3_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.v3_runs(id) on delete cascade,
  lesson_id text,
  url text not null,
  title text not null,
  tier smallint not null check (tier between 1 and 4),
  access_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.v3_evidence_cards (
  id text not null,
  run_id uuid not null references public.v3_runs(id) on delete cascade,
  lesson_id text,
  claim text not null,
  source_id text not null,
  chunk_ref text not null,
  quote text,
  conflicts_with text,
  primary key (run_id, id)
);

create table if not exists public.v3_courses (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null unique references public.v3_runs(id) on delete cascade,
  firebase_uid text not null,
  title text not null,
  goal text not null,
  level text not null,
  body jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.v3_lessons (
  id text not null,
  course_id uuid not null references public.v3_courses(id) on delete cascade,
  position integer not null,
  title text not null,
  status text not null,
  body jsonb not null,
  primary key (course_id, id)
);

create table if not exists public.v3_quizzes (
  id uuid primary key default extensions.gen_random_uuid(),
  course_id uuid not null references public.v3_courses(id) on delete cascade,
  lesson_id text not null,
  items jsonb not null,
  unique (course_id, lesson_id)
);

create table if not exists public.v3_usage_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  usage_day date not null default (timezone('utc', now()))::date,
  reserved_usd numeric(10,4) not null default 0,
  spent_usd numeric(10,4) not null default 0,
  run_count integer not null default 0,
  unique (firebase_uid, usage_day)
);

alter table public.v3_runs enable row level security;
alter table public.v3_stage_artifacts enable row level security;
alter table public.v3_sources enable row level security;
alter table public.v3_evidence_cards enable row level security;
alter table public.v3_courses enable row level security;
alter table public.v3_lessons enable row level security;
alter table public.v3_quizzes enable row level security;
alter table public.v3_usage_ledger enable row level security;

create policy v3_runs_owner_read on public.v3_runs for select using (firebase_uid = public.current_firebase_uid());
create policy v3_artifacts_owner_read on public.v3_stage_artifacts for select using (firebase_uid = public.current_firebase_uid());
create policy v3_sources_owner_read on public.v3_sources for select using (
  exists (select 1 from public.v3_runs r where r.id = run_id and r.firebase_uid = public.current_firebase_uid())
);
create policy v3_cards_owner_read on public.v3_evidence_cards for select using (
  exists (select 1 from public.v3_runs r where r.id = run_id and r.firebase_uid = public.current_firebase_uid())
);
create policy v3_courses_owner_read on public.v3_courses for select using (firebase_uid = public.current_firebase_uid());
create policy v3_lessons_owner_read on public.v3_lessons for select using (
  exists (select 1 from public.v3_courses c where c.id = course_id and c.firebase_uid = public.current_firebase_uid())
);
create policy v3_quizzes_owner_read on public.v3_quizzes for select using (
  exists (select 1 from public.v3_courses c where c.id = course_id and c.firebase_uid = public.current_firebase_uid())
);
create policy v3_usage_owner_read on public.v3_usage_ledger for select using (firebase_uid = public.current_firebase_uid());

create or replace function public.v3_reserve_spend(
  p_firebase_uid text,
  p_estimate_usd numeric,
  p_daily_user_limit integer,
  p_project_daily_limit_usd numeric
) returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (timezone('utc', now()))::date;
  user_row public.v3_usage_ledger%rowtype;
  project_reserved numeric;
  project_spent numeric;
begin
  insert into public.v3_usage_ledger (firebase_uid, usage_day)
  values (p_firebase_uid, d)
  on conflict (firebase_uid, usage_day) do nothing;

  select * into user_row from public.v3_usage_ledger
  where firebase_uid = p_firebase_uid and usage_day = d for update;

  if user_row.run_count >= p_daily_user_limit then
    raise exception 'user_daily_quota_exceeded';
  end if;

  select coalesce(sum(reserved_usd),0), coalesce(sum(spent_usd),0)
    into project_reserved, project_spent
  from public.v3_usage_ledger where usage_day = d;

  if project_reserved + project_spent + p_estimate_usd > p_project_daily_limit_usd then
    raise exception 'project_spend_limit_exceeded';
  end if;

  update public.v3_usage_ledger
    set reserved_usd = reserved_usd + p_estimate_usd,
        run_count = run_count + 1
  where firebase_uid = p_firebase_uid and usage_day = d;

  return d;
end;
$$;

create or replace function public.v3_release_spend(
  p_firebase_uid text,
  p_usage_day date,
  p_reserved_usd numeric,
  p_actual_usd numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.v3_usage_ledger
    set reserved_usd = greatest(0, reserved_usd - p_reserved_usd),
        spent_usd = spent_usd + greatest(0, p_actual_usd)
  where firebase_uid = p_firebase_uid and usage_day = p_usage_day;
end;
$$;
