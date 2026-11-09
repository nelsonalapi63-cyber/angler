// ANGLER — submit-dive Edge Function (Deno).
// The browser never sends points: it sends the typed answers and seconds used, and this function re-scores
// them with the SAME shared/dive.js the browser runs (copied here by tools/sync-shared.js) against the answer
// bank in the `bank` table (uploaded by tools/upload-bank.js, which the deploy workflow runs after every build).
// The bank is cached in this isolate and re-read when its data version changes or after BANK_TTL_MS.
import "./dive.js";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------- parameters
const MIN_PLAUSIBLE_SECONDS = 7;          // seven typed answers cannot take less than this
const FLAG_POINTS_AT_LEAST = 600;         // a near-perfect dive…
const FLAG_IF_SECONDS_UNDER = 20;         // …typed this fast is held for review
const MAX_TYPED_LENGTH = 60;
const MAX_GUESSES_PER_PROMPT = 5;         // rejected guesses kept per prompt (mined by admin.html)
const BANK_TTL_MS = 10 * 60 * 1000;       // how long a loaded bank is trusted before its version is re-checked

type Answer = { typed: string; secondsUsed: number; hint?: boolean; guesses?: string[] };
type Body = { day: string; promptIds: string[]; answers: Answer[]; deviceId?: string; clientDepth?: number; dataVersion?: string | null };
type Bank = { prompts: Array<{ id: string; answers: unknown[] }>; entitiesById: Record<string, unknown>; schedule: unknown; taxa: Record<string, string[]>; version: string; loadedAt: number };

// deno-lint-ignore no-explicit-any
const dive = (globalThis as any).FathomDive;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

let bank: Bank | null = null;
// deno-lint-ignore no-explicit-any
async function loadBank(admin: any): Promise<Bank> {
  if (bank && Date.now() - bank.loadedAt < BANK_TTL_MS) return bank;
  const { data: v } = await admin.from("bank").select("data").eq("key", "version").maybeSingle();
  const version = v?.data?.version ?? "";
  if (bank && bank.version === version) { bank.loadedAt = Date.now(); return bank; }
  const { data: rows, error } = await admin.from("bank").select("key,data").in("key", ["prompts", "entities", "schedule", "taxa"]);
  if (error) throw new Error("bank: " + error.message);
  const by: Record<string, unknown> = Object.fromEntries((rows || []).map((r: { key: string; data: unknown }) => [r.key, r.data]));
  if (!by.prompts || !by.entities) throw new Error("bank is empty — run node tools/upload-bank.js");
  const prompts = (by.prompts as Array<{ id: string; answers: unknown[] }>).filter((p) => p.answers && p.answers.length);
  const entitiesById = Object.fromEntries((by.entities as Array<{ id: string }>).map((e) => [e.id, e]));
  bank = { prompts, entitiesById, schedule: by.schedule || {}, taxa: (by.taxa as Record<string, string[]>) || {}, version, loadedAt: Date.now() };
  return bank;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });   // a 204 may not carry a body
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  let b: Bank;
  try { b = await loadBank(admin); } catch (e) { return json(503, { error: (e as Error).message }); }

  // --- who is diving (signed-in user, or anonymous device)
  let userId: string | null = null;
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) !== ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data } = await userClient.auth.getUser();
    userId = data?.user?.id ?? null;
  }
  const deviceId = typeof body.deviceId === "string" && body.deviceId.length >= 6 && body.deviceId.length <= 64 ? body.deviceId : null;
  if (!userId && !deviceId) return json(400, { error: "no diver id" });

  // --- the day must be open and the prompt set must be today's (from the frozen schedule)
  const today = dive.dayKey(new Date());
  if (body.day !== today) return json(409, { error: "that day is closed", today });
  const expected: string[] | null = dive.dailyPromptIds(today, b.prompts, dive.LAUNCH_DATE, b.schedule);
  if (!expected || !Array.isArray(body.promptIds) || body.promptIds.join("|") !== expected.join("|")) {
    return json(409, { error: "prompt set does not match today — reload to get the current prompts", dataVersion: b.version });
  }
  if (!Array.isArray(body.answers) || body.answers.length !== dive.PROMPTS_PER_DIVE) return json(400, { error: "need exactly 7 answers" });
  const answers = body.answers.map((a) => ({
    typed: String(a?.typed ?? "").slice(0, MAX_TYPED_LENGTH),
    secondsUsed: Number(a?.secondsUsed) || 0,
    hint: a?.hint === true,
    guesses: Array.isArray(a?.guesses) ? a.guesses.slice(0, MAX_GUESSES_PER_PROMPT).map((g) => String(g).slice(0, MAX_TYPED_LENGTH)) : [],
  }));

  // --- re-score on the server (hint costs deducted, reference-list species accepted at Midnight — same code as the browser)
  const scored = dive.scoreSubmissionFull({ promptIds: expected, answers }, b.prompts, b.entitiesById, b.taxa);
  if (scored.secondsUsed < MIN_PLAUSIBLE_SECONDS) return json(400, { error: "implausibly fast" });
  const flagged = scored.points >= FLAG_POINTS_AT_LEAST && scored.secondsUsed < FLAG_IF_SECONDS_UNDER;

  // --- store (one per diver per day; a duplicate returns the dive already stored)
  const row = { day: today, user_id: userId, device_id: userId ? null : deviceId, prompt_ids: expected, answers, tiers: scored.tiers, points: scored.points, depth: scored.depth, seconds_used: scored.secondsUsed, entity_ids: scored.results.map((r: { entityId: string | null }) => r.entityId), flagged, approved: !flagged };
  const { error } = await admin.from("dives").insert(row);
  let stored = { points: scored.points, depth: scored.depth, tiers: scored.tiers, flagged };
  let duplicate = false;
  if (error) {
    if (!/duplicate|unique/i.test(error.message)) return json(500, { error: error.message });
    duplicate = true;
    const q = admin.from("dives").select("points,depth,tiers,flagged").eq("day", today);
    const { data: existing } = userId ? await q.eq("user_id", userId).maybeSingle() : await q.eq("device_id", deviceId).maybeSingle();
    if (existing) stored = existing as typeof stored;
  }

  // --- place on today's curve
  const { data: curve } = await admin.rpc("daily_curve", { p_day: today, p_device: deviceId });
  const { count: deeper } = await admin.from("dives").select("id", { count: "exact", head: true }).eq("day", today).gt("depth", stored.depth);
  const { count: atOrAbove } = await admin.from("dives").select("id", { count: "exact", head: true }).eq("day", today).gte("depth", stored.depth);
  const total = curve?.total ?? 0;
  const percentile = total ? Math.max(1, Math.ceil((100 * (atOrAbove ?? 1)) / total)) : null;

  return json(200, { ...stored, percentile, rank: (deeper ?? 0) + 1, total, duplicate, dataVersion: b.version });
});
