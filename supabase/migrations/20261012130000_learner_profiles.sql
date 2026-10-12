-- Phase 3: learner profile for onboarding, interests, and diagnostic progress.

create table if not exists public.learner_profiles (
  firebase_uid text primary key,
  goal text not null default '',
  domain text not null default 'networking' check (domain in ('general', 'networking')),
  target_concept_slug text,
  known_topics text[] not null default '{}',
  interests text[] not null default '{}',
  diagnostic_asked_slugs text[] not null default '{}',
  diagnostic_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.learner_profiles enable row level security;

create policy "owner reads profile" on public.learner_profiles for select to authenticated
  using (firebase_uid = public.current_firebase_uid());
create policy "owner inserts profile" on public.learner_profiles for insert to authenticated
  with check (firebase_uid = public.current_firebase_uid());
create policy "owner updates profile" on public.learner_profiles for update to authenticated
  using (firebase_uid = public.current_firebase_uid()) with check (firebase_uid = public.current_firebase_uid());
create policy "owner deletes profile" on public.learner_profiles for delete to authenticated
  using (firebase_uid = public.current_firebase_uid());

grant select, insert, update, delete on public.learner_profiles to authenticated;
