-- Phase 2: richer source metadata, private learner sources, and level/concept-aware hybrid retrieval.

alter table public.sources
  add column if not exists source_kind text not null default 'web',
  add column if not exists concept_tags text[] not null default '{}',
  add column if not exists content_hash text,
  add column if not exists chunk_count integer not null default 0 check (chunk_count >= 0),
  add column if not exists link_status text not null default 'unchecked' check (link_status in ('unchecked','ok','broken','redirected')),
  add column if not exists link_checked_at timestamptz,
  add column if not exists owner_uid text,
  add column if not exists course_id uuid references public.courses(id) on delete cascade;

create index if not exists sources_concept_tags_idx on public.sources using gin(concept_tags);
create index if not exists sources_owner_idx on public.sources(owner_uid) where owner_uid is not null;
create index if not exists sources_course_idx on public.sources(course_id) where course_id is not null;

-- Private (learner-uploaded) sources are readable and deletable by their owner only.
drop policy if exists "approved sources are readable" on public.sources;
create policy "approved or owned sources are readable" on public.sources for select to authenticated
  using ((owner_uid is null and license_review_status = 'approved' and commercial_allowed) or owner_uid = public.current_firebase_uid());
create policy "owner deletes private sources" on public.sources for delete to authenticated
  using (owner_uid is not null and owner_uid = public.current_firebase_uid());

drop policy if exists "approved source chunks are readable" on public.source_chunks;
create policy "approved or owned source chunks are readable" on public.source_chunks for select to authenticated
  using (exists (
    select 1 from public.sources s where s.id = source_id
      and ((s.owner_uid is null and s.license_review_status = 'approved' and s.commercial_allowed) or s.owner_uid = public.current_firebase_uid())
  ));
grant delete on public.sources to authenticated;

-- Replace the retrieval RPC with a level- and concept-aware version. The previous
-- 4-argument signature is dropped so callers with named arguments never hit an overload ambiguity.
drop function if exists public.hybrid_search_source_chunks(text, extensions.vector, integer, boolean);

create or replace function public.hybrid_search_source_chunks(
  p_query text,
  p_query_embedding extensions.vector(1536),
  p_limit integer default 8,
  p_allow_noncommercial boolean default false,
  p_target_level smallint default 1,
  p_concept_slugs text[] default null,
  p_owner_uid text default null,
  p_candidate_pool integer default 60
) returns table(
  chunk_id uuid, source_id uuid, chunk_index integer, chunk_text text, url text, title text, publisher text, license text,
  attribution text, authority_score numeric, level smallint, concept_tags text[], is_private boolean,
  semantic_score real, lexical_score real, level_fit real, concept_boost real, final_score real
)
language sql stable set search_path = public, extensions, pg_temp as $$
  with eligible as (
    select c.id, c.source_id, c.chunk_index, c.chunk_text, s.url, s.title, s.publisher, s.license, s.attribution,
      s.authority_score, s.level, s.concept_tags, (s.owner_uid is not null) as is_private,
      case when p_query_embedding is null or c.embedding is null then null::real else (1 - (c.embedding <=> p_query_embedding))::real end as semantic_score,
      ts_rank_cd(c.search_vector, websearch_to_tsquery('english', p_query))::real as lexical_score,
      greatest(0, 1 - abs(coalesce(s.level, 1) - coalesce(p_target_level, 1)) / 4.0)::real as level_fit,
      case when p_concept_slugs is not null and s.concept_tags && p_concept_slugs then 1::real else 0::real end as concept_boost
    from public.source_chunks c
    join public.sources s on s.id = c.source_id
    where s.license_review_status = 'approved'
      and s.link_status <> 'broken'
      and (
        (s.owner_uid is null and (s.commercial_allowed or p_allow_noncommercial))
        or (p_owner_uid is not null and s.owner_uid = p_owner_uid)
      )
      and (
        c.search_vector @@ websearch_to_tsquery('english', p_query)
        or (p_query_embedding is not null and c.embedding is not null)
      )
  ), pooled as (
    select * from eligible
    order by coalesce(semantic_score, 0) desc, lexical_score desc
    limit least(greatest(coalesce(p_candidate_pool, 60), 10), 400)
  ), ranked as (
    select *,
      row_number() over (order by semantic_score desc nulls last) as semantic_rank,
      row_number() over (order by lexical_score desc) as lexical_rank
    from pooled
  ), scored as (
    select *,
      (0.30 * (60.0 / (60 + semantic_rank)) + 0.25 * (60.0 / (60 + lexical_rank)) + 0.20 * authority_score + 0.15 * level_fit + 0.10 * concept_boost)::real as final_score
    from ranked
  ), diversified as (
    select *,
      row_number() over (partition by source_id order by final_score desc, semantic_rank asc) as source_rank
    from scored
  )
  select id, source_id, chunk_index, chunk_text, url, title, publisher, license, attribution, authority_score, level, concept_tags, is_private,
    semantic_score, lexical_score, level_fit, concept_boost, final_score
  from diversified
  where source_rank <= 2
  order by final_score desc, semantic_rank asc
  limit least(greatest(coalesce(p_limit, 8), 1), 40)
$$;

grant execute on function public.hybrid_search_source_chunks(text, extensions.vector, integer, boolean, smallint, text[], text, integer) to authenticated, service_role;

-- Link checks recorded by the scheduled worker.
create or replace function public.record_source_link_status(p_source_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_status not in ('unchecked','ok','broken','redirected') then raise exception 'invalid_link_status'; end if;
  update public.sources set link_status = p_status, link_checked_at = now() where id = p_source_id;
end $$;
revoke all on function public.record_source_link_status(uuid, text) from public, anon, authenticated;
grant execute on function public.record_source_link_status(uuid, text) to service_role;
