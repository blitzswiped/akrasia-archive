begin;

alter table public.archive_eras
  add column if not exists parent_era_id uuid references public.archive_eras(id) on delete set null;
alter table public.archive_eras
  add column if not exists notes text not null default '';

create index if not exists archive_eras_parent_order_idx
on public.archive_eras(parent_era_id,display_order,name);

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

commit;
