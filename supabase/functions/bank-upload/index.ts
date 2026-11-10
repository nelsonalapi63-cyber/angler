// ANGLER — bank-upload Edge Function (Deno). Receives one answer-bank row at a time from tools/upload-bank.js
// ({ key, data }) and upserts it into public.bank with the service role. The caller proves itself with the
// X-Bank-Token header, which must equal the `bank_token` row in public.cron_settings (a table nothing on the
// client can read). That token can only write the bank — nothing else — so the build pipeline never needs the
// service role key.
import { createClient } from "npm:@supabase/supabase-js@2";

const KEYS = ["prompts", "entities", "schedule", "taxa", "frozen", "version"];   // frozen (v4): the answer sets of days already played
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-bank-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: setting } = await admin.from("cron_settings").select("value").eq("key", "bank_token").maybeSingle();
  const token = req.headers.get("x-bank-token") || "";
  if (!setting?.value || token.length < 32 || token !== setting.value) return json(401, { error: "bad token" });
  let body: { key?: string; data?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  if (!body.key || !KEYS.includes(body.key) || body.data === undefined) return json(400, { error: "key must be one of " + KEYS.join(", ") + " with data" });
  const { error } = await admin.from("bank").upsert({ key: body.key, data: body.data, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, key: body.key });
});
