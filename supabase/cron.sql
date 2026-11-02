-- FATHOM — schedule the nightly close with pg_cron (enable the extension in Database → Extensions first).
-- 00:05 Eastern is 05:05 UTC in winter and 04:05 UTC in summer; nightly() is idempotent, so both runs are safe.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('fathom-nightly-winter', 'fathom-nightly-summer');
select cron.schedule('fathom-nightly-winter', '5 5 * * *', $$select public.nightly()$$);
select cron.schedule('fathom-nightly-summer', '5 4 * * *', $$select public.nightly()$$);
