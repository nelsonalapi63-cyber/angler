-- ANGLER — scheduled jobs with pg_cron + pg_net (enable both extensions in Database → Extensions first; this file is safe to re-run).
-- 00:05 Eastern is 05:05 UTC in winter and 04:05 UTC in summer; nightly() is idempotent, so both runs are safe.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('fathom-nightly-winter', 'fathom-nightly-summer');
select cron.schedule('fathom-nightly-winter', '5 5 * * *', $$select public.nightly()$$);
select cron.schedule('fathom-nightly-summer', '5 4 * * *', $$select public.nightly()$$);

-- ---------------------------------------------------------------- v2 jobs (need the Edge Functions deployed and the secrets set)
-- The two jobs below call Edge Functions over HTTP. Put your project's values in these two database settings first
-- (Project URL and service_role key are under Settings → API); they are readable only by the database owner.
create extension if not exists pg_net;
alter database postgres set app.functions_url = 'https://YOUR-PROJECT-REF.supabase.co/functions/v1';
alter database postgres set app.service_key = 'YOUR-SERVICE-ROLE-KEY';
select cron.unschedule(jobid) from cron.job where jobname in ('angler-reminders', 'angler-weekly-recap');
-- Hourly: push reminders to divers whose local reminder hour is now and who have not played today.
select cron.schedule('angler-reminders', '7 * * * *', $$
  select net.http_post(
    url := current_setting('app.functions_url') || '/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.service_key')),
    body := '{}'::jsonb
  );
$$);
-- Sundays 15:00 UTC: the weekly recap email to opted-in divers.
select cron.schedule('angler-weekly-recap', '0 15 * * 0', $$
  select net.http_post(
    url := current_setting('app.functions_url') || '/weekly-recap',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.service_key')),
    body := '{}'::jsonb
  );
$$);
