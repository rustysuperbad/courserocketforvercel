-- Phase 4: verified module reuse across learners, and a short-lived resource cache.

create table if not exists public.verified_module_cache (
  id uuid primary key default extensions.gen_random_uuid(),
  concept_id uuid not null references public.concepts(id) on delete cascade,
  evidence_hash text not null,
  lesson jsonb not null,
  content_status text not null check (content_status in ('ai_generated','ai_verified','human_reviewed')),
  created_at timestamptz not null default now(),
  unique (concept_id, evidence_hash)
);
create index if not exists verified_module_cache_concept_idx on public.verified_module_cache(concept_id);

alter table public.verified_module_cache enable row level security;
-- Cache is written and read only by the service role during generation.
revoke all on public.verified_module_cache from public, anon, authenticated;
grant all on public.verified_module_cache to service_role;

create table if not exists public.resource_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists resource_cache_expires_idx on public.resource_cache(expires_at);

alter table public.resource_cache enable row level security;
revoke all on public.resource_cache from public, anon, authenticated;
grant all on public.resource_cache to service_role;
