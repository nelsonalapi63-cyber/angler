-- FATHOM — Supabase schema. Run once in the SQL editor (or `supabase db push`).
-- Tables, Row Level Security, public leaderboard views, the daily_curve RPC and the nightly close.
-- Parameters live in public.fathom_params so they match the client constants.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- parameters
create table if not exists public.fathom_params (
  key text primary key,
  value numeric not null
);
insert into public.fathom_params (key, value) values
  ('rating_window_days', 30),
  ('rating_best_of', 20),
  ('min_ranked_days', 5),
  ('curve_bin_m', 250),
  ('max_depth_m', 10935),
  ('league_twilight', 40), ('league_midnight', 60), ('league_abyss', 75), ('league_hadal', 90)
on conflict (key) do nothing;

create or replace function public.param(p_key text) returns numeric language sql stable as
  $$ select value from public.fathom_params where key = p_key $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text unique check (handle ~ '^[A-Za-z0-9_]{3,16}$'),
  flag text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_handle_lower on public.profiles (lower(handle));

create table if not exists public.entitlements (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null,
  purchased_at timestamptz not null default now(),
  payment_session_id text unique,
  unique (user_id, product_id)
);

create table if not exists public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily jsonb not null default '{}'::jsonb,
  logbook jsonb not null default '{}'::jsonb,
  best jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.dives (
  id bigserial primary key,
  day date not null,
  user_id uuid references auth.users (id) on delete cascade,
  device_id text,
  prompt_ids text[] not null,
  answers jsonb not null,
  tiers text[] not null,
  points int not null,
  depth int not null,
  seconds_used numeric not null,
  flagged boolean not null default false,
  approved boolean not null default true,
  created_at timestamptz not null default now(),
  check (user_id is not null or device_id is not null)
);
create unique index if not exists dives_one_per_day on public.dives (day, coalesce(user_id::text, device_id));
create index if not exists dives_day_depth on public.dives (day, depth desc);

create table if not exists public.daily_stats (
  day date primary key,
  bins int[] not null,
  total int not null,
  median int not null,
  frozen boolean not null default false,
  closed_at timestamptz
);

create table if not exists public.daily_rank_points (
  day date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  depth int not null,
  rank int not null,
  percentile int not null,          -- "top X%"
  points numeric not null,          -- daily rank points, 100 for the day's best diver
  primary key (day, user_id)
);

create table if not exists public.ratings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tide text not null,
  rating numeric not null,
  league text not null,
  dives int not null,
  mean_depth int not null,
  rank int,
  total_meters bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.hall_of_fame (
  tide text not null,
  rank int not null,
  user_id uuid,
  handle text,
  flag text,
  rating numeric,
  primary key (tide, rank)
);

create table if not exists public.follows (
  follower uuid not null references auth.users (id) on delete cascade,
  followee uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee)
);

-- ---------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.entitlements enable row level security;
alter table public.progress enable row level security;
alter table public.dives enable row level security;
alter table public.daily_stats enable row level security;
alter table public.daily_rank_points enable row level security;
alter table public.ratings enable row level security;
alter table public.hall_of_fame enable row level security;
alter table public.follows enable row level security;
alter table public.fathom_params enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists entitlements_own on public.entitlements;
create policy entitlements_own on public.entitlements for select to authenticated using (user_id = auth.uid());
drop policy if exists progress_own on public.progress;
create policy progress_own on public.progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists dives_own on public.dives;
create policy dives_own on public.dives for select to authenticated using (user_id = auth.uid());
drop policy if exists daily_stats_public on public.daily_stats;
create policy daily_stats_public on public.daily_stats for select to anon, authenticated using (true);
drop policy if exists drp_own on public.daily_rank_points;
create policy drp_own on public.daily_rank_points for select to authenticated using (user_id = auth.uid());
drop policy if exists ratings_own on public.ratings;
create policy ratings_own on public.ratings for select to authenticated using (user_id = auth.uid());
drop policy if exists hall_public on public.hall_of_fame;
create policy hall_public on public.hall_of_fame for select to anon, authenticated using (true);
drop policy if exists follows_own on public.follows;
create policy follows_own on public.follows for all to authenticated using (follower = auth.uid()) with check (follower = auth.uid());
drop policy if exists params_public on public.fathom_params;
create policy params_public on public.fathom_params for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- public leaderboard views (only handle, flag, depth, rating, league)
create or replace view public.leaderboard_today as
  select d.day, p.handle, p.flag, d.depth, d.seconds_used, r.rating, r.league
  from public.dives d
  join public.profiles p on p.user_id = d.user_id
  left join public.ratings r on r.user_id = d.user_id
  where d.user_id is not null and d.approved and not p.hidden and p.handle is not null;

create or replace view public.leaderboard_tide as
  select p.handle, p.flag, r.rating, r.league, r.dives, r.tide, r.rank
  from public.ratings r
  join public.profiles p on p.user_id = r.user_id
  where not p.hidden and p.handle is not null and r.dives >= public.param('min_ranked_days');

create or replace view public.leaderboard_alltime as
  select p.handle, p.flag, r.total_meters as meters, r.rating, r.league
  from public.ratings r
  join public.profiles p on p.user_id = r.user_id
  where not p.hidden and p.handle is not null;

grant select on public.leaderboard_today, public.leaderboard_tide, public.leaderboard_alltime, public.hall_of_fame to anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public.eastern_today() returns date language sql stable as
  $$ select (now() at time zone 'America/New_York')::date $$;

create or replace function public.league_for(p_rating numeric) returns text language sql immutable as $$
  select case
    when p_rating >= public.param('league_hadal') then 'hadal'
    when p_rating >= public.param('league_abyss') then 'abyss'
    when p_rating >= public.param('league_midnight') then 'midnight'
    when p_rating >= public.param('league_twilight') then 'twilight'
    else 'sunlight' end
$$;

-- ---------------------------------------------------------------- daily curve RPC (anyone may call; returns only aggregates plus the caller's own place)
create or replace function public.daily_curve(p_day date, p_device text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_bin int := public.param('curve_bin_m');
  v_nbins int := ceil(public.param('max_depth_m') / public.param('curve_bin_m'));
  v_bins int[];
  v_total int;
  v_median int;
  v_mine int;
  v_rank int;
  v_pct int;
  v_frozen boolean := false;
begin
  select bins, total, median, frozen into v_bins, v_total, v_median, v_frozen from public.daily_stats where day = p_day and frozen;
  if not found then
    select coalesce(array_agg(c order by b), '{}'), coalesce(sum(c), 0) into v_bins, v_total
    from (select gs.b, count(d.id) as c
          from generate_series(0, v_nbins - 1) gs(b)
          left join public.dives d on d.day = p_day and least(v_nbins - 1, floor(d.depth / v_bin)) = gs.b
          group by gs.b) t;
    select coalesce(percentile_disc(0.5) within group (order by depth), 0) into v_median from public.dives where day = p_day;
  end if;
  select depth into v_mine from public.dives where day = p_day and ((auth.uid() is not null and user_id = auth.uid()) or (auth.uid() is null and p_device is not null and device_id = p_device)) limit 1;
  if v_mine is not null and v_total > 0 then
    select count(*) + 1 into v_rank from public.dives where day = p_day and depth > v_mine;
    select greatest(1, ceil(100.0 * count(*) / v_total)) into v_pct from public.dives where day = p_day and depth >= v_mine;
  end if;
  return json_build_object('bins', v_bins, 'total', v_total, 'median', v_median, 'percentile', v_pct, 'rank', v_rank, 'frozen', v_frozen);
end $$;
grant execute on function public.daily_curve(date, text) to anon, authenticated;

-- ---------------------------------------------------------------- friends
create or replace function public.friends_today(p_day date)
returns table (handle text, flag text, depth int, rating numeric)
language sql security definer set search_path = public stable as $$
  select p.handle, p.flag, d.depth, r.rating
  from public.dives d
  join public.profiles p on p.user_id = d.user_id
  left join public.ratings r on r.user_id = d.user_id
  where d.day = p_day and d.approved and p.handle is not null
    and (d.user_id = auth.uid() or d.user_id in (select followee from public.follows where follower = auth.uid()))
  order by d.depth desc, d.seconds_used asc
$$;
grant execute on function public.friends_today(date) to authenticated;

create or replace function public.follow_handle(p_handle text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select user_id into v_id from public.profiles where lower(handle) = lower(p_handle) and not hidden;
  if v_id is null then raise exception 'no such handle'; end if;
  insert into public.follows (follower, followee) values (auth.uid(), v_id) on conflict do nothing;
end $$;
grant execute on function public.follow_handle(text) to authenticated;

-- ---------------------------------------------------------------- nightly close: freeze the day, award daily rank points, recompute ratings
create or replace function public.close_day(p_day date) returns void language plpgsql security definer set search_path = public as $$
declare
  v_bin int := public.param('curve_bin_m');
  v_nbins int := ceil(public.param('max_depth_m') / public.param('curve_bin_m'));
  v_bins int[]; v_total int; v_median int;
begin
  if exists (select 1 from public.daily_stats where day = p_day and frozen) then return; end if;
  select coalesce(array_agg(c order by b), '{}'), coalesce(sum(c), 0) into v_bins, v_total
  from (select gs.b, count(d.id) as c from generate_series(0, v_nbins - 1) gs(b)
        left join public.dives d on d.day = p_day and least(v_nbins - 1, floor(d.depth / v_bin)) = gs.b group by gs.b) t;
  select coalesce(percentile_disc(0.5) within group (order by depth), 0) into v_median from public.dives where day = p_day;
  insert into public.daily_stats (day, bins, total, median, frozen, closed_at) values (p_day, v_bins, v_total, v_median, true, now())
    on conflict (day) do update set bins = excluded.bins, total = excluded.total, median = excluded.median, frozen = true, closed_at = now();
  -- daily rank points for signed-in, approved dives: 100 for the best diver, scaled by position among ALL dives that day
  insert into public.daily_rank_points (day, user_id, depth, rank, percentile, points)
  select p_day, d.user_id, d.depth,
         (select count(*) + 1 from public.dives x where x.day = p_day and x.depth > d.depth) as rank,
         greatest(1, ceil(100.0 * (select count(*) from public.dives x where x.day = p_day and x.depth >= d.depth) / greatest(v_total, 1))) as percentile,
         round(100.0 * (v_total - (select count(*) from public.dives x where x.day = p_day and x.depth > d.depth)) / greatest(v_total, 1), 1) as points
  from public.dives d where d.day = p_day and d.user_id is not null and d.approved
  on conflict (day, user_id) do update set depth = excluded.depth, rank = excluded.rank, percentile = excluded.percentile, points = excluded.points;
end $$;

create or replace function public.recompute_ratings(p_asof date default null) returns void language plpgsql security definer set search_path = public as $$
declare
  v_asof date := coalesce(p_asof, public.eastern_today() - 1);   -- the last CLOSED day
  v_tide text := to_char(v_asof, 'YYYY-MM');
  v_from date := greatest(v_asof - (public.param('rating_window_days'))::int + 1, date_trunc('month', v_asof)::date);
  v_best int := public.param('rating_best_of');
begin
  delete from public.ratings where tide <> v_tide;
  insert into public.ratings (user_id, tide, rating, league, dives, mean_depth, total_meters, updated_at)
  select s.user_id, v_tide, s.rating, public.league_for(s.rating), s.dives, s.mean_depth,
         coalesce((select sum(depth) from public.dives d where d.user_id = s.user_id), 0), now()
  from (
    select user_id, count(*) as dives, round(avg(points), 1) as rating, round(avg(depth)) as mean_depth
    from (select user_id, points, depth, row_number() over (partition by user_id order by points desc) as rn
          from public.daily_rank_points where day >= v_from and day <= v_asof) b
    where rn <= v_best
    group by user_id
  ) s
  on conflict (user_id) do update set tide = excluded.tide, rating = excluded.rating, league = excluded.league, dives = excluded.dives,
    mean_depth = excluded.mean_depth, total_meters = excluded.total_meters, updated_at = now();
  update public.ratings r set rank = x.rk from (
    select user_id, row_number() over (order by rating desc, mean_depth desc) as rk from public.ratings where dives >= public.param('min_ranked_days')) x
  where r.user_id = x.user_id;
  update public.ratings set rank = null where dives < public.param('min_ranked_days');
end $$;

create or replace function public.snapshot_tide(p_tide text) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.hall_of_fame (tide, rank, user_id, handle, flag, rating)
  select p_tide, r.rank, r.user_id, p.handle, p.flag, r.rating
  from public.ratings r join public.profiles p on p.user_id = r.user_id
  where r.tide = p_tide and r.rank is not null and r.rank <= 10 and not p.hidden
  on conflict (tide, rank) do nothing;
end $$;

-- Runs from pg_cron (see cron.sql). Idempotent: closes yesterday (Eastern) if it is still open.
-- On the first of a month it also freezes the old Tide's final standings into the Hall of Fame.
create or replace function public.nightly() returns void language plpgsql security definer set search_path = public as $$
declare v_yesterday date := public.eastern_today() - 1;
begin
  if not exists (select 1 from public.daily_stats where day = v_yesterday and frozen) then
    perform public.close_day(v_yesterday);
    perform public.recompute_ratings(v_yesterday);
    if to_char(v_yesterday, 'YYYY-MM') <> to_char(public.eastern_today(), 'YYYY-MM') then
      perform public.snapshot_tide(to_char(v_yesterday, 'YYYY-MM'));
    end if;
  end if;
end $$;
