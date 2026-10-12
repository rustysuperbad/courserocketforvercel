create table if not exists public.learning_outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  stage text not null check (stage in ('pre','post','delayed')),
  score numeric(5,4) not null check (score between 0 and 1),
  created_at timestamptz not null default now()
);
create index if not exists learning_outcomes_owner_idx on public.learning_outcomes(firebase_uid, created_at desc);

alter table public.learning_outcomes enable row level security;
create policy "owner reads outcomes" on public.learning_outcomes for select to authenticated
  using (firebase_uid = public.current_firebase_uid());
create policy "owner inserts outcomes" on public.learning_outcomes for insert to authenticated
  with check (firebase_uid = public.current_firebase_uid());
grant select, insert on public.learning_outcomes to authenticated;
