// FATHOM — delete-account Edge Function (Deno). Deletes the calling user and every row that references them
// (profiles, entitlements, progress, dives, daily_rank_points, ratings, follows all cascade from auth.users).
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(204, {});
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data } = await userClient.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return json(401, { error: "not signed in" });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  // anonymised hall-of-fame rows keep the handle only
  await admin.from("hall_of_fame").update({ user_id: null }).eq("user_id", userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
});
