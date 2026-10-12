-- Phase 5: project submissions for the networking capstone.

create table if not exists public.project_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  firebase_uid text not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  writeup text not null check (char_length(writeup) between 40 and 8000),
  rubric jsonb not null default '{}'::jsonb,
  score numeric(5,4) not null default 0 check (score between 0 and 1),
  created_at timestamptz not null default now()
);
create index if not exists project_submissions_owner_idx on public.project_submissions(firebase_uid, created_at desc);

alter table public.project_submissions enable row level security;
create policy "owner reads projects" on public.project_submissions for select to authenticated
  using (firebase_uid = public.current_firebase_uid());
create policy "owner inserts projects" on public.project_submissions for insert to authenticated
  with check (firebase_uid = public.current_firebase_uid());

grant select, insert on public.project_submissions to authenticated;
