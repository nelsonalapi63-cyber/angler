// ANGLER — weekly-recap Edge Function (Deno). Sunday cron (public.call_function, anon key; the gateway verifies it).
// Emails every opted-in diver a recap of their week: days played, best depth, average percentile, Hadal answers.
// Idempotent: runs only on Sundays (UTC) and marks profiles.last_recap_day so a diver gets at most one recap a week,
// whoever triggers it. Sends through Resend (RESEND_API_KEY secret, RECAP_FROM e.g. "ANGLER <recap@yourdomain>").
// Opt-in only: profiles.email_optin must be true.
import { createClient } from "npm:@supabase/supabase-js@2";
import "./dive.js";
// deno-lint-ignore no-explicit-any
const dive = (globalThis as any).FathomDive;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const SITE = Deno.env.get("SITE_URL") || "";

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RESEND = Deno.env.get("RESEND_API_KEY"), FROM = Deno.env.get("RECAP_FROM") || "ANGLER <nelsonalapi63@gmail.com>";
  if (!RESEND) return json(500, { error: "RESEND_API_KEY not set" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
  const today = dive.dayKey(new Date());
  if (new Date().getUTCDay() !== 0) return json(200, { ok: true, sent: 0, skipped: "not Sunday" });
  const weekStart = dive.keyPlusDays(today, -7);
  const { data: profiles, error } = await admin.from("profiles").select("user_id, handle").eq("email_optin", true).or("last_recap_day.is.null,last_recap_day.lt." + weekStart).limit(2000);
  if (error) return json(500, { error: error.message });
  let sent = 0;
  for (const p of profiles || []) {
    const { data: u } = await admin.auth.admin.getUserById(p.user_id);
    const email = u?.user?.email;
    if (!email) continue;
    const { data: dives } = await admin.from("dives").select("day, depth, tiers").eq("user_id", p.user_id).gte("day", weekStart).lt("day", today).order("day");
    if (!dives || !dives.length) continue;                       // nothing to recap
    const best = dives.reduce((m, d) => Math.max(m, d.depth), 0);
    const { data: pts } = await admin.from("daily_rank_points").select("points").eq("user_id", p.user_id).gte("day", weekStart).lt("day", today);
    const avgPct = pts && pts.length ? Math.round(pts.reduce((n, r) => n + Number(r.points), 0) / pts.length) : null;
    const hadals = dives.reduce((n, d) => n + (d.tiers || []).filter((t: string) => t === "hadal").length, 0);
    const html = `<div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0B2230">
      <h1 style="font-family:Outfit,Helvetica,Arial,sans-serif;letter-spacing:.2em;margin:0 0 16px">${dive.BRAND}</h1>
      <p>Your week, ${esc(p.handle || "diver")}:</p>
      <ul style="line-height:1.8">
        <li><b>${dives.length}</b> of 7 daily dives</li>
        <li>Best depth <b>${dive.formatMeters(best)} m</b> (${esc(dive.zoneFor(best).name)})</li>
        ${avgPct != null ? `<li>Average percentile <b>top ${100 - avgPct}%</b></li>` : ""}
        <li><b>${hadals}</b> Hadal answer${hadals === 1 ? "" : "s"}</li>
      </ul>
      <p><a href="${SITE || "#"}/#daily" style="display:inline-block;background:#0B6E69;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700">Dive today</a></p>
      <p style="color:#4F6C7B;font-size:13px">You get this because you turned on the weekly recap in Settings. Turn it off there any time.</p>
    </div>`;
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + RESEND, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to: [email], subject: dive.BRAND + " — your week: " + dives.length + " dives, best " + dive.formatMeters(best) + " m", html }) });
    if (res.ok) { sent++; await admin.from("profiles").update({ last_recap_day: today }).eq("user_id", p.user_id); }
  }
  return json(200, { ok: true, sent });
});
