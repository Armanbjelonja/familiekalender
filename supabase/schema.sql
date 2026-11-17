-- Familiekalender – databaseskema til Supabase
-- Køres én gang i Supabase: SQL Editor → New query → indsæt det hele → Run.

-- ---------- Tabeller ----------

create table public.personer (
  id        uuid primary key default gen_random_uuid(),
  navn      text not null unique,
  farve     text not null,
  sortering int  not null default 0
);

-- Hvilke logins hører til familien. person_id er tom for køkken-iPad'en.
create table public.medlemmer (
  bruger_id uuid primary key references auth.users (id) on delete cascade,
  person_id uuid references public.personer (id) on delete set null
);

-- Heldagsaftaler: start = midnat første dag, slut = midnat dagen efter sidste dag.
-- Tom person_ids = hele familien.
create table public.aftaler (
  id          uuid primary key default gen_random_uuid(),
  titel       text not null check (char_length(titel) between 1 and 200),
  start       timestamptz not null,
  slut        timestamptz not null,
  heldags     boolean not null default false,
  person_ids  uuid[] not null default '{}',
  sted        text not null default '',
  note        text not null default '',
  oprettet    timestamptz not null default now(),
  opdateret   timestamptz not null default now(),
  check (slut > start)
);
create index aftaler_start_idx on public.aftaler (start);
create index aftaler_slut_idx  on public.aftaler (slut);

-- Hemmelige nøgler til Siri-genvej og kalender-abonnement (.ics).
-- Én pr. person + én for hele familien (person_id tom).
create table public.tokens (
  token     text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  person_id uuid references public.personer (id) on delete cascade,
  oprettet  timestamptz not null default now(),
  unique nulls not distinct (person_id)
);

-- ---------- Hjælpefunktioner ----------

create function public.er_familie() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.medlemmer where bruger_id = (select auth.uid()));
$$;

create function public.min_person() returns uuid
language sql stable security definer set search_path = ''
as $$
  select person_id from public.medlemmer where bruger_id = (select auth.uid());
$$;

create function public.saet_opdateret() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.opdateret := now();
  return new;
end;
$$;

create trigger aftaler_opdateret before update on public.aftaler
  for each row execute function public.saet_opdateret();

-- ---------- Row Level Security: kun familien har adgang ----------

alter table public.personer  enable row level security;
alter table public.medlemmer enable row level security;
alter table public.aftaler   enable row level security;
alter table public.tokens    enable row level security;

create policy "familien ser personer" on public.personer
  for select to authenticated using (public.er_familie());
create policy "familien retter personer" on public.personer
  for update to authenticated using (public.er_familie()) with check (public.er_familie());

create policy "man ser sit eget medlemskab" on public.medlemmer
  for select to authenticated using (bruger_id = (select auth.uid()));

create policy "familien styrer aftaler" on public.aftaler
  for all to authenticated using (public.er_familie()) with check (public.er_familie());

-- Familien bruger ét fælles login, så det kan se alle tokens
-- (bruges til at vise Siri- og abonnementslinks pr. person)
create policy "familien ser tokens" on public.tokens
  for select to authenticated using (public.er_familie());

-- ---------- Realtime (iPad'en opdaterer sig selv) ----------

alter publication supabase_realtime add table public.aftaler, public.personer;

-- ---------- Startdata ----------

insert into public.personer (navn, farve, sortering) values
  ('Person 1', '#2f6fde', 1),
  ('Person 2', '#d6336c', 2),
  ('Person 3', '#2b8a3e', 3),
  ('Person 4', '#e8590c', 4),
  ('Person 5', '#7048e8', 5);

insert into public.tokens (person_id) select id from public.personer;
insert into public.tokens (person_id) values (null);
