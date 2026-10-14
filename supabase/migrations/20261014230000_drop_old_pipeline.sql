-- Forward drop of pre-v3 generation/retrieval objects.
-- Linked project: do not rewrite applied SQL. Learner course/module rows stay.

drop function if exists public.hybrid_search_source_chunks cascade;
drop function if exists public.reserve_generation_run cascade;
drop function if exists public.finalize_generation_run cascade;
drop function if exists public.update_generation_progress cascade;
drop function if exists public.reserve_source_search cascade;
drop function if exists public.settle_source_search cascade;

drop table if exists public.rag_run_artifacts cascade;
drop table if exists public.source_chunks cascade;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'courses_generation_run_id_fkey'
  ) then
    alter table public.courses drop constraint courses_generation_run_id_fkey;
  end if;
end $$;

drop table if exists public.generation_runs cascade;
drop table if exists public.concept_prereqs cascade;

alter table if exists public.modules drop constraint if exists modules_concept_id_fkey;
drop table if exists public.concepts cascade;
