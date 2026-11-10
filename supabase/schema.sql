-- ANGLER — Supabase schema. Run once in the SQL editor (or `supabase db push`); re-running is safe.
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
  payment_intent text,
  unique (user_id, product_id)
);

create table if not exists public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily jsonb not null default '{}'::jsonb,
  logbook jsonb not null default '{}'::jsonb,
  best jsonb not null default '{}'::jsonb,
  badges jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.progress add column if not exists badges jsonb not null default '{}'::jsonb;

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
  entity_ids text[],                      -- what each prompt resolved to (null = miss); feeds top_answers()
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

create or replace view public.leaderboard_alltime as          -- computed from the dives themselves, so it never resets
  select p.handle, p.flag, sum(d.depth)::bigint as meters, r.rating, r.league
  from public.dives d
  join public.profiles p on p.user_id = d.user_id
  left join public.ratings r on r.user_id = d.user_id
  where d.approved and not p.hidden and p.handle is not null
  group by p.handle, p.flag, r.rating, r.league;

grant select on public.leaderboard_today, public.leaderboard_tide, public.leaderboard_alltime, public.hall_of_fame to anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public.eastern_today() returns date language sql stable as
  $$ select (now() at time zone 'America/New_York')::date $$;

create or replace function public.league_for(p_rating numeric) returns text language sql stable as $$
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
  v_at_or_above int;
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
    select count(*) into v_at_or_above from public.dives where day = p_day and depth >= v_mine;
    v_pct := greatest(1, ceil(100.0 * v_at_or_above / v_total));
  end if;
  -- at_or_above lets the browser say "you beat X% of divers" (the share of the others below you); below is the complement
  return json_build_object('bins', v_bins, 'total', v_total, 'median', v_median, 'percentile', v_pct, 'rank', v_rank, 'at_or_above', v_at_or_above, 'below', case when v_at_or_above is null then null else v_total - v_at_or_above end, 'frozen', coalesce(v_frozen, false));
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

create or replace function public.friends_tide()
returns table (handle text, flag text, rating numeric, league text, dives int)
language sql security definer set search_path = public stable as $$
  select p.handle, p.flag, r.rating, r.league, r.dives
  from public.ratings r join public.profiles p on p.user_id = r.user_id
  where p.handle is not null and (r.user_id = auth.uid() or r.user_id in (select followee from public.follows where follower = auth.uid()))
  order by r.rating desc
$$;
grant execute on function public.friends_tide() to authenticated;

create or replace function public.friends_alltime()
returns table (handle text, flag text, meters bigint, rating numeric)
language sql security definer set search_path = public stable as $$
  select p.handle, p.flag, sum(d.depth)::bigint as meters, max(r.rating) as rating
  from public.dives d join public.profiles p on p.user_id = d.user_id left join public.ratings r on r.user_id = d.user_id
  where d.approved and p.handle is not null and (d.user_id = auth.uid() or d.user_id in (select followee from public.follows where follower = auth.uid()))
  group by p.handle, p.flag
  order by meters desc
$$;
grant execute on function public.friends_alltime() to authenticated;

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

-- ---------------------------------------------------------------- lock down the maintenance functions
-- SECURITY DEFINER functions are executable by PUBLIC by default; only pg_cron (postgres) may run these.
revoke execute on function public.close_day(date) from public, anon, authenticated;
revoke execute on function public.recompute_ratings(date) from public, anon, authenticated;
revoke execute on function public.snapshot_tide(text) from public, anon, authenticated;
revoke execute on function public.nightly() from public, anon, authenticated;

-- ---------------------------------------------------------------- "what others answered today"
-- The most-given accepted answers per prompt for a day, with the day's dive count. Anyone may call it; it reveals
-- nothing about individual divers. (The column is added here too so existing databases pick it up on re-run.)
alter table public.dives add column if not exists entity_ids text[];
create or replace function public.top_answers(p_day date)
returns table (prompt_id text, entity_id text, n bigint, total bigint)
language sql stable security definer set search_path = public as $$
  with d as (select prompt_ids, entity_ids from public.dives where day = p_day and approved and entity_ids is not null),
  t as (select count(*) as total from d),
  x as (select unnest(prompt_ids) as prompt_id, unnest(entity_ids) as entity_id from d)
  select x.prompt_id, x.entity_id, count(*) as n, (select total from t) as total
  from x where x.entity_id is not null
  group by x.prompt_id, x.entity_id
  order by x.prompt_id, n desc;
$$;
grant execute on function public.top_answers(date) to anon, authenticated;

-- ================================================================ v2: retention, social proof, analytics, reports
-- Everything below is additive; re-running the file is safe.

-- ---------------------------------------------------------------- who is the owner (admin.html)
-- Put your sign-in email here (or several). is_admin() is what every admin RPC checks.
create table if not exists public.admin_emails (email text primary key);
-- insert into public.admin_emails (email) values ('you@example.com');
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_emails a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on public.admin_emails from anon, authenticated;

-- ---------------------------------------------------------------- live count for the home page
create or replace function public.divers_today(p_day date)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.dives where day = p_day and approved
$$;
grant execute on function public.divers_today(date) to anon, authenticated;

-- ---------------------------------------------------------------- push reminders
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_id uuid references auth.users (id) on delete cascade,
  device_id text,
  tz text not null default 'America/New_York',   -- IANA time zone of the browser
  remind_at smallint not null default 19,         -- local hour 0–23
  last_sent_day date,
  failures int not null default 0,
  created_at timestamptz not null default now(),
  check (user_id is not null or device_id is not null)
);
alter table public.push_subscriptions enable row level security;
-- rows are written by the push-subscribe Edge Function (service role); nobody reads them from the client
revoke all on public.push_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------- weekly recap email (opt-in)
alter table public.profiles add column if not exists email_optin boolean not null default false;
alter table public.profiles add column if not exists streak_freezes int not null default 0;

-- ---------------------------------------------------------------- community packs
create table if not exists public.community_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 40),
  emoji text not null check (char_length(emoji) between 1 and 4),
  blurb text check (char_length(blurb) <= 120),
  prompt_ids text[] not null check (array_length(prompt_ids, 1) = 7),
  author uuid not null references auth.users (id) on delete cascade,
  approved boolean not null default false,       -- flip this in the Supabase table editor to publish a pack
  created_at timestamptz not null default now()
);
alter table public.community_packs enable row level security;
drop policy if exists community_packs_read on public.community_packs;
create policy community_packs_read on public.community_packs for select to anon, authenticated using (approved or author = auth.uid());
drop policy if exists community_packs_insert on public.community_packs;
create policy community_packs_insert on public.community_packs for insert to authenticated with check (author = auth.uid());
create index if not exists community_packs_approved on public.community_packs (approved, created_at desc);

-- ---------------------------------------------------------------- first-party analytics
create table if not exists public.events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  device_id text not null check (char_length(device_id) between 6 and 64),
  user_id uuid,
  name text not null check (name ~ '^[a-z_]{2,40}$'),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 2048)
);
alter table public.events enable row level security;
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to anon, authenticated with check (true);
-- nobody selects rows directly; admin RPCs aggregate them
revoke select on public.events from anon, authenticated;
create index if not exists events_day_name on public.events (created_at, name);
create index if not exists events_device on public.events (device_id, created_at);

-- ---------------------------------------------------------------- answer and tier reports (replaces the mailto link)
create table if not exists public.reports (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  device_id text,
  user_id uuid,
  day date,
  prompt_id text not null,
  entity_id text,
  typed text check (char_length(typed) <= 80),
  kind text not null check (kind in ('wrong_tier', 'missing_answer', 'wrong_fact', 'other')),
  note text check (char_length(note) <= 500),
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected'))
);
alter table public.reports enable row level security;
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to anon, authenticated with check (true);
revoke select on public.reports from anon, authenticated;

-- ---------------------------------------------------------------- admin RPCs (all check is_admin())
create or replace function public.admin_funnel(p_days int default 30)
returns table (day date, visits bigint, dive_started bigint, dive_completed bigint, shared bigint, hints bigint)
language sql stable security definer set search_path = public as $$
  select d::date as day,
    count(distinct device_id) filter (where name = 'visit') as visits,
    count(*) filter (where name = 'dive_started') as dive_started,
    count(*) filter (where name = 'dive_completed') as dive_completed,
    count(*) filter (where name in ('share_clicked', 'share_image')) as shared,
    count(*) filter (where name = 'hint_used') as hints
  from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
  left join public.events e on e.created_at::date = d::date
  where public.is_admin()
  group by d order by d
$$;
create or replace function public.admin_prompt_stats(p_days int default 30)
returns table (prompt_id text, shown bigint, missed bigint, miss_rate numeric, hints bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select unnest(prompt_ids) as prompt_id, unnest(entity_ids) as entity_id, unnest(array(select (a ->> 'hint')::boolean from jsonb_array_elements(answers) a)) as hinted
    from public.dives where day >= current_date - p_days and entity_ids is not null
  )
  select prompt_id, count(*) as shown, count(*) filter (where entity_id is null) as missed,
    round(100.0 * count(*) filter (where entity_id is null) / greatest(count(*), 1), 1) as miss_rate,
    count(*) filter (where hinted) as hints
  from x where public.is_admin() group by prompt_id order by miss_rate desc, shown desc
$$;
create or replace function public.admin_rejected_guesses(p_prompt text, p_days int default 30)
returns table (guess text, n bigint)
language sql stable security definer set search_path = public as $$
  with x as (
    select p.prompt_id, a.answer
    from public.dives d,
      lateral unnest(d.prompt_ids) with ordinality as p(prompt_id, i),
      lateral jsonb_array_elements(d.answers) with ordinality as a(answer, j)
    where d.day >= current_date - p_days and p.i = a.j and p.prompt_id = p_prompt
  )
  select lower(trim(g)) as guess, count(*) as n
  from x, lateral jsonb_array_elements_text(coalesce(x.answer -> 'guesses', '[]'::jsonb)) g
  where public.is_admin() and trim(g) <> ''
  group by lower(trim(g)) order by n desc, guess limit 40
$$;
create or replace function public.admin_cohorts(p_weeks int default 8)
returns table (cohort_week date, divers bigint, week1 bigint, week2 bigint, week4 bigint)
language sql stable security definer set search_path = public as $$
  with first_dive as (
    select coalesce(user_id::text, device_id) as who, min(day) as first_day from public.dives group by 1
  ), cohorts as (
    select who, date_trunc('week', first_day)::date as cohort_week, first_day from first_dive
    where first_day >= current_date - (p_weeks * 7)
  )
  select c.cohort_week, count(*) as divers,
    count(*) filter (where exists (select 1 from public.dives d where coalesce(d.user_id::text, d.device_id) = c.who and d.day between c.first_day + 7 and c.first_day + 13)) as week1,
    count(*) filter (where exists (select 1 from public.dives d where coalesce(d.user_id::text, d.device_id) = c.who and d.day between c.first_day + 14 and c.first_day + 20)) as week2,
    count(*) filter (where exists (select 1 from public.dives d where coalesce(d.user_id::text, d.device_id) = c.who and d.day between c.first_day + 28 and c.first_day + 34)) as week4
  from cohorts c where public.is_admin() group by c.cohort_week order by c.cohort_week
$$;
create or replace function public.admin_reports(p_status text default 'new')
returns setof public.reports language sql stable security definer set search_path = public as $$
  select * from public.reports where public.is_admin() and (p_status = 'all' or status = p_status) order by created_at desc limit 500
$$;
create or replace function public.admin_set_report(p_id bigint, p_status text)
returns void language sql security definer set search_path = public as $$
  update public.reports set status = p_status where id = p_id and public.is_admin() and p_status in ('new', 'accepted', 'rejected')
$$;
grant execute on function public.admin_funnel(int), public.admin_prompt_stats(int), public.admin_rejected_guesses(text, int), public.admin_cohorts(int), public.admin_reports(text), public.admin_set_report(bigint, text), public.is_admin() to authenticated;

-- ================================================================ v2.1: the answer bank lives in the database
-- tools/upload-bank.js puts prompts, entities, schedule, taxa and the data version here (one row each); the
-- Edge Functions read it with the service role and cache it. Nothing on the client can read or write it.
create table if not exists public.bank (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.bank enable row level security;
revoke all on public.bank from anon, authenticated;

-- the weekly recap is sent at most once per week per diver, whoever triggers the function
alter table public.profiles add column if not exists last_recap_day date;

-- ================================================================ v4: Duel rooms
-- A room is a jsonb state driven by shared/duel.js in the `duel` Edge Function. Players read their room and its
-- events (the room id is the capability: it is a random uuid handed out by the function when they create or join
-- by code); nobody writes directly — only the function, with the service role. The hidden fuse and the deadline
-- live in duel_secrets, which has no read policy at all.
create table if not exists public.duel_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  state jsonb not null,                       -- the public state (duel.publicState): never the fuse or the deadline
  seq int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists duel_rooms_code_open on public.duel_rooms (code) where status <> 'finished';
create index if not exists duel_rooms_updated on public.duel_rooms (updated_at);
create table if not exists public.duel_secrets (
  room_id uuid primary key references public.duel_rooms (id) on delete cascade,
  state jsonb not null,                       -- the full state, deadline and fuse included
  deadline bigint,
  fuse_ms int,
  pop_pause_until bigint                      -- the next round is dealt once the popped puffer has been on screen this long
);
create table if not exists public.duel_players (
  room_id uuid not null references public.duel_rooms (id) on delete cascade,
  player_id text not null,
  token text not null,                        -- proves the caller is this player; never shown to the others
  user_id uuid references auth.users (id) on delete set null,
  device_id text,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, player_id)
);
create table if not exists public.duel_events (
  id bigserial primary key,
  room_id uuid not null references public.duel_rooms (id) on delete cascade,
  seq int not null,
  event jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists duel_events_room on public.duel_events (room_id, seq);
alter table public.duel_rooms enable row level security;
alter table public.duel_secrets enable row level security;
alter table public.duel_players enable row level security;
alter table public.duel_events enable row level security;
create policy duel_rooms_read on public.duel_rooms for select to anon, authenticated using (true);      -- by uuid only: the code is resolved by the function
create policy duel_events_read on public.duel_events for select to anon, authenticated using (true);
revoke all on public.duel_secrets from anon, authenticated;
revoke all on public.duel_players from anon, authenticated;
-- Realtime: players subscribe to their room row and its events
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'duel_rooms') then
    alter publication supabase_realtime add table public.duel_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'duel_events') then
    alter publication supabase_realtime add table public.duel_events;
  end if;
end $$;
-- signed-in players keep a tally on their profile
alter table public.profiles add column if not exists duel_played int not null default 0;
alter table public.profiles add column if not exists duel_wins int not null default 0;
-- finished rooms older than six hours and abandoned rooms older than two days are swept by the function itself
-- (on every `create`), with the service role; no SQL function is needed.
