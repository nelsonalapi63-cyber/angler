// ANGLER — push-subscribe Edge Function (Deno). Stores or removes a Web Push subscription for a device or a
// signed-in user, with the reminder hour and time zone. Writes go through the service role so the table itself
// stays closed to clients. Body: { subscription: PushSubscriptionJSON, tz, remindAt, deviceId, remove?: true }
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const MAX_ENDPOINT = 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; tz?: string; remindAt?: number; deviceId?: string; remove?: boolean };
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const endpoint = String(body.subscription?.endpoint || "");
  if (!endpoint || endpoint.length > MAX_ENDPOINT || !/^https:\/\//.test(endpoint)) return json(400, { error: "bad subscription" });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  if (body.remove) {
    await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return json(200, { ok: true, removed: true });
  }
  const p256dh = String(body.subscription?.keys?.p256dh || ""), auth = String(body.subscription?.keys?.auth || "");
  if (!p256dh || !auth) return json(400, { error: "bad keys" });
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) !== ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data } = await userClient.auth.getUser();
    userId = data?.user?.id ?? null;
  }
  const deviceId = typeof body.deviceId === "string" && body.deviceId.length >= 6 && body.deviceId.length <= 64 ? body.deviceId : null;
  if (!userId && !deviceId) return json(400, { error: "no diver id" });
  const tz = typeof body.tz === "string" && body.tz.length <= 64 ? body.tz : "America/New_York";
  const remindAt = Number.isInteger(body.remindAt) && body.remindAt! >= 0 && body.remindAt! <= 23 ? body.remindAt! : 19;
  const { error } = await admin.from("push_subscriptions").upsert({ endpoint, p256dh, auth, user_id: userId, device_id: userId ? null : deviceId, tz, remind_at: remindAt, failures: 0 }, { onConflict: "endpoint" });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
});
