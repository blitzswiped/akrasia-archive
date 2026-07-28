-- Akrasia Archive - complete Supabase setup
-- Paste this entire file into Supabase SQL Editor and run it once.

begin;

create extension if not exists pgcrypto;

-- Core public archive -------------------------------------------------------

create table if not exists public.archive_assets (
  id uuid primary key default gen_random_uuid(),
  filename text not null default '',
  title text not null default 'untitled file',
  version text not null default 'v1',
  batch text not null default '__root__',
  asset_date date,
  asset_time time,
  mood text not null default 'raw',
  mood_color text not null default '#ffffff',
  type text not null default 'audio',
  size_label text default '',
  file_url text default '',
  cover_url text default '',
  storage_path text default '',
  cover_storage_path text default '',
  notes text default '',
  synced_lyrics text default '',
  spotify_url text default '',
  apple_url text default '',
  youtube_url text default '',
  soundcloud_url text default '',
  text_content text default '',
  project_key text not null default '',
  world_title text not null default '',
  asset_role text not null default 'version',
  credits jsonb not null default '[]'::jsonb,
  world_summary text not null default '',
  object_style text not null default 'case',
  source_kind text not null default '',
  source_project_id text not null default '',
  source_revision_id text not null default '',
  source_sha256 text not null default '',
  source_url text not null default '',
  source_metadata jsonb not null default '{}'::jsonb,
  source_synced_at timestamptz,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Empty folders need their own records because archive_assets.batch can only
-- preserve a folder after at least one file exists inside it.
create table if not exists public.archive_folders (
  path text primary key,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint archive_folders_path_valid check (
    char_length(btrim(path)) between 1 and 600
    and path !~ '[[:cntrl:]<>]'
    and path <> '__root__'
  )
);

create index if not exists archive_folders_order_idx on public.archive_folders(sort_order,path);

create or replace function public.validate_archive_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.path := regexp_replace(btrim(new.path), '/+', '/', 'g');
  new.path := trim(both '/' from new.path);
  if char_length(new.path) not between 1 and 600 then raise exception 'invalid folder path'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists archive_folder_validation on public.archive_folders;
create trigger archive_folder_validation
before insert or update on public.archive_folders
for each row execute function public.validate_archive_folder();

alter table public.archive_assets add column if not exists filename text default '';
alter table public.archive_assets add column if not exists title text default 'untitled file';
alter table public.archive_assets add column if not exists version text default 'v1';
alter table public.archive_assets add column if not exists batch text default '__root__';
alter table public.archive_assets add column if not exists asset_date date;
alter table public.archive_assets add column if not exists asset_time time;
alter table public.archive_assets add column if not exists mood text default 'raw';
alter table public.archive_assets add column if not exists mood_color text default '#ffffff';
alter table public.archive_assets add column if not exists type text default 'audio';
alter table public.archive_assets add column if not exists size_label text default '';
alter table public.archive_assets add column if not exists file_url text default '';
alter table public.archive_assets add column if not exists cover_url text default '';
alter table public.archive_assets add column if not exists storage_path text default '';
alter table public.archive_assets add column if not exists cover_storage_path text default '';
alter table public.archive_assets add column if not exists notes text default '';
alter table public.archive_assets add column if not exists synced_lyrics text default '';
alter table public.archive_assets add column if not exists spotify_url text default '';
alter table public.archive_assets add column if not exists apple_url text default '';
alter table public.archive_assets add column if not exists youtube_url text default '';
alter table public.archive_assets add column if not exists soundcloud_url text default '';
alter table public.archive_assets add column if not exists text_content text default '';
alter table public.archive_assets add column if not exists project_key text default '';
alter table public.archive_assets add column if not exists world_title text default '';
alter table public.archive_assets add column if not exists asset_role text default 'version';
alter table public.archive_assets add column if not exists credits jsonb default '[]'::jsonb;
alter table public.archive_assets add column if not exists world_summary text default '';
alter table public.archive_assets add column if not exists object_style text default 'case';
alter table public.archive_assets add column if not exists source_kind text default '';
alter table public.archive_assets add column if not exists source_project_id text default '';
alter table public.archive_assets add column if not exists source_revision_id text default '';
alter table public.archive_assets add column if not exists source_sha256 text default '';
alter table public.archive_assets add column if not exists source_url text default '';
alter table public.archive_assets add column if not exists source_metadata jsonb default '{}'::jsonb;
alter table public.archive_assets add column if not exists source_synced_at timestamptz;
alter table public.archive_assets add column if not exists sort_order bigint default 0;
alter table public.archive_assets add column if not exists created_at timestamptz default now();

-- Normalize legacy padded versions once. The validation trigger below keeps
-- all future inserts and edits in the same v1, v2, v8 format.
update public.archive_assets
set version = 'v' || (substring(version from 2)::bigint)::text
where version ~* '^v0*[0-9]{1,12}$';

-- BandLab provenance is private. The public archive row keeps the media and
-- artist-facing metadata; revision URLs and backup internals stay admin-only.
create table if not exists public.archive_source_provenance (
  asset_id uuid primary key references public.archive_assets(id) on delete cascade,
  source_kind text not null default 'bandlab',
  source_project_id text not null default '',
  source_revision_id text not null,
  source_sha256 text not null default '',
  source_url text not null default '',
  source_metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create unique index if not exists archive_source_revision_unique
on public.archive_source_provenance(source_kind,source_revision_id);
create index if not exists archive_source_project_idx
on public.archive_source_provenance(source_kind,source_project_id);

create or replace function public.validate_archive_source_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.source_kind := lower(btrim(regexp_replace(coalesce(new.source_kind,''), '[[:cntrl:]<>]', '', 'g')));
  new.source_project_id := btrim(regexp_replace(coalesce(new.source_project_id,''), '[[:cntrl:]<>]', '', 'g'));
  new.source_revision_id := btrim(regexp_replace(coalesce(new.source_revision_id,''), '[[:cntrl:]<>]', '', 'g'));
  new.source_sha256 := upper(btrim(coalesce(new.source_sha256,'')));
  new.source_url := btrim(coalesce(new.source_url,''));
  new.source_metadata := coalesce(new.source_metadata,'{}'::jsonb);
  if new.source_kind <> 'bandlab'
     or char_length(new.source_project_id) > 180
     or char_length(new.source_revision_id) not between 1 and 180
     or char_length(new.source_url) > 2000 then
    raise exception 'invalid archive source identity';
  end if;
  if new.source_sha256 <> '' and new.source_sha256 !~ '^[A-F0-9]{64}$' then raise exception 'invalid source hash'; end if;
  if new.source_url <> '' and new.source_url !~ '^https://' then raise exception 'invalid source url'; end if;
  if jsonb_typeof(new.source_metadata) <> 'object' or octet_length(new.source_metadata::text) > 16000 then raise exception 'invalid source metadata'; end if;
  return new;
end;
$$;

drop trigger if exists archive_source_validation on public.archive_source_provenance;
create trigger archive_source_validation
before insert or update on public.archive_source_provenance
for each row execute function public.validate_archive_source_provenance();

-- Migrate any provenance created by an earlier setup draft, then scrub those
-- public columns so old revision links cannot leak through public reads.
insert into public.archive_source_provenance(
  asset_id,source_kind,source_project_id,source_revision_id,
  source_sha256,source_url,source_metadata,synced_at
)
select id,source_kind,source_project_id,source_revision_id,
  source_sha256,source_url,source_metadata,coalesce(source_synced_at,now())
from public.archive_assets
where coalesce(source_kind,'') = 'bandlab'
  and coalesce(source_revision_id,'') <> ''
on conflict (asset_id) do update set
  source_kind = excluded.source_kind,
  source_project_id = excluded.source_project_id,
  source_revision_id = excluded.source_revision_id,
  source_sha256 = excluded.source_sha256,
  source_url = excluded.source_url,
  source_metadata = excluded.source_metadata,
  synced_at = excluded.synced_at;

update public.archive_assets set
  source_kind = '', source_project_id = '', source_revision_id = '',
  source_sha256 = '', source_url = '', source_metadata = '{}'::jsonb,
  source_synced_at = null
where coalesce(source_kind,'') <> '';

-- Older prototypes allowed multitrack stem roles. The archive no longer has a
-- stem workflow, so preserve those files as ordinary song versions before the
-- stricter validation trigger is installed.
update public.archive_assets
set asset_role = 'version'
where asset_role like 'stem:%';

create index if not exists archive_assets_created_idx on public.archive_assets(created_at desc);
create index if not exists archive_assets_batch_order_idx on public.archive_assets(batch, sort_order);
create index if not exists archive_assets_type_idx on public.archive_assets(type);
create index if not exists archive_assets_project_idx on public.archive_assets(project_key);
drop index if exists public.archive_assets_exhibit_idx;
drop index if exists public.archive_assets_unlock_idx;
drop index if exists public.archive_capsules_unlock_idx;
drop index if exists public.archive_assets_source_project_idx;
drop index if exists public.archive_assets_source_revision_unique;

create or replace function public.validate_archive_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.title := btrim(regexp_replace(coalesce(new.title,''), '[[:cntrl:]<>]', '', 'g'));
  new.filename := btrim(regexp_replace(coalesce(new.filename,''), '[[:cntrl:]<>]', '', 'g'));
  new.project_key := lower(btrim(regexp_replace(coalesce(new.project_key,''), '[[:cntrl:]<>]', '', 'g')));
  new.world_title := btrim(regexp_replace(coalesce(new.world_title,''), '[[:cntrl:]<>]', '', 'g'));
  if coalesce(new.version,'') ~* '^v0*[0-9]{1,12}$' then
    new.version := 'v' || (substring(new.version from 2)::bigint)::text;
  end if;
  new.asset_role := coalesce(nullif(new.asset_role,''),'version');
  new.object_style := coalesce(nullif(new.object_style,''),'case');
  new.credits := coalesce(new.credits,'[]'::jsonb);
  -- Legacy source columns remain only for migration compatibility. New source
  -- data belongs in the admin-only archive_source_provenance table.
  new.source_kind := '';
  new.source_project_id := '';
  new.source_revision_id := '';
  new.source_sha256 := '';
  new.source_url := '';
  new.source_metadata := '{}'::jsonb;
  new.source_synced_at := null;
  new.mood_color := coalesce(nullif(new.mood_color,''),'#ffffff');
  new.world_summary := left(regexp_replace(coalesce(new.world_summary,''), '[[:cntrl:]]', '', 'g'), 4000);
  new.notes := left(coalesce(new.notes,''), 12000);
  new.synced_lyrics := left(coalesce(new.synced_lyrics,''), 40000);
  if char_length(new.title) not between 1 and 120
     or char_length(new.filename) > 260
     or char_length(new.project_key) > 100
     or char_length(new.world_title) > 120
     or char_length(new.source_kind) > 40
     or char_length(new.source_project_id) > 180
     or char_length(new.source_revision_id) > 180
     or char_length(coalesce(new.version,'')) > 24
     or char_length(coalesce(new.mood,'')) > 32 then
    raise exception 'invalid archive metadata length';
  end if;
  if new.type not in ('audio','image','video','text') then raise exception 'invalid archive type'; end if;
  if new.asset_role !~ '^(version|visual|note|artifact)$' then raise exception 'invalid archive role'; end if;
  if new.object_style not in ('case','notebook','tape','contact-sheet') then raise exception 'invalid object style'; end if;
  if new.source_kind not in ('','bandlab') then raise exception 'invalid archive source'; end if;
  if new.source_sha256 <> '' and new.source_sha256 !~ '^[A-F0-9]{64}$' then raise exception 'invalid source hash'; end if;
  if jsonb_typeof(new.source_metadata) <> 'object' or octet_length(new.source_metadata::text) > 16000 then raise exception 'invalid source metadata'; end if;
  if new.mood_color !~ '^#[0-9A-Fa-f]{6}$' then new.mood_color := '#ffffff'; end if;
  if jsonb_typeof(coalesce(new.credits,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(new.credits,'[]'::jsonb)) > 80 then raise exception 'invalid credits'; end if;
  if coalesce(new.file_url,'') <> '' and new.file_url !~ '^https://' then raise exception 'invalid file url'; end if;
  if coalesce(new.cover_url,'') <> '' and new.cover_url !~ '^https://' then raise exception 'invalid cover url'; end if;
  if coalesce(new.source_url,'') <> '' and new.source_url !~ '^https://' then raise exception 'invalid source url'; end if;
  return new;
end;
$$;

drop trigger if exists archive_asset_validation on public.archive_assets;
create trigger archive_asset_validation
before insert or update on public.archive_assets
for each row execute function public.validate_archive_asset();

-- Private enrichment review + accepted catalog metadata --------------------

create table if not exists public.archive_enrichment_suggestions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.archive_assets(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  model_name text not null default '',
  model_version text not null default '',
  source_revision_id text not null default '',
  source_sha256 text not null default '',
  cache_key text not null,
  status text not null default 'pending',
  review_note text not null default '',
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint archive_enrichment_kind_valid check (kind in ('lyrics','tags','audio_metadata','era')),
  constraint archive_enrichment_status_valid check (status in ('pending','draft','accepted','rejected','stale','needs_review')),
  constraint archive_enrichment_confidence_valid check (confidence between 0 and 1),
  constraint archive_enrichment_identity_unique unique(asset_id,kind,cache_key)
);

create table if not exists public.archive_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category text not null,
  description text not null default '',
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.archive_tag_aliases (
  alias_slug text primary key,
  alias text not null,
  tag_id uuid not null references public.archive_tags(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.archive_asset_tags (
  asset_id uuid not null references public.archive_assets(id) on delete cascade,
  tag_id uuid not null references public.archive_tags(id) on delete cascade,
  source text not null default 'manual',
  confidence numeric(4,3),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(asset_id,tag_id),
  constraint archive_asset_tag_source_valid check (source in ('manual','accepted_suggestion')),
  constraint archive_asset_tag_confidence_valid check (confidence is null or confidence between 0 and 1)
);

create table if not exists public.archive_audio_metadata (
  asset_id uuid primary key references public.archive_assets(id) on delete cascade,
  duration_seconds numeric(12,3),
  bitrate_kbps numeric(10,2),
  sample_rate_hz integer,
  channels smallint,
  estimated_bpm numeric(7,3),
  bpm_confidence numeric(4,3),
  estimated_musical_key text,
  key_confidence numeric(4,3),
  estimated_time_signature text,
  time_signature_confidence numeric(4,3),
  integrated_loudness_lufs numeric(7,3),
  tempo_category text,
  detected_language text,
  vocal_instrumental_status text,
  analysis_features jsonb not null default '{}'::jsonb,
  source text not null default 'accepted_suggestion',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.archive_audio_metadata
  add column if not exists analysis_features jsonb not null default '{}'::jsonb;

create table if not exists public.archive_eras (
  id uuid primary key default gen_random_uuid(),
  parent_era_id uuid references public.archive_eras(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text not null default '',
  notes text not null default '',
  start_date date,
  end_date date,
  display_order integer not null default 0,
  cover_url text not null default '',
  cover_storage_path text not null default '',
  accent_color text not null default '#ffffff',
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.archive_eras
  add column if not exists parent_era_id uuid references public.archive_eras(id) on delete set null;
alter table public.archive_eras
  add column if not exists notes text not null default '';

create table if not exists public.archive_asset_eras (
  asset_id uuid not null references public.archive_assets(id) on delete cascade,
  era_id uuid not null references public.archive_eras(id) on delete cascade,
  relationship text not null default 'primary',
  source text not null default 'manual',
  confidence numeric(4,3),
  review_status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(asset_id,era_id),
  constraint archive_asset_era_relationship_valid check (relationship in ('primary','secondary')),
  constraint archive_asset_era_source_valid check (source in ('manual','accepted_suggestion')),
  constraint archive_asset_era_review_valid check (review_status in ('confirmed','suggested','rejected')),
  constraint archive_asset_era_confidence_valid check (confidence is null or confidence between 0 and 1)
);

-- Suggestion evidence and model provenance remain private even when an era
-- relationship is accepted. The public relationship table contains only the
-- bounded artist-facing assignment.
create table if not exists public.archive_asset_era_provenance (
  asset_id uuid not null,
  era_id uuid not null,
  evidence jsonb not null default '{}'::jsonb,
  model_name text not null default '',
  model_version text not null default '',
  suggestion_id uuid references public.archive_enrichment_suggestions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(asset_id,era_id),
  foreign key(asset_id,era_id) references public.archive_asset_eras(asset_id,era_id) on delete cascade
);

create index if not exists archive_enrichment_review_idx
on public.archive_enrichment_suggestions(status,kind,created_at desc);
create index if not exists archive_enrichment_asset_idx
on public.archive_enrichment_suggestions(asset_id,updated_at desc);
create index if not exists archive_enrichment_source_idx
on public.archive_enrichment_suggestions(source_revision_id,source_sha256);
create index if not exists archive_tags_category_idx on public.archive_tags(category,slug);
create index if not exists archive_tag_alias_target_idx on public.archive_tag_aliases(tag_id);
create index if not exists archive_asset_tags_tag_idx on public.archive_asset_tags(tag_id,asset_id);
create index if not exists archive_eras_order_idx on public.archive_eras(display_order,name);
create index if not exists archive_eras_parent_order_idx on public.archive_eras(parent_era_id,display_order,name);
create index if not exists archive_asset_eras_era_idx on public.archive_asset_eras(era_id,asset_id);
create unique index if not exists archive_asset_primary_era_unique
on public.archive_asset_eras(asset_id)
where relationship = 'primary' and review_status = 'confirmed';

create or replace function public.archive_slug(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]+', '-', 'g')),80);
$$;

create or replace function public.is_akrasia_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com';
$$;

create or replace function public.validate_archive_enrichment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.model_name := left(btrim(regexp_replace(coalesce(new.model_name,''),'[[:cntrl:]<>]','','g')),120);
  new.model_version := left(btrim(regexp_replace(coalesce(new.model_version,''),'[[:cntrl:]<>]','','g')),160);
  new.source_revision_id := left(btrim(regexp_replace(coalesce(new.source_revision_id,''),'[[:cntrl:]<>]','','g')),180);
  new.source_sha256 := upper(btrim(coalesce(new.source_sha256,'')));
  new.cache_key := left(btrim(regexp_replace(coalesce(new.cache_key,''),'[[:cntrl:]<>]','','g')),180);
  new.review_note := left(regexp_replace(coalesce(new.review_note,''),'[[:cntrl:]]','','g'),2000);
  new.payload := coalesce(new.payload,'{}'::jsonb);
  new.evidence := coalesce(new.evidence,'{}'::jsonb);
  if jsonb_typeof(new.payload) <> 'object' or octet_length(new.payload::text) > 2000000 then raise exception 'invalid enrichment payload'; end if;
  if jsonb_typeof(new.evidence) <> 'object' or octet_length(new.evidence::text) > 32000 then raise exception 'invalid enrichment evidence'; end if;
  if char_length(new.cache_key) not between 8 and 180 then raise exception 'invalid enrichment cache key'; end if;
  if new.source_sha256 <> '' and new.source_sha256 !~ '^[A-F0-9]{64}$' then raise exception 'invalid enrichment source hash'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists archive_enrichment_validation on public.archive_enrichment_suggestions;
create trigger archive_enrichment_validation
before insert or update on public.archive_enrichment_suggestions
for each row execute function public.validate_archive_enrichment();

create or replace function public.validate_archive_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := left(btrim(regexp_replace(coalesce(new.name,''),'[[:cntrl:]<>]','','g')),80);
  new.slug := public.archive_slug(coalesce(nullif(new.slug,''),new.name));
  new.category := public.archive_slug(new.category);
  new.description := left(regexp_replace(coalesce(new.description,''),'[[:cntrl:]]','','g'),1000);
  if char_length(new.name) not between 1 and 80 or char_length(new.slug) not between 1 and 80 then raise exception 'invalid tag name'; end if;
  if new.category not in ('mood','vibe','genre','subgenre','lyrical-theme','production-style','vocal-style','instrumentation','listening-situation','time-of-day','weather-season','energy','narrative-tone','completion-state','release-state') then raise exception 'invalid tag category'; end if;
  if new.visibility not in ('public','private','hidden') then raise exception 'invalid tag visibility'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists archive_tag_validation on public.archive_tags;
create trigger archive_tag_validation before insert or update on public.archive_tags
for each row execute function public.validate_archive_tag();

create or replace function public.validate_archive_tag_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.alias := left(btrim(regexp_replace(coalesce(new.alias,''),'[[:cntrl:]<>]','','g')),80);
  new.alias_slug := public.archive_slug(coalesce(nullif(new.alias_slug,''),new.alias));
  if char_length(new.alias) not between 1 and 80 or char_length(new.alias_slug) not between 1 and 80 then raise exception 'invalid tag alias'; end if;
  return new;
end;
$$;

drop trigger if exists archive_tag_alias_validation on public.archive_tag_aliases;
create trigger archive_tag_alias_validation before insert or update on public.archive_tag_aliases
for each row execute function public.validate_archive_tag_alias();

create or replace function public.validate_archive_audio_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.estimated_musical_key := left(btrim(regexp_replace(coalesce(new.estimated_musical_key,''),'[[:cntrl:]<>]','','g')),40);
  new.estimated_time_signature := left(btrim(regexp_replace(coalesce(new.estimated_time_signature,''),'[[:cntrl:]<>]','','g')),20);
  new.tempo_category := left(public.archive_slug(new.tempo_category),32);
  new.detected_language := left(public.archive_slug(new.detected_language),24);
  new.vocal_instrumental_status := left(public.archive_slug(new.vocal_instrumental_status),32);
  if new.duration_seconds is not null and (new.duration_seconds < 0 or new.duration_seconds > 86400) then raise exception 'invalid duration'; end if;
  if new.bitrate_kbps is not null and (new.bitrate_kbps < 0 or new.bitrate_kbps > 100000) then raise exception 'invalid bitrate'; end if;
  if new.estimated_bpm is not null and (new.estimated_bpm < 20 or new.estimated_bpm > 400) then raise exception 'invalid bpm'; end if;
  if new.sample_rate_hz is not null and (new.sample_rate_hz < 1000 or new.sample_rate_hz > 768000) then raise exception 'invalid sample rate'; end if;
  if new.channels is not null and (new.channels < 1 or new.channels > 64) then raise exception 'invalid channels'; end if;
  if new.bpm_confidence is not null and new.bpm_confidence not between 0 and 1 then raise exception 'invalid bpm confidence'; end if;
  if new.key_confidence is not null and new.key_confidence not between 0 and 1 then raise exception 'invalid key confidence'; end if;
  if new.time_signature_confidence is not null and new.time_signature_confidence not between 0 and 1 then raise exception 'invalid time signature confidence'; end if;
  if new.integrated_loudness_lufs is not null and (new.integrated_loudness_lufs < -100 or new.integrated_loudness_lufs > 20) then raise exception 'invalid loudness'; end if;
  if new.estimated_time_signature <> '' and new.estimated_time_signature !~ '^[0-9]{1,2}/[0-9]{1,2}$' then raise exception 'invalid time signature'; end if;
  if new.tempo_category not in ('','unknown','slow','midtempo','upbeat','fast') then raise exception 'invalid tempo category'; end if;
  if new.vocal_instrumental_status not in ('','unknown','vocal','instrumental','mixed') then raise exception 'invalid vocal status'; end if;
  new.analysis_features := coalesce(new.analysis_features,'{}'::jsonb);
  if jsonb_typeof(new.analysis_features) <> 'object' or octet_length(new.analysis_features::text) > 16000 then raise exception 'invalid analysis features'; end if;
  if new.source not in ('manual','accepted_suggestion') then raise exception 'invalid metadata source'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists archive_audio_metadata_validation on public.archive_audio_metadata;
create trigger archive_audio_metadata_validation before insert or update on public.archive_audio_metadata
for each row execute function public.validate_archive_audio_metadata();

create or replace function public.validate_archive_era()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := left(btrim(regexp_replace(coalesce(new.name,''),'[[:cntrl:]<>]','','g')),100);
  new.slug := public.archive_slug(coalesce(nullif(new.slug,''),new.name));
  new.description := left(regexp_replace(coalesce(new.description,''),'[[:cntrl:]]','','g'),4000);
  new.notes := left(replace(coalesce(new.notes,''),E'\r',''),12000);
  new.cover_url := left(btrim(coalesce(new.cover_url,'')),2000);
  new.cover_storage_path := left(btrim(regexp_replace(coalesce(new.cover_storage_path,''),'[[:cntrl:]<>]','','g')),500);
  if char_length(new.name) not between 1 and 100 or char_length(new.slug) not between 1 and 80 then raise exception 'invalid era identity'; end if;
  if new.start_date is not null and new.end_date is not null and new.start_date > new.end_date then raise exception 'era dates are reversed'; end if;
  if new.accent_color !~ '^#[0-9A-Fa-f]{6}$' then new.accent_color := '#ffffff'; end if;
  if new.visibility not in ('public','private','hidden') then raise exception 'invalid era visibility'; end if;
  if new.cover_url <> '' and new.cover_url !~ '^https://' then raise exception 'invalid era cover url'; end if;
  if new.cover_storage_path ~ '(^/|(^|/)\.\.(/|$)|\\)' then raise exception 'invalid era cover storage path'; end if;
  if new.display_order < -100000 or new.display_order > 100000 then raise exception 'invalid era display order'; end if;
  if new.parent_era_id = new.id then raise exception 'an era cannot contain itself'; end if;
  if new.parent_era_id is not null and not exists(
    select 1 from public.archive_eras where id = new.parent_era_id
  ) then
    raise exception 'parent era not found';
  end if;
  if new.parent_era_id is not null and exists(
    with recursive era_ancestors as (
      select id,parent_era_id
      from public.archive_eras
      where id = new.parent_era_id
      union all
      select parent.id,parent.parent_era_id
      from public.archive_eras parent
      join era_ancestors child on parent.id = child.parent_era_id
    )
    select 1 from era_ancestors where id = new.id
  ) then
    raise exception 'era hierarchy cycle detected';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists archive_era_validation on public.archive_eras;
create trigger archive_era_validation before insert or update on public.archive_eras
for each row execute function public.validate_archive_era();

create or replace function public.touch_archive_enrichment_relation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists archive_asset_tags_touch on public.archive_asset_tags;
create trigger archive_asset_tags_touch before update on public.archive_asset_tags
for each row execute function public.touch_archive_enrichment_relation();
drop trigger if exists archive_asset_eras_touch on public.archive_asset_eras;
create trigger archive_asset_eras_touch before update on public.archive_asset_eras
for each row execute function public.touch_archive_enrichment_relation();
drop trigger if exists archive_asset_era_provenance_touch on public.archive_asset_era_provenance;
create trigger archive_asset_era_provenance_touch before update on public.archive_asset_era_provenance
for each row execute function public.touch_archive_enrichment_relation();

-- Live broadcast state ------------------------------------------------------

create table if not exists public.archive_live_state (
  room_id text primary key default 'main',
  is_live boolean not null default false,
  asset_key text,
  title text default 'live room',
  type text default 'none',
  version text default '',
  folder text default 'archive',
  mood text default 'live',
  mood_color text default '#ffffff',
  notes text default '',
  lyrics text default '',
  cover text default '',
  file_url text default '',
  position double precision not null default 0,
  playing boolean not null default false,
  queue jsonb not null default '[]'::jsonb,
  queue_index integer not null default -1,
  queue_length integer not null default 0,
  countdown_target timestamptz,
  countdown_action text not null default 'room',
  countdown_auto_start boolean not null default false,
  live_notes text,
  live_cover text,
  scene text not null default 'stage',
  updated_at timestamptz not null default now()
);

alter table public.archive_live_state add column if not exists is_live boolean default false;
alter table public.archive_live_state add column if not exists asset_key text;
alter table public.archive_live_state add column if not exists title text default 'live room';
alter table public.archive_live_state add column if not exists type text default 'none';
alter table public.archive_live_state add column if not exists version text default '';
alter table public.archive_live_state add column if not exists folder text default 'archive';
alter table public.archive_live_state add column if not exists mood text default 'live';
alter table public.archive_live_state add column if not exists mood_color text default '#ffffff';
alter table public.archive_live_state add column if not exists notes text default '';
alter table public.archive_live_state add column if not exists lyrics text default '';
alter table public.archive_live_state add column if not exists cover text default '';
alter table public.archive_live_state add column if not exists file_url text default '';
alter table public.archive_live_state add column if not exists position double precision default 0;
alter table public.archive_live_state add column if not exists playing boolean default false;
alter table public.archive_live_state add column if not exists queue jsonb default '[]'::jsonb;
alter table public.archive_live_state add column if not exists queue_index integer default -1;
alter table public.archive_live_state add column if not exists queue_length integer default 0;
alter table public.archive_live_state add column if not exists countdown_target timestamptz;
alter table public.archive_live_state add column if not exists countdown_action text default 'room';
alter table public.archive_live_state add column if not exists countdown_auto_start boolean default false;
alter table public.archive_live_state add column if not exists live_notes text;
alter table public.archive_live_state add column if not exists live_cover text;
alter table public.archive_live_state add column if not exists scene text default 'stage';
alter table public.archive_live_state add column if not exists updated_at timestamptz default now();

create unique index if not exists archive_live_state_room_key on public.archive_live_state(room_id);
insert into public.archive_live_state(room_id,is_live) values ('main',false)
on conflict (room_id) do nothing;

-- Chat, moderation, announcements, and private live queue ------------------

create table if not exists public.live_chat (
  id uuid primary key default gen_random_uuid(),
  room_id text not null default 'main',
  username text not null,
  message text not null,
  user_token text not null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.live_banned_tokens (
  user_token text primary key,
  username text default '',
  banned_at timestamptz not null default now(),
  reason text default 'ban',
  expires_at timestamptz
);

create table if not exists public.live_announcements (
  id uuid primary key default gen_random_uuid(),
  room_id text not null default 'main',
  message text not null,
  subtitle text default '',
  kind text not null default 'normal',
  is_pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.private_live_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text default '',
  type text not null,
  folder text not null default 'private live',
  mood_color text not null default '#ffffff',
  file_url text,
  cover_url text,
  storage_path text not null default '',
  cover_storage_path text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.play_counts (
  asset_key text primary key,
  play_count integer not null default 0,
  last_played timestamptz not null default now()
);

create table if not exists public.archive_changelog (
  id bigint generated by default as identity primary key,
  asset_id uuid,
  action text not null check (action in ('indexed','updated','removed')),
  title text not null default 'archive item',
  changed_fields text[] not null default '{}',
  happened_at timestamptz not null default now()
);

create table if not exists public.live_premieres (
  id uuid primary key default gen_random_uuid(),
  room_id text not null default 'main' check (room_id = 'main'),
  title text not null default 'akrasia premiere',
  starts_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','live','ended','cancelled')),
  queue jsonb not null default '[]'::jsonb,
  queue_length integer not null default 0 check (queue_length between 0 and 200),
  cover text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists archive_changelog_time_idx on public.archive_changelog(happened_at desc);
create index if not exists live_premieres_start_idx on public.live_premieres(starts_at);

-- Retire the old capsule synchronizer without deleting any legacy table data.
drop trigger if exists archive_capsule_sync on public.archive_assets;
drop function if exists public.sync_archive_capsule();
do $$
declare p record;
begin
  if to_regclass('public.archive_capsules') is not null then
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'archive_capsules'
    loop
      execute format('drop policy if exists %I on public.archive_capsules',p.policyname);
    end loop;
    execute 'revoke all on table public.archive_capsules from anon, authenticated';
  end if;
end $$;

create or replace function public.track_archive_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.archive_changelog(asset_id,action,title,changed_fields) values(new.id,'indexed',new.title,array['created']);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.archive_changelog(asset_id,action,title,changed_fields) values(old.id,'removed',old.title,array['removed']);
    return old;
  end if;
  select coalesce(array_agg(key order by key),'{}') into fields
  from jsonb_each(to_jsonb(new)) entry
  where (to_jsonb(old)->entry.key) is distinct from entry.value
    and entry.key not in ('file_url','cover_url','storage_path','cover_storage_path','text_content','updated_at');
  if cardinality(fields) > 0 then
    insert into public.archive_changelog(asset_id,action,title,changed_fields) values(new.id,'updated',new.title,fields);
  end if;
  return new;
end;
$$;

drop trigger if exists archive_change_tracking on public.archive_assets;
create trigger archive_change_tracking after insert or update or delete on public.archive_assets
for each row execute function public.track_archive_change();

create or replace function public.validate_live_premiere()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.title := btrim(regexp_replace(coalesce(new.title,''), '[[:cntrl:]<>]', '', 'g'));
  if char_length(new.title) not between 1 and 120 then raise exception 'invalid premiere title'; end if;
  if jsonb_typeof(new.queue) <> 'array' or jsonb_array_length(new.queue) > 200 then raise exception 'invalid premiere queue'; end if;
  new.queue_length := jsonb_array_length(new.queue);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists live_premiere_validation on public.live_premieres;
create trigger live_premiere_validation before insert or update on public.live_premieres
for each row execute function public.validate_live_premiere();

create index if not exists live_chat_room_idx on public.live_chat(room_id, created_at);
create index if not exists live_chat_token_time_idx on public.live_chat(user_token, created_at desc);
create index if not exists live_announcements_room_idx on public.live_announcements(room_id, created_at desc);

-- Protected RPCs ------------------------------------------------------------

create or replace function public.is_live_chat_blocked(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.live_banned_tokens
    where user_token = p_token
      and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.enforce_live_chat_safety()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stable_username text;
begin
  new.room_id := 'main';
  new.username := btrim(regexp_replace(new.username, '[[:cntrl:]]', '', 'g'));
  new.message := btrim(regexp_replace(new.message, '[[:cntrl:]]', '', 'g'));

  if char_length(new.username) not between 1 and 24
     or char_length(new.message) not between 1 and 280
     or char_length(coalesce(new.user_token,'')) not between 16 and 128
     or new.user_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'invalid chat payload';
  end if;

  select username into stable_username
  from public.live_chat
  where user_token = new.user_token
  order by created_at asc, id asc
  limit 1;
  if stable_username is not null then
    new.username := stable_username;
  end if;

  if public.is_live_chat_blocked(new.user_token) then
    raise exception 'chat access blocked';
  end if;

  if exists(
    select 1 from public.live_chat
    where user_token = new.user_token
      and created_at > now() - interval '2 seconds'
  ) then
    raise exception 'chat rate limit';
  end if;

  return new;
end;
$$;

drop trigger if exists live_chat_safety on public.live_chat;
create trigger live_chat_safety
before insert on public.live_chat
for each row execute function public.enforce_live_chat_safety();

create or replace function public.public_live_chat_history()
returns table(
  id uuid,
  room_id text,
  username text,
  message text,
  is_hidden boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,c.room_id,c.username,c.message,c.is_hidden,c.created_at
  from public.live_chat c
  where c.room_id = 'main' and c.is_hidden = false
  order by c.created_at desc
  limit 100;
$$;

create or replace function public.post_live_chat(
  p_username text,
  p_message text,
  p_token text
)
returns table(
  id uuid,
  room_id text,
  username text,
  message text,
  is_hidden boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  insert into public.live_chat(room_id,username,message,user_token)
  values ('main',p_username,p_message,p_token)
  returning live_chat.id,live_chat.room_id,live_chat.username,
            live_chat.message,live_chat.is_hidden,live_chat.created_at;
$$;

create or replace function public.increment_play_count(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.play_counts(asset_key,play_count,last_played)
  select btrim(p_key),1,now()
  where char_length(btrim(coalesce(p_key,''))) between 1 and 180
    and p_key ~ '^[A-Za-z0-9:_./ -]+$'
  on conflict (asset_key) do update
  set play_count = play_counts.play_count + 1,
      last_played = now();
$$;

create or replace function public.review_archive_enrichment(
  p_suggestion_id uuid,
  p_status text,
  p_payload jsonb default null,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_akrasia_admin() then raise exception 'admin access required'; end if;
  if p_status not in ('pending','draft','rejected','stale','needs_review') then raise exception 'invalid review status'; end if;
  update public.archive_enrichment_suggestions
  set status = p_status,
      payload = case when p_payload is null then payload else p_payload end,
      review_note = left(regexp_replace(coalesce(p_note,''),'[[:cntrl:]]','','g'),2000),
      reviewed_at = case when p_status in ('rejected','stale') then now() else null end,
      reviewed_by = case when p_status in ('rejected','stale') then auth.uid() else null end
  where id = p_suggestion_id;
  if not found then raise exception 'suggestion not found'; end if;
end;
$$;

create or replace function public.accept_archive_lyrics(
  p_suggestion_id uuid,
  p_synced_text text,
  p_replace_existing boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  suggestion public.archive_enrichment_suggestions%rowtype;
  current_lyrics text;
  clean_lyrics text;
begin
  if not public.is_akrasia_admin() then raise exception 'admin access required'; end if;
  select * into suggestion from public.archive_enrichment_suggestions where id = p_suggestion_id for update;
  if not found or suggestion.kind <> 'lyrics' then raise exception 'lyrics suggestion not found'; end if;
  if suggestion.status = 'stale' then raise exception 'stale lyrics must be regenerated or explicitly reopened'; end if;
  -- PostgreSQL text cannot contain U+0000, and evaluating chr(0) itself raises
  -- "null character not permitted". The browser strips control bytes before
  -- this RPC call, while PostgreSQL rejects an invalid wire value on its own.
  clean_lyrics := left(coalesce(p_synced_text,''),40000);
  select coalesce(synced_lyrics,'') into current_lyrics from public.archive_assets where id = suggestion.asset_id for update;
  if current_lyrics <> '' and current_lyrics is distinct from clean_lyrics and not p_replace_existing then
    raise exception 'accepted lyrics already exist; compare and confirm replacement';
  end if;
  update public.archive_assets set synced_lyrics = clean_lyrics where id = suggestion.asset_id;
  update public.archive_enrichment_suggestions
  set status = 'accepted',
      payload = jsonb_set(payload,'{syncedText}',to_jsonb(clean_lyrics),true),
      reviewed_at = now(), reviewed_by = auth.uid(), review_note = ''
  where id = suggestion.id;
end;
$$;

create or replace function public.accept_archive_audio_metadata(
  p_suggestion_id uuid,
  p_values jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare suggestion public.archive_enrichment_suggestions%rowtype;
begin
  if not public.is_akrasia_admin() then raise exception 'admin access required'; end if;
  if jsonb_typeof(coalesce(p_values,'{}'::jsonb)) <> 'object' or octet_length(coalesce(p_values,'{}'::jsonb)::text) > 32000 then raise exception 'invalid metadata review payload'; end if;
  select * into suggestion from public.archive_enrichment_suggestions where id = p_suggestion_id for update;
  if not found or suggestion.kind <> 'audio_metadata' then raise exception 'audio metadata suggestion not found'; end if;
  if suggestion.status = 'stale' then raise exception 'stale metadata must be regenerated or explicitly reopened'; end if;
  insert into public.archive_audio_metadata(
    asset_id,duration_seconds,bitrate_kbps,sample_rate_hz,channels,
    estimated_bpm,bpm_confidence,estimated_musical_key,key_confidence,
    estimated_time_signature,time_signature_confidence,integrated_loudness_lufs,
    tempo_category,detected_language,vocal_instrumental_status,analysis_features,source
  ) values (
    suggestion.asset_id,
    nullif(p_values->>'durationSeconds','')::numeric,
    nullif(p_values->>'bitrateKbps','')::numeric,
    nullif(p_values->>'sampleRateHz','')::integer,
    nullif(p_values->>'channels','')::smallint,
    nullif(p_values->>'estimatedBpm','')::numeric,
    nullif(p_values->>'bpmConfidence','')::numeric,
    nullif(p_values->>'estimatedMusicalKey',''),
    nullif(p_values->>'keyConfidence','')::numeric,
    nullif(p_values->>'estimatedTimeSignature',''),
    nullif(p_values->>'timeSignatureConfidence','')::numeric,
    nullif(p_values->>'integratedLoudnessLufs','')::numeric,
    nullif(p_values->>'tempoCategory',''),
    nullif(p_values->>'detectedLanguage',''),
    nullif(p_values->>'vocalInstrumentalStatus',''),
    jsonb_strip_nulls(jsonb_build_object(
      'rmsMeanDb', nullif(p_values->>'rmsMeanDb','')::numeric,
      'rmsStdDb', nullif(p_values->>'rmsStdDb','')::numeric,
      'dynamicRangeDb', nullif(p_values->>'dynamicRangeDb','')::numeric,
      'onsetRatePerSecond', nullif(p_values->>'onsetRatePerSecond','')::numeric,
      'spectralCentroidHz', nullif(p_values->>'spectralCentroidHz','')::numeric,
      'spectralBandwidthHz', nullif(p_values->>'spectralBandwidthHz','')::numeric,
      'zeroCrossingRate', nullif(p_values->>'zeroCrossingRate','')::numeric,
      'energyScore', nullif(p_values->>'energyScore','')::numeric,
      'energyConfidence', nullif(p_values->>'energyConfidence','')::numeric
    )),
    'accepted_suggestion'
  )
  on conflict(asset_id) do update set
    duration_seconds=excluded.duration_seconds, bitrate_kbps=excluded.bitrate_kbps,
    sample_rate_hz=excluded.sample_rate_hz, channels=excluded.channels,
    estimated_bpm=excluded.estimated_bpm, bpm_confidence=excluded.bpm_confidence,
    estimated_musical_key=excluded.estimated_musical_key, key_confidence=excluded.key_confidence,
    estimated_time_signature=excluded.estimated_time_signature,
    time_signature_confidence=excluded.time_signature_confidence,
    integrated_loudness_lufs=excluded.integrated_loudness_lufs,
    tempo_category=excluded.tempo_category, detected_language=excluded.detected_language,
    vocal_instrumental_status=excluded.vocal_instrumental_status,
    analysis_features=excluded.analysis_features, source=excluded.source;
  update public.archive_enrichment_suggestions
  set status='accepted',payload=p_values,reviewed_at=now(),reviewed_by=auth.uid(),review_note=''
  where id=suggestion.id;
end;
$$;

create or replace function public.accept_archive_tags(
  p_suggestion_id uuid,
  p_tags jsonb,
  p_apply_mood boolean default false,
  p_primary_mood text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  suggestion public.archive_enrichment_suggestions%rowtype;
  item jsonb;
  tag_id_value uuid;
  tag_slug text;
  tag_name text;
  tag_category text;
  existing_category text;
  tag_confidence numeric;
  accepted_count integer := 0;
begin
  if not public.is_akrasia_admin() then raise exception 'admin access required'; end if;
  if jsonb_typeof(coalesce(p_tags,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_tags,'[]'::jsonb)) > 80 then raise exception 'invalid accepted tag list'; end if;
  select * into suggestion from public.archive_enrichment_suggestions where id = p_suggestion_id for update;
  if not found or suggestion.kind <> 'tags' then raise exception 'tag suggestion not found'; end if;
  if suggestion.status = 'stale' then raise exception 'stale tags must be regenerated or explicitly reopened'; end if;
  for item in select value from jsonb_array_elements(p_tags)
  loop
    tag_name := left(btrim(coalesce(item->>'name',item->>'value','')),80);
    tag_slug := public.archive_slug(coalesce(item->>'slug',tag_name));
    tag_category := public.archive_slug(item->>'category');
    tag_confidence := case when coalesce(item->>'confidence','') ~ '^(0(\.\d+)?|1(\.0+)?)$' then (item->>'confidence')::numeric else null end;
    if tag_slug = '' or tag_category = '' then continue; end if;
    insert into public.archive_tags(name,slug,category,visibility)
    values (coalesce(nullif(tag_name,''),replace(tag_slug,'-',' ')),tag_slug,tag_category,'public')
    on conflict(slug) do nothing;
    select id,category into tag_id_value,existing_category from public.archive_tags where slug = tag_slug;
    if tag_id_value is null then continue; end if;
    if existing_category <> tag_category then raise exception 'accepted tag conflicts with an existing category'; end if;
    insert into public.archive_asset_tags(asset_id,tag_id,source,confidence,is_primary)
    values (suggestion.asset_id,tag_id_value,'accepted_suggestion',tag_confidence,false)
    on conflict(asset_id,tag_id) do update set
      source='accepted_suggestion',confidence=excluded.confidence;
    accepted_count := accepted_count + 1;
  end loop;
  if p_apply_mood and coalesce(p_primary_mood,'') <> '' and exists(
    select 1 from public.archive_asset_tags relation
    join public.archive_tags tag on tag.id=relation.tag_id
    where relation.asset_id=suggestion.asset_id and tag.category='mood'
      and tag.slug=public.archive_slug(p_primary_mood)
  ) then
    update public.archive_assets set mood=public.archive_slug(p_primary_mood) where id=suggestion.asset_id;
  end if;
  update public.archive_enrichment_suggestions
  set status='accepted',payload=jsonb_build_object('suggestions',p_tags,'acceptedCount',accepted_count),
      reviewed_at=now(),reviewed_by=auth.uid(),review_note=''
  where id=suggestion.id;
end;
$$;

create or replace function public.accept_archive_era(
  p_suggestion_id uuid,
  p_era_id uuid,
  p_relationship text default 'primary'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare suggestion public.archive_enrichment_suggestions%rowtype;
begin
  if not public.is_akrasia_admin() then raise exception 'admin access required'; end if;
  if p_relationship not in ('primary','secondary') then raise exception 'invalid era relationship'; end if;
  if not exists(select 1 from public.archive_eras where id=p_era_id) then raise exception 'era not found'; end if;
  select * into suggestion from public.archive_enrichment_suggestions where id=p_suggestion_id for update;
  if not found or suggestion.kind <> 'era' then raise exception 'era suggestion not found'; end if;
  if suggestion.status = 'stale' then raise exception 'stale era suggestion must be explicitly reopened'; end if;
  if p_relationship='primary' then
    update public.archive_asset_eras set relationship='secondary'
    where asset_id=suggestion.asset_id and relationship='primary' and review_status='confirmed' and era_id<>p_era_id;
  end if;
  insert into public.archive_asset_eras(asset_id,era_id,relationship,source,confidence,review_status)
  values(suggestion.asset_id,p_era_id,p_relationship,'accepted_suggestion',suggestion.confidence,'confirmed')
  on conflict(asset_id,era_id) do update set
    relationship=excluded.relationship,source=excluded.source,
    confidence=excluded.confidence,review_status='confirmed';
  insert into public.archive_asset_era_provenance(asset_id,era_id,evidence,model_name,model_version,suggestion_id)
  values(suggestion.asset_id,p_era_id,suggestion.evidence,suggestion.model_name,suggestion.model_version,suggestion.id)
  on conflict(asset_id,era_id) do update set
    evidence=excluded.evidence,model_name=excluded.model_name,
    model_version=excluded.model_version,suggestion_id=excluded.suggestion_id;
  update public.archive_enrichment_suggestions
  set status='accepted',reviewed_at=now(),reviewed_by=auth.uid(),review_note=''
  where id=suggestion.id;
end;
$$;

create or replace function public.merge_archive_tags(p_source_tag uuid,p_target_tag uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_akrasia_admin() then raise exception 'admin access required'; end if;
  if p_source_tag=p_target_tag or not exists(select 1 from public.archive_tags where id=p_source_tag)
     or not exists(select 1 from public.archive_tags where id=p_target_tag) then raise exception 'invalid tag merge'; end if;
  insert into public.archive_asset_tags(asset_id,tag_id,source,confidence,is_primary)
  select asset_id,p_target_tag,source,confidence,is_primary from public.archive_asset_tags where tag_id=p_source_tag
  on conflict(asset_id,tag_id) do update set
    confidence=greatest(public.archive_asset_tags.confidence,excluded.confidence),
    is_primary=public.archive_asset_tags.is_primary or excluded.is_primary;
  update public.archive_tag_aliases set tag_id=p_target_tag where tag_id=p_source_tag;
  insert into public.archive_tag_aliases(alias_slug,alias,tag_id)
  select slug,name,p_target_tag from public.archive_tags where id=p_source_tag
  on conflict(alias_slug) do update set tag_id=excluded.tag_id;
  delete from public.archive_tags where id=p_source_tag;
end;
$$;

-- Row-level security --------------------------------------------------------

alter table public.archive_assets enable row level security;
alter table public.archive_folders enable row level security;
alter table public.archive_source_provenance enable row level security;
alter table public.archive_enrichment_suggestions enable row level security;
alter table public.archive_tags enable row level security;
alter table public.archive_tag_aliases enable row level security;
alter table public.archive_asset_tags enable row level security;
alter table public.archive_audio_metadata enable row level security;
alter table public.archive_eras enable row level security;
alter table public.archive_asset_eras enable row level security;
alter table public.archive_asset_era_provenance enable row level security;
alter table public.archive_live_state enable row level security;
alter table public.live_chat enable row level security;
alter table public.live_banned_tokens enable row level security;
alter table public.live_announcements enable row level security;
alter table public.private_live_items enable row level security;
alter table public.play_counts enable row level security;
alter table public.archive_changelog enable row level security;
alter table public.live_premieres enable row level security;

do $$
declare p record;
begin
  for p in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'archive_assets','archive_folders','archive_source_provenance',
        'archive_enrichment_suggestions','archive_tags','archive_tag_aliases',
        'archive_asset_tags','archive_audio_metadata','archive_eras','archive_asset_eras',
        'archive_asset_era_provenance','archive_live_state','live_chat',
        'live_banned_tokens','live_announcements',
        'private_live_items','play_counts',
        'archive_changelog','live_premieres'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      p.policyname,p.schemaname,p.tablename
    );
  end loop;
end $$;

create policy "public archive read"
on public.archive_assets for select to anon,authenticated
using (true);

create policy "admin archive manage"
on public.archive_assets for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "public archive folders read"
on public.archive_folders for select to anon,authenticated
using (true);

create policy "admin archive folders manage"
on public.archive_folders for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "admin archive source manage"
on public.archive_source_provenance for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "admin enrichment suggestions manage"
on public.archive_enrichment_suggestions for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "public visible tags read"
on public.archive_tags for select to anon,authenticated
using (visibility = 'public');

create policy "admin tags manage"
on public.archive_tags for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "public visible tag aliases read"
on public.archive_tag_aliases for select to anon,authenticated
using (exists(
  select 1 from public.archive_tags tag
  where tag.id=archive_tag_aliases.tag_id and tag.visibility='public'
));

create policy "admin tag aliases manage"
on public.archive_tag_aliases for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "public accepted asset tags read"
on public.archive_asset_tags for select to anon,authenticated
using (exists(
  select 1 from public.archive_tags tag
  where tag.id=archive_asset_tags.tag_id and tag.visibility='public'
));

create policy "admin asset tags manage"
on public.archive_asset_tags for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "public audio metadata read"
on public.archive_audio_metadata for select to anon,authenticated
using (true);

create policy "admin audio metadata manage"
on public.archive_audio_metadata for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "public visible eras read"
on public.archive_eras for select to anon,authenticated
using (visibility = 'public');

create policy "admin eras manage"
on public.archive_eras for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "public confirmed asset eras read"
on public.archive_asset_eras for select to anon,authenticated
using (
  review_status='confirmed'
  and exists(
    select 1 from public.archive_eras era
    where era.id=archive_asset_eras.era_id and era.visibility='public'
  )
);

create policy "admin asset eras manage"
on public.archive_asset_eras for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "admin era provenance manage"
on public.archive_asset_era_provenance for all to authenticated
using (public.is_akrasia_admin())
with check (public.is_akrasia_admin());

create policy "public live state read"
on public.archive_live_state for select to anon,authenticated
using (room_id = 'main');

create policy "admin live state manage"
on public.archive_live_state for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "admin chat read"
on public.live_chat for select to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "admin chat moderate"
on public.live_chat for update to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "admin bans manage"
on public.live_banned_tokens for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "public announcements read"
on public.live_announcements for select to anon,authenticated
using (room_id = 'main');

create policy "admin announcements insert"
on public.live_announcements for insert to authenticated
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "admin private live manage"
on public.private_live_items for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "public play counts read"
on public.play_counts for select to anon,authenticated
using (true);

create policy "public archive changelog read"
on public.archive_changelog for select to anon,authenticated
using (true);

create policy "admin archive changelog manage"
on public.archive_changelog for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

create policy "public premiere read"
on public.live_premieres for select to anon,authenticated
using (status <> 'cancelled');

create policy "admin premiere manage"
on public.live_premieres for all to authenticated
using (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com')
with check (lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com');

-- Explicit API grants. RLS still decides which rows are available. ----------

grant usage on schema public to anon,authenticated;
grant select on public.archive_assets,public.archive_folders,public.archive_live_state,
  public.live_announcements,public.play_counts,
  public.archive_changelog,public.live_premieres,
  public.archive_tags,public.archive_tag_aliases,public.archive_asset_tags,
  public.archive_audio_metadata,public.archive_eras,public.archive_asset_eras to anon,authenticated;
grant all on public.archive_assets,public.archive_folders,public.archive_live_state,
  public.archive_source_provenance,
  public.archive_enrichment_suggestions,public.archive_tags,public.archive_tag_aliases,
  public.archive_asset_tags,public.archive_audio_metadata,public.archive_eras,
  public.archive_asset_eras,public.archive_asset_era_provenance,
  public.live_chat,public.live_banned_tokens,
  public.live_announcements,public.private_live_items,
  public.archive_changelog,public.live_premieres to authenticated;

revoke all on public.live_banned_tokens from anon;
revoke all on public.archive_source_provenance from anon,public;
revoke all on public.archive_enrichment_suggestions from anon,public;
revoke all on public.archive_asset_era_provenance from anon,public;
revoke select,insert,update,delete on public.live_chat from anon;
revoke insert on public.live_chat from authenticated;

revoke all on function public.is_live_chat_blocked(text) from public;
revoke all on function public.public_live_chat_history() from public;
revoke all on function public.post_live_chat(text,text,text) from public;
revoke all on function public.increment_play_count(text) from public;
revoke all on function public.is_akrasia_admin() from public;
revoke all on function public.review_archive_enrichment(uuid,text,jsonb,text) from public;
revoke all on function public.accept_archive_lyrics(uuid,text,boolean) from public;
revoke all on function public.accept_archive_audio_metadata(uuid,jsonb) from public;
revoke all on function public.accept_archive_tags(uuid,jsonb,boolean,text) from public;
revoke all on function public.accept_archive_era(uuid,uuid,text) from public;
revoke all on function public.merge_archive_tags(uuid,uuid) from public;

grant execute on function public.is_live_chat_blocked(text) to anon,authenticated;
grant execute on function public.public_live_chat_history() to anon,authenticated;
grant execute on function public.post_live_chat(text,text,text) to anon,authenticated;
grant execute on function public.increment_play_count(text) to anon,authenticated;
grant execute on function public.is_akrasia_admin() to authenticated;
grant execute on function public.review_archive_enrichment(uuid,text,jsonb,text) to authenticated;
grant execute on function public.accept_archive_lyrics(uuid,text,boolean) to authenticated;
grant execute on function public.accept_archive_audio_metadata(uuid,jsonb) to authenticated;
grant execute on function public.accept_archive_tags(uuid,jsonb,boolean,text) to authenticated;
grant execute on function public.accept_archive_era(uuid,uuid,text) to authenticated;
grant execute on function public.merge_archive_tags(uuid,uuid) to authenticated;

-- Storage ------------------------------------------------------------------

insert into storage.buckets(id,name,public)
values ('archive-assets','archive-assets',false)
on conflict (id) do update set public = false;

insert into storage.buckets(id,name,public)
values ('private-live-assets','private-live-assets',false)
on conflict (id) do update set public = false;

do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (
        coalesce(qual,'') ilike '%archive-assets%'
        or coalesce(with_check,'') ilike '%archive-assets%'
        or coalesce(qual,'') ilike '%private-live-assets%'
        or coalesce(with_check,'') ilike '%private-live-assets%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects',p.policyname);
  end loop;
end $$;

create policy "available archive storage read"
on storage.objects for select to anon,authenticated
using (
  bucket_id = 'archive-assets'
  and exists(
    select 1 from public.archive_assets asset
    where (asset.storage_path = storage.objects.name or asset.cover_storage_path = storage.objects.name)
  )
  or (
    bucket_id = 'archive-assets'
    and exists(
      select 1 from public.archive_eras era
      where era.cover_storage_path = storage.objects.name and era.visibility = 'public'
    )
  )
);

create policy "admin archive storage manage"
on storage.objects for all to authenticated
using (
  bucket_id = 'archive-assets'
  and lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com'
)
with check (
  bucket_id = 'archive-assets'
  and lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com'
);

create policy "admin private live storage manage"
on storage.objects for all to authenticated
using (
  bucket_id = 'private-live-assets'
  and lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com'
)
with check (
  bucket_id = 'private-live-assets'
  and lower(coalesce(auth.jwt()->>'email','')) = 'angelyzyy@gmail.com'
);

-- Realtime for admin moderation. Public chat uses sanitized polling/RPC. -----

do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'live_chat'
     ) then
    alter publication supabase_realtime add table public.live_chat;
  end if;
end $$;

commit;

-- After this succeeds:
-- 1. Open Authentication > URL Configuration and add your deployed site URL.
-- 2. Keep email confirmation enabled.
-- 3. Re-upload older live-only files through the private live uploader so they
--    receive durable storage paths and fresh signed URLs whenever they are queued.
-- 4. Archive media is private; public reads require a matching indexed archive row.
