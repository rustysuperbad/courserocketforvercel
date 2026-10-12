-- CourseRocket learning foundation: Firebase remains the identity provider.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create or replace function public.current_firebase_uid()
returns text language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '') $$;

create table if not exists public.concepts (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  domain text not null,
  title text not null,
  description text not null,
  level smallint not null default 1 check (level between 1 and 5),
  estimated_minutes integer not null default 15 check (estimated_minutes > 0),
  objectives jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists concepts_domain_level_idx on public.concepts(domain, level);

create table if not exists public.concept_prereqs (
  concept_id uuid not null references public.concepts(id) on delete cascade,
  prerequisite_id uuid not null references public.concepts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (concept_id, prerequisite_id),
  check (concept_id <> prerequisite_id)
);
create index if not exists concept_prereqs_prerequisite_idx on public.concept_prereqs(prerequisite_id);

create or replace function public.reject_concept_prereq_cycle()
returns trigger language plpgsql as $$
declare creates_cycle boolean;
begin
  with recursive ancestors(id) as (
    select new.concept_id
    union
    select cp.concept_id from public.concept_prereqs cp join ancestors a on cp.prerequisite_id = a.id
    where not (tg_op = 'UPDATE' and cp.concept_id = old.concept_id and cp.prerequisite_id = old.prerequisite_id)
  )
  select exists(select 1 from ancestors where id = new.prerequisite_id) into creates_cycle;
  if creates_cycle then raise exception 'Prerequisite edge would create a cycle'; end if;
  return new;
end $$;
drop trigger if exists concept_prereqs_no_cycle on public.concept_prereqs;
create trigger concept_prereqs_no_cycle before insert or update on public.concept_prereqs
for each row execute function public.reject_concept_prereq_cycle();

create table if not exists public.sources (
  id uuid primary key default extensions.gen_random_uuid(),
  url text not null unique,
  title text not null,
  publisher text not null,
  license text not null,
  attribution text not null,
  authority_score numeric(4,3) not null default 0.5 check (authority_score between 0 and 1),
  level smallint not null default 1 check (level between 1 and 5),
  commercial_allowed boolean not null default false,
  license_review_status text not null default 'review_required' check (license_review_status in ('review_required','approved','blocked')),
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sources_license_lookup_idx on public.sources(commercial_allowed, license_review_status);

create table if not exists public.source_chunks (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_text text not null,
  embedding extensions.vector(1536),
  search_vector tsvector generated always as (to_tsvector('english', chunk_text)) stored,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique(source_id, chunk_index),
  unique(source_id, content_hash)
);
create index if not exists source_chunks_search_idx on public.source_chunks using gin(search_vector);
create index if not exists source_chunks_embedding_idx on public.source_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists source_chunks_source_idx on public.source_chunks(source_id);

create table if not exists public.courses (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  goal text not null,
  domain text not null default 'general',
  interests text[] not null default '{}',
  generation_run_id uuid unique,
  status text not null default 'draft' check (status in ('draft','queued','generating','ready','failed','deleted')),
  content_status text not null default 'ai_generated' check (content_status in ('ai_generated','ai_verified','human_reviewed')),
  estimated_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists courses_owner_created_idx on public.courses(firebase_uid, created_at desc);

create table if not exists public.modules (
  id uuid primary key default extensions.gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  concept_id uuid references public.concepts(id) on delete set null,
  position integer not null check (position >= 0),
  remediation_for_concept uuid references public.concepts(id) on delete set null,
  title text not null,
  summary text not null default '',
  body jsonb not null default '{}'::jsonb,
  content_status text not null default 'ai_generated' check (content_status in ('ai_generated','ai_verified','human_reviewed')),
  created_at timestamptz not null default now(),
  unique(course_id, position)
);
create index if not exists modules_course_idx on public.modules(course_id, position);
create unique index if not exists modules_remediation_once_idx on public.modules(course_id, remediation_for_concept) where remediation_for_concept is not null;

create table if not exists public.lesson_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  claim_key text not null,
  claim_text text not null,
  supporting_chunk_ids uuid[] not null default '{}',
  verified boolean not null default false,
  verification_status text not null default 'pending' check (verification_status in ('pending','supported','unsupported','rewritten')),
  verifier_model text,
  created_at timestamptz not null default now(),
  unique(module_id, claim_key)
);
create index if not exists lesson_claims_module_idx on public.lesson_claims(module_id);

create table if not exists public.quiz_items (
  id uuid primary key default extensions.gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  item_key text not null,
  concept_id uuid references public.concepts(id) on delete set null,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  explanation text not null default '',
  question_type text not null default 'recall' check (question_type in ('recall','explain','apply')),
  verified boolean not null default false,
  source_chunk_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(module_id, item_key)
);
create index if not exists quiz_items_module_idx on public.quiz_items(module_id);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null,
  quiz_item_id uuid not null references public.quiz_items(id) on delete cascade,
  response_key text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  unique(firebase_uid, response_key)
);
create index if not exists quiz_attempts_owner_created_idx on public.quiz_attempts(firebase_uid, created_at desc);

create table if not exists public.learner_mastery (
  firebase_uid text not null,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  p_known numeric(6,5) not null default 0.1 check (p_known between 0 and 1),
  attempts integer not null default 0 check (attempts >= 0),
  correct_attempts integer not null default 0 check (correct_attempts between 0 and attempts),
  updated_at timestamptz not null default now(),
  primary key(firebase_uid, concept_id)
);

create table if not exists public.review_cards (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  fsrs_state jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(firebase_uid, concept_id)
);
create index if not exists review_cards_due_idx on public.review_cards(firebase_uid, due_at);

create table if not exists public.feedback_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  course_id uuid references public.courses(id) on delete set null,
  module_id uuid references public.modules(id) on delete set null,
  category text not null check (category in ('confusing','incorrect','too_easy','too_hard','useful')),
  note text,
  review_status text not null default 'new' check (review_status in ('new','triaged','resolved')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_reports_status_idx on public.feedback_reports(review_status, created_at);

create table if not exists public.generation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  idempotency_key text not null,
  course_id uuid references public.courses(id) on delete set null,
  goal text not null,
  domain text not null default 'general',
  target_concept_slug text,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','blocked')),
  progress jsonb not null default '{"stage":"queued","percent":0}'::jsonb,
  provider text,
  model text,
  fallback_used boolean not null default false,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_estimate_usd numeric(12,6) not null default 0,
  actual_cost_usd numeric(12,6) not null default 0,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(firebase_uid, idempotency_key)
);
create index if not exists generation_runs_owner_recent_idx on public.generation_runs(firebase_uid, created_at desc);
create index if not exists generation_runs_status_idx on public.generation_runs(status, created_at);

create table if not exists public.generation_run_usage (
  run_id uuid not null references public.generation_runs(id) on delete cascade,
  usage_key text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  latency_ms integer,
  created_at timestamptz not null default now(),
  primary key(run_id, usage_key)
);

create table if not exists public.user_usage_daily (
  firebase_uid text not null,
  usage_day date not null,
  run_count integer not null default 0,
  reserved_cost_usd numeric(12,6) not null default 0,
  actual_cost_usd numeric(12,6) not null default 0,
  primary key(firebase_uid, usage_day)
);
create table if not exists public.project_spend_daily (
  usage_day date primary key,
  reserved_cost_usd numeric(12,6) not null default 0,
  actual_cost_usd numeric(12,6) not null default 0
);
create table if not exists public.user_source_search_daily (
  firebase_uid text not null,
  usage_day date not null,
  search_count integer not null default 0,
  primary key(firebase_uid, usage_day)
);

create or replace function public.reserve_source_search(
  p_firebase_uid text, p_estimate_usd numeric, p_daily_search_limit integer default 100,
  p_project_daily_limit_usd numeric default 25
) returns date language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_day date := (now() at time zone 'utc')::date;
begin
  insert into public.user_source_search_daily(firebase_uid, usage_day) values(p_firebase_uid, v_day) on conflict do nothing;
  insert into public.project_spend_daily(usage_day) values(v_day) on conflict do nothing;
  perform 1 from public.user_source_search_daily where firebase_uid = p_firebase_uid and usage_day = v_day for update;
  perform 1 from public.project_spend_daily where usage_day = v_day for update;
  if (select search_count from public.user_source_search_daily where firebase_uid = p_firebase_uid and usage_day = v_day) >= p_daily_search_limit then raise exception 'source_search_quota_exceeded'; end if;
  if (select reserved_cost_usd + actual_cost_usd + p_estimate_usd from public.project_spend_daily where usage_day = v_day) > p_project_daily_limit_usd then raise exception 'project_spend_limit_exceeded'; end if;
  update public.user_source_search_daily set search_count = search_count + 1 where firebase_uid = p_firebase_uid and usage_day = v_day;
  update public.project_spend_daily set reserved_cost_usd = reserved_cost_usd + p_estimate_usd where usage_day = v_day;
  return v_day;
end $$;

create or replace function public.settle_source_search(
  p_firebase_uid text, p_usage_day date, p_reserved_usd numeric, p_actual_usd numeric
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update public.project_spend_daily set reserved_cost_usd = greatest(0,reserved_cost_usd-p_reserved_usd), actual_cost_usd = actual_cost_usd+p_actual_usd where usage_day = p_usage_day;
end $$;

create or replace function public.record_mastery_answer(
  p_firebase_uid text, p_concept_id uuid, p_is_correct boolean,
  p_guess numeric default 0.2, p_slip numeric default 0.1, p_learn numeric default 0.12
) returns table(p_known numeric, attempts integer, correct_attempts integer)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_prior numeric; v_attempts integer; v_correct integer; v_posterior numeric; v_lknown numeric; v_lunknown numeric;
begin
  insert into public.learner_mastery(firebase_uid, concept_id) values(p_firebase_uid, p_concept_id) on conflict do nothing;
  select lm.p_known, lm.attempts, lm.correct_attempts into v_prior, v_attempts, v_correct
    from public.learner_mastery lm where lm.firebase_uid=p_firebase_uid and lm.concept_id=p_concept_id for update;
  v_lknown := case when p_is_correct then 1-p_slip else p_slip end;
  v_lunknown := case when p_is_correct then p_guess else 1-p_guess end;
  v_posterior := (v_prior*v_lknown) / nullif(v_prior*v_lknown+(1-v_prior)*v_lunknown,0);
  v_posterior := coalesce(v_posterior,v_prior) + (1-coalesce(v_posterior,v_prior))*p_learn;
  update public.learner_mastery lm set p_known=least(1,greatest(0,v_posterior)), attempts=v_attempts+1,
    correct_attempts=v_correct+case when p_is_correct then 1 else 0 end, updated_at=now()
    where lm.firebase_uid=p_firebase_uid and lm.concept_id=p_concept_id;
  return query select lm.p_known, lm.attempts, lm.correct_attempts from public.learner_mastery lm where lm.firebase_uid=p_firebase_uid and lm.concept_id=p_concept_id;
end $$;

create or replace function public.update_generation_progress(
  p_run_id uuid, p_status text, p_progress jsonb
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_status not in ('queued','running','blocked') then raise exception 'invalid_progress_status'; end if;
  update public.generation_runs set status = p_status, progress = coalesce(p_progress, progress), updated_at = now() where id = p_run_id;
  if not found then raise exception 'run_not_found'; end if;
end $$;

create or replace function public.record_generation_usage(
  p_run_id uuid, p_usage_key text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_latency_ms integer default null
) returns boolean language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare inserted_run_id uuid;
begin
  insert into public.generation_run_usage(run_id, usage_key, provider, model, input_tokens, output_tokens, cost_usd, latency_ms)
    values(p_run_id, p_usage_key, p_provider, p_model, greatest(0,p_input_tokens), greatest(0,p_output_tokens), greatest(0,p_cost_usd), p_latency_ms)
    on conflict(run_id,usage_key) do nothing returning run_id into inserted_run_id;
  if inserted_run_id is null then return false; end if;
  update public.generation_runs set input_tokens=input_tokens+greatest(0,p_input_tokens),
    output_tokens=output_tokens+greatest(0,p_output_tokens), actual_cost_usd=actual_cost_usd+greatest(0,p_cost_usd),
    provider=case when provider is null then p_provider when position(p_provider in provider)=0 then provider || '+' || p_provider else provider end,
    model=case when model is null then p_model when position(p_model in model)=0 then model || '+' || p_model else model end,
    latency_ms=coalesce(latency_ms,0)+coalesce(p_latency_ms,0), updated_at=now() where id=p_run_id;
  return true;
end $$;

create or replace function public.reserve_generation_run(
  p_firebase_uid text, p_idempotency_key text, p_goal text,
  p_estimate_usd numeric default 0.05,
  p_daily_user_limit integer default 3,
  p_project_daily_limit_usd numeric default 25,
  p_domain text default 'general',
  p_target_concept_slug text default null
) returns uuid language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_day date := (now() at time zone 'utc')::date; v_run_id uuid;
begin
  if p_firebase_uid is null or length(p_firebase_uid) < 1 or length(p_firebase_uid) > 128 then raise exception 'invalid_user'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 128 then raise exception 'invalid_idempotency_key'; end if;
  if p_goal is null or length(btrim(p_goal)) < 1 or length(p_goal) > 500 then raise exception 'invalid_goal'; end if;
  if p_domain not in ('general','networking') or (p_target_concept_slug is not null and length(p_target_concept_slug) > 160) then raise exception 'invalid_domain'; end if;
  if p_estimate_usd < 0 or p_daily_user_limit < 1 or p_project_daily_limit_usd <= 0 then raise exception 'invalid_quota'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_firebase_uid || ':' || p_idempotency_key, 0));
  select id into v_run_id from public.generation_runs where firebase_uid = p_firebase_uid and idempotency_key = p_idempotency_key;
  if v_run_id is not null then return v_run_id; end if;
  insert into public.user_usage_daily(firebase_uid, usage_day) values(p_firebase_uid, v_day) on conflict do nothing;
  insert into public.project_spend_daily(usage_day) values(v_day) on conflict do nothing;
  perform 1 from public.user_usage_daily where firebase_uid = p_firebase_uid and usage_day = v_day for update;
  perform 1 from public.project_spend_daily where usage_day = v_day for update;
  if (select run_count from public.user_usage_daily where firebase_uid = p_firebase_uid and usage_day = v_day) >= p_daily_user_limit then raise exception 'user_daily_quota_exceeded'; end if;
  if (select reserved_cost_usd + actual_cost_usd + p_estimate_usd from public.project_spend_daily where usage_day = v_day) > p_project_daily_limit_usd then raise exception 'project_spend_limit_exceeded'; end if;
  insert into public.generation_runs(firebase_uid, idempotency_key, goal, cost_estimate_usd, domain, target_concept_slug)
    values(p_firebase_uid, p_idempotency_key, btrim(p_goal), p_estimate_usd, p_domain, p_target_concept_slug) returning id into v_run_id;
  update public.user_usage_daily set run_count = run_count + 1, reserved_cost_usd = reserved_cost_usd + p_estimate_usd where firebase_uid = p_firebase_uid and usage_day = v_day;
  update public.project_spend_daily set reserved_cost_usd = reserved_cost_usd + p_estimate_usd where usage_day = v_day;
  return v_run_id;
end $$;

create or replace function public.finalize_generation_run(
  p_run_id uuid, p_status text, p_actual_cost_usd numeric,
  p_progress jsonb default null, p_provider text default null, p_model text default null,
  p_input_tokens integer default null, p_output_tokens integer default null,
  p_latency_ms integer default null, p_fallback_used boolean default false,
  p_error_code text default null
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_run public.generation_runs%rowtype; v_day date;
begin
  if p_status not in ('queued','running','completed','failed','blocked') or coalesce(p_actual_cost_usd,0) < 0 then raise exception 'invalid_run_update'; end if;
  select * into v_run from public.generation_runs where id = p_run_id for update;
  if not found then raise exception 'run_not_found'; end if;
  if v_run.status in ('completed','failed','blocked') then return; end if;
  v_day := (v_run.created_at at time zone 'utc')::date;
  p_actual_cost_usd := coalesce(p_actual_cost_usd, v_run.actual_cost_usd);
  update public.user_usage_daily set reserved_cost_usd = greatest(0, reserved_cost_usd - v_run.cost_estimate_usd), actual_cost_usd = actual_cost_usd + p_actual_cost_usd where firebase_uid = v_run.firebase_uid and usage_day = v_day;
  update public.project_spend_daily set reserved_cost_usd = greatest(0, reserved_cost_usd - v_run.cost_estimate_usd), actual_cost_usd = actual_cost_usd + p_actual_cost_usd where usage_day = v_day;
  update public.generation_runs set status = p_status, progress = coalesce(p_progress, progress), provider = coalesce(p_provider, provider), model = coalesce(p_model, model), input_tokens = case when p_input_tokens is null then input_tokens else greatest(0,p_input_tokens) end, output_tokens = case when p_output_tokens is null then output_tokens else greatest(0,p_output_tokens) end, actual_cost_usd = p_actual_cost_usd, latency_ms = coalesce(p_latency_ms,latency_ms), fallback_used = p_fallback_used, error_code = p_error_code, updated_at = now() where id = p_run_id;
end $$;

create or replace function public.hybrid_search_source_chunks(
  p_query text, p_query_embedding extensions.vector(1536), p_limit integer default 8,
  p_allow_noncommercial boolean default false
) returns table(chunk_id uuid, source_id uuid, chunk_text text, url text, title text, license text, attribution text,
  authority_score numeric, level smallint, semantic_score real, lexical_score real, final_score real)
language sql stable set search_path = public, extensions, pg_temp as $$
  with eligible as (
    select c.id, c.source_id, c.chunk_text, s.url, s.title, s.license, s.attribution, s.authority_score, s.level,
      case when p_query_embedding is null then null::real else 1 - (c.embedding <=> p_query_embedding) end as semantic_score,
      ts_rank_cd(c.search_vector, websearch_to_tsquery('english', p_query))::real as lexical_score
    from public.source_chunks c join public.sources s on s.id = c.source_id
    where s.license_review_status = 'approved' and (s.commercial_allowed or p_allow_noncommercial)
      and (p_query_embedding is null or c.embedding is not null)
      and (c.search_vector @@ websearch_to_tsquery('english', p_query) or (p_query_embedding is not null and c.embedding is not null))
  ), ranked as (
    select *,
      row_number() over(order by semantic_score desc nulls last) as semantic_rank,
      row_number() over(order by lexical_score desc) as lexical_rank
    from eligible
  )
  select id, source_id, chunk_text, url, title, license, attribution, authority_score, level, semantic_score, lexical_score,
    (0.30 / (60 + semantic_rank) + 0.30 / (60 + lexical_rank) + 0.25 * authority_score + 0.15 * (1.0 / greatest(level, 1)))::real
  from ranked order by 12 desc limit least(greatest(p_limit,1),20)
$$;

-- Enable RLS on every application table; service_role is used only by Functions.
do $$ declare t text; begin
  foreach t in array array['concepts','concept_prereqs','sources','source_chunks','courses','modules','lesson_claims','quiz_items','quiz_attempts','learner_mastery','review_cards','feedback_reports','generation_runs','generation_run_usage','user_usage_daily','project_spend_daily','user_source_search_daily'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "approved sources are readable" on public.sources for select to authenticated using (license_review_status = 'approved' and commercial_allowed);
create policy "approved source chunks are readable" on public.source_chunks for select to authenticated using (exists (select 1 from public.sources s where s.id = source_id and s.license_review_status = 'approved' and s.commercial_allowed));
create policy "concepts readable" on public.concepts for select to authenticated using (true);
create policy "prerequisites readable" on public.concept_prereqs for select to authenticated using (true);

create policy "owner reads courses" on public.courses for select to authenticated using (firebase_uid = public.current_firebase_uid());
create policy "owner inserts courses" on public.courses for insert to authenticated with check (firebase_uid = public.current_firebase_uid());
create policy "owner updates courses" on public.courses for update to authenticated using (firebase_uid = public.current_firebase_uid()) with check (firebase_uid = public.current_firebase_uid());
create policy "owner deletes courses" on public.courses for delete to authenticated using (firebase_uid = public.current_firebase_uid());
create policy "owner reads modules" on public.modules for select to authenticated using (exists(select 1 from public.courses c where c.id = course_id and c.firebase_uid = public.current_firebase_uid()));
create policy "owner reads claims" on public.lesson_claims for select to authenticated using (exists(select 1 from public.modules m join public.courses c on c.id = m.course_id where m.id = module_id and c.firebase_uid = public.current_firebase_uid()));
create policy "owner reads quizzes" on public.quiz_items for select to authenticated using (exists(select 1 from public.modules m join public.courses c on c.id = m.course_id where m.id = module_id and c.firebase_uid = public.current_firebase_uid()));
create policy "owner reads mastery" on public.learner_mastery for select to authenticated using (firebase_uid = public.current_firebase_uid());
create policy "owner writes mastery" on public.learner_mastery for all to authenticated using (firebase_uid = public.current_firebase_uid()) with check (firebase_uid = public.current_firebase_uid());
create policy "owner reads review cards" on public.review_cards for select to authenticated using (firebase_uid = public.current_firebase_uid());
create policy "owner writes review cards" on public.review_cards for all to authenticated using (firebase_uid = public.current_firebase_uid()) with check (firebase_uid = public.current_firebase_uid());
create policy "owner manages feedback" on public.feedback_reports for all to authenticated using (firebase_uid = public.current_firebase_uid()) with check (firebase_uid = public.current_firebase_uid());
create policy "owner reads generation runs" on public.generation_runs for select to authenticated using (firebase_uid = public.current_firebase_uid());

grant select on public.concepts, public.concept_prereqs, public.sources, public.source_chunks,
  public.courses, public.modules, public.lesson_claims, public.quiz_items, public.learner_mastery,
  public.review_cards, public.feedback_reports, public.generation_runs to authenticated;
grant insert, update, delete on public.courses, public.learner_mastery, public.review_cards, public.feedback_reports to authenticated;

revoke all on function public.reserve_generation_run(text,text,text,numeric,integer,numeric,text,text) from public, anon, authenticated;
grant execute on function public.reserve_generation_run(text,text,text,numeric,integer,numeric,text,text) to service_role;
revoke all on function public.finalize_generation_run(uuid,text,numeric,jsonb,text,text,integer,integer,integer,boolean,text) from public, anon, authenticated;
grant execute on function public.finalize_generation_run(uuid,text,numeric,jsonb,text,text,integer,integer,integer,boolean,text) to service_role;
revoke all on function public.update_generation_progress(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.update_generation_progress(uuid,text,jsonb) to service_role;
revoke all on function public.record_generation_usage(uuid,text,text,text,integer,integer,numeric,integer) from public, anon, authenticated;
grant execute on function public.record_generation_usage(uuid,text,text,text,integer,integer,numeric,integer) to service_role;
revoke all on function public.reserve_source_search(text,numeric,integer,numeric) from public, anon, authenticated;
grant execute on function public.reserve_source_search(text,numeric,integer,numeric) to service_role;
revoke all on function public.settle_source_search(text,date,numeric,numeric) from public, anon, authenticated;
grant execute on function public.settle_source_search(text,date,numeric,numeric) to service_role;
revoke all on function public.record_mastery_answer(text,uuid,boolean,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.record_mastery_answer(text,uuid,boolean,numeric,numeric,numeric) to service_role;
grant execute on function public.hybrid_search_source_chunks(text,extensions.vector,integer,boolean) to authenticated, service_role;
