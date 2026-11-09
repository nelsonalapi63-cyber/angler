// ANGLER — send-reminders Edge Function (Deno). Called hourly by pg_cron (public.call_function) with the project's
// anon key; the gateway verifies the key, and the job is idempotent — one notification per subscription per day,
// only at the diver's chosen local hour, only if they have not dived yet — so an extra call changes nothing.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https: contact). Uses npm:web-push.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import "./dive.js";
// deno-lint-ignore no-explicit-any
const dive = (globalThis as any).FathomDive;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const BATCH = 500;                 // subscriptions per run
const MAX_FAILURES = 3;            // a dead endpoint is dropped after this many failures

function localHour(tz: string, now: Date): number {
  try { return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now)) % 24; } catch { return -1; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY"), subject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@angler.example";
  if (!pub || !priv) return json(500, { error: "VAPID keys not set" });
  webpush.setVapidDetails(subject, pub, priv);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
  const now = new Date();
  const today = dive.dayKey(now);
  const number = dive.puzzleNumber(today);
  const { data: subs, error } = await admin.from("push_subscriptions").select("*").or("last_sent_day.is.null,last_sent_day.lt." + today).limit(BATCH);
  if (error) return json(500, { error: error.message });
  let sent = 0, skipped = 0, dropped = 0;
  for (const s of subs || []) {
    if (localHour(s.tz, now) !== s.remind_at) { skipped++; continue; }
    // already played today?
    const q = admin.from("dives").select("id").eq("day", today).limit(1);
    const { data: played } = s.user_id ? await q.eq("user_id", s.user_id) : await q.eq("device_id", s.device_id);
    if (played && played.length) { await admin.from("push_subscriptions").update({ last_sent_day: today }).eq("id", s.id); skipped++; continue; }
    // streak for the message: consecutive days up to yesterday
    const since = dive.keyPlusDays(today, -60);
    const dq = admin.from("dives").select("day").gte("day", since).lt("day", today).order("day", { ascending: false });
    const { data: days } = s.user_id ? await dq.eq("user_id", s.user_id) : await dq.eq("device_id", s.device_id);
    let streak = 0, cursor = dive.keyPlusDays(today, -1);
    for (const d of days || []) { if (d.day === cursor) { streak++; cursor = dive.keyPlusDays(cursor, -1); } else break; }
    const payload = JSON.stringify({ title: dive.BRAND + " #" + number + " is open", body: streak ? "Your streak is " + streak + " — keep it alive before midnight." : "Seven new ocean questions are waiting.", url: "/#daily", tag: "angler-daily" });
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
      await admin.from("push_subscriptions").update({ last_sent_day: today, failures: 0 }).eq("id", s.id);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode || 0;
      if (status === 404 || status === 410 || s.failures + 1 >= MAX_FAILURES) { await admin.from("push_subscriptions").delete().eq("id", s.id); dropped++; }
      else await admin.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
    }
  }
  return json(200, { ok: true, sent, skipped, dropped, day: today });
});
