create extension if not exists pgcrypto;

create table if not exists research_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  base_url text not null,
  access_mode text not null check (access_mode in ('public', 'restricted')),
  enabled boolean not null default true,
  status text not null default 'idle',
  status_note text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists research_items (
  id bigserial primary key,
  source_code text not null references research_sources(code) on update cascade,
  source_name text,
  url text not null,
  original_url text,
  canonical_url text not null unique,
  title_en text not null,
  published_at date,
  topics text[] not null default '{}',
  summary_zh text,
  highlights_zh jsonb not null default '[]'::jsonb,
  key_paragraphs_zh jsonb not null default '[]'::jsonb,
  raw_excerpt_en text,
  images jsonb not null default '[]'::jsonb,
  content_hash text,
  status text not null default 'ok' check (status in ('ok', 'partial', 'error')),
  disclaimer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create extension if not exists pg_trgm;

create index if not exists idx_research_items_source_code on research_items(source_code);
create index if not exists idx_research_items_published_at on research_items(published_at desc);
create index if not exists idx_research_items_status on research_items(status);
create index if not exists idx_research_items_topics_gin on research_items using gin(topics);
create index if not exists idx_research_items_title_trgm on research_items using gin (title_en gin_trgm_ops);
create index if not exists idx_research_items_summary_trgm on research_items using gin (summary_zh gin_trgm_ops);

create table if not exists research_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('manual', 'scheduled')),
  status text not null check (status in ('running', 'finished', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  stats jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_research_runs_status on research_runs(status);
create index if not exists idx_research_runs_started_at on research_runs(started_at desc);

create table if not exists research_run_logs (
  id bigserial primary key,
  run_id uuid not null references research_runs(id) on delete cascade,
  source_code text,
  url text,
  stage text,
  status text,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_run_logs_run_id on research_run_logs(run_id);
create index if not exists idx_research_run_logs_created_at on research_run_logs(created_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists research_sources_set_updated_at on research_sources;
create trigger research_sources_set_updated_at
before update on research_sources
for each row execute function set_updated_at();

drop trigger if exists research_items_set_updated_at on research_items;
create trigger research_items_set_updated_at
before update on research_items
for each row execute function set_updated_at();

drop trigger if exists research_runs_set_updated_at on research_runs;
create trigger research_runs_set_updated_at
before update on research_runs
for each row execute function set_updated_at();
