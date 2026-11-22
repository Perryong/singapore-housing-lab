-- RAG chatbot data (#26, #33). Run once in the Supabase SQL editor; safe to re-run.
-- RLS is on with no policies: the browser (publishable/anon key) can't read or write;
-- only the server and tools/supabase_seed.mjs (secret key) can.

create table if not exists projects (
  id             text primary key,          -- project slug, e.g. bishan-terraces
  name           text not null,
  town           text,
  status         text,                      -- upcoming / launched / ...
  launch         text,                      -- e.g. "Oct 2025"
  kind           text,
  classification text,
  units          int,
  flat_types     text[],
  data           jsonb not null,            -- prices, value, commute, amenities, ... (see KEEP in the seed)
  updated        date
);

create table if not exists chunks (
  id         text primary key,              -- hash of source + chunk number
  kind       text not null check (kind in ('hdb', 'app')),
  source     text not null,                 -- repo path
  source_url text,
  title      text not null,
  section    text,                          -- markdown heading (app docs)
  page       int,                           -- PDF page (hdb docs)
  n          int not null,
  text       text not null,
  fetched    date,
  fts        tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || text)) stored
);
create index if not exists chunks_fts on chunks using gin (fts);
create index if not exists chunks_kind on chunks (kind);
-- embeddings come later (#26 decision 2): create extension vector; alter table chunks add column embedding vector(<dims>);

alter table projects enable row level security;
alter table chunks enable row level security;

-- the Data API only sees granted tables; grant the secret key's role only, never anon/authenticated
grant select, insert, update, delete on projects, chunks to service_role;
