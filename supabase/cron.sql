-- ANGLER — scheduled jobs with pg_cron + pg_net (enable both extensions in Database → Extensions first, or let
-- the first two lines do it). Safe to re-run. Already applied to the live project by the Supabase connector.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Where the jobs find the Edge Functions and the key they call them with. The anon key is the project's PUBLIC
-- key (it ships inside the site), so storing it here reveals nothing; the functions it triggers are idempotent —
-- reminders go out once per subscription per day, the recap once per diver per week — so an early or repeated call
-- changes nothing. Fill in your project ref and anon key (Settings → API).
create table if not exists public.cron_settings (key text primary key, value text not null);
alter table public.cron_settings enable row level security;
revoke all on public.cron_settings from anon, authenticated;
insert into public.cron_settings (key, value) values
  ('functions_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1'),
  ('anon_key', 'YOUR-ANON-KEY'),
  ('bank_token', 'A-LONG-RANDOM-SECRET')     -- lets tools/upload-bank.js write the answer bank (and nothing else); e.g. `openssl rand -hex 24`
on conflict (key) do update set value = excluded.value;

create or replace function public.call_function(p_name text) returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select value from public.cron_settings where key = 'functions_url') || '/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || (select value from public.cron_settings where key = 'anon_key'),
                                  'apikey', (select value from public.cron_settings where key = 'anon_key')),
    body := '{}'::jsonb
  )
$$;
revoke execute on function public.call_function(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('angler-nightly-winter', 'angler-nightly-summer', 'angler-reminders', 'angler-weekly-recap');
-- 00:05 Eastern = 05:05 UTC in winter, 04:05 UTC in summer; nightly() is idempotent so both runs are safe
select cron.schedule('angler-nightly-winter', '5 5 * * *', $$select public.nightly()$$);
select cron.schedule('angler-nightly-summer', '5 4 * * *', $$select public.nightly()$$);
-- hourly push reminders
select cron.schedule('angler-reminders', '7 * * * *', $$select public.call_function('send-reminders')$$);
-- Sundays 15:00 UTC: the weekly recap email to opted-in divers
select cron.schedule('angler-weekly-recap', '0 15 * * 0', $$select public.call_function('weekly-recap')$$);
