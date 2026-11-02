// FATHOM — submit-dive Edge Function (Deno).
// The browser never sends points: it sends the typed answers and seconds used, and this function re-scores
// them with the SAME shared/dive.js and data files the browser uses (copied into _shared by tools/sync-shared.js).
import "../_shared/dive.js";
import prompts from "../_shared/prompts.json" with { type: "json" };
import entities from "../_shared/entities.json" with { type: "json" };
import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------- parameters
const MIN_PLAUSIBLE_SECONDS = 7;          // seven typed answers cannot take less than this
const FLAG_POINTS_AT_LEAST = 600;         // a near-perfect dive…
const FLAG_IF_SECONDS_UNDER = 20;         // …typed this fast is held for review
const MAX_TYPED_LENGTH = 60;

type Answer = { typed: string; secondsUsed: number };
type Body = { day: string; promptIds: string[]; answers: Answer[]; deviceId?: string; clientDepth?: number };

// deno-lint-ignore no-explicit-any
const dive = (globalThis as any).FathomDive;
const entitiesById: Record<string, unknown> = Object.fromEntries((entities as Array<{ id: string }>).map((e) => [e.id, e]));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(204, {});
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }

  // --- who is diving (signed-in user, or anonymous device)
  let userId: string | null = null;
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) !== ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data } = await userClient.auth.getUser();
    userId = data?.user?.id ?? null;
  }
  const deviceId = typeof body.deviceId === "string" && body.deviceId.length >= 6 && body.deviceId.length <= 64 ? body.deviceId : null;
  if (!userId && !deviceId) return json(400, { error: "no diver id" });

  // --- the day must be open and the prompt set must be today's
  const today = dive.dayKey(new Date());
  if (body.day !== today) return json(409, { error: "that day is closed", today });
  const expected: string[] | null = dive.dailyPromptIds(today, prompts, dive.LAUNCH_DATE);
  if (!expected || !Array.isArray(body.promptIds) || body.promptIds.join("|") !== expected.join("|")) return json(400, { error: "prompt set does not match today" });
  if (!Array.isArray(body.answers) || body.answers.length !== dive.PROMPTS_PER_DIVE) return json(400, { error: "need exactly 7 answers" });
  const answers = body.answers.map((a) => ({ typed: String(a?.typed ?? "").slice(0, MAX_TYPED_LENGTH), secondsUsed: Number(a?.secondsUsed) || 0 }));

  // --- re-score on the server
  const scored = dive.scoreSubmission({ promptIds: expected, answers }, prompts, entitiesById);
  if (scored.secondsUsed < MIN_PLAUSIBLE_SECONDS) return json(400, { error: "implausibly fast" });
  const flagged = scored.points >= FLAG_POINTS_AT_LEAST && scored.secondsUsed < FLAG_IF_SECONDS_UNDER;

  // --- store (one per diver per day; a duplicate returns the stored dive)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const row = { day: today, user_id: userId, device_id: userId ? null : deviceId, prompt_ids: expected, answers, tiers: scored.tiers, points: scored.points, depth: scored.depth, seconds_used: scored.secondsUsed, flagged, approved: !flagged };
  const { error } = await admin.from("dives").insert(row);
  if (error && !/duplicate|unique/i.test(error.message)) return json(500, { error: error.message });

  const { data: curve } = await admin.rpc("daily_curve", { p_day: today, p_device: deviceId });
  // daily_curve resolves the caller from auth.uid(); with the service key there is none, so compute from depth here
  const { count: deeper } = await admin.from("dives").select("id", { count: "exact", head: true }).eq("day", today).gt("depth", scored.depth);
  const { count: atOrAbove } = await admin.from("dives").select("id", { count: "exact", head: true }).eq("day", today).gte("depth", scored.depth);
  const total = curve?.total ?? 0;
  const percentile = total ? Math.max(1, Math.ceil((100 * (atOrAbove ?? 1)) / total)) : null;

  return json(200, { points: scored.points, depth: scored.depth, tiers: scored.tiers, percentile, rank: (deeper ?? 0) + 1, total, flagged, duplicate: !!error });
});
