// ANGLER — duel Edge Function (Deno). Private duel rooms: create, join, start, answer, tick, leave, rematch, state.
// The rules are shared/duel.js (copied here by tools/sync-shared.js) and answers are validated with the same
// shared/dive.js the browser runs, against the bank in the `bank` table. The hidden fuse is drawn here and the
// deadline is kept in duel_secrets; a pop is decided by this clock whenever any client calls `tick` after the
// deadline. Players hold a per-player token; the public state (never the deadline) is written to duel_rooms, which
// Realtime broadcasts to everyone in the room.
import "./dive.js";
import "./duel.js";
import { createClient } from "npm:@supabase/supabase-js@2";

const BANK_TTL_MS = 10 * 60 * 1000;
const POP_PAUSE_MS = 2600;                 // the popped puffer stays on screen this long before the next round is dealt
const MAX_TYPED_LENGTH = 60;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
// deno-lint-ignore no-explicit-any
const dive = (globalThis as any).FathomDive;
// deno-lint-ignore no-explicit-any
const duel = (globalThis as any).FathomDuel;

type Bank = { prompts: Array<{ id: string; answers: unknown[]; retired?: boolean }>; promptsById: Record<string, unknown>; entitiesById: Record<string, unknown>; taxa: Record<string, string[]>; version: string; loadedAt: number };
let bank: Bank | null = null;
const indexes = new Map<string, unknown>();
// deno-lint-ignore no-explicit-any
async function loadBank(admin: any): Promise<Bank> {
  if (bank && Date.now() - bank.loadedAt < BANK_TTL_MS) return bank;
  const { data: v } = await admin.from("bank").select("data").eq("key", "version").maybeSingle();
  const version = v?.data?.version ?? "";
  if (bank && bank.version === version) { bank.loadedAt = Date.now(); return bank; }
  const { data: rows, error } = await admin.from("bank").select("key,data").in("key", ["prompts", "entities", "taxa"]);
  if (error) throw new Error("bank: " + error.message);
  const by: Record<string, unknown> = {};
  for (const r of rows ?? []) by[r.key] = r.data;
  if (!by.prompts || !by.entities) throw new Error("bank is empty — run node tools/upload-bank.js");
  const prompts = (by.prompts as Bank["prompts"]).filter((p) => p.answers && p.answers.length);
  const entitiesById: Record<string, unknown> = {};
  for (const e of by.entities as Array<{ id: string }>) entitiesById[e.id] = e;
  indexes.clear();
  bank = { prompts, promptsById: dive.byId(prompts), entitiesById, taxa: (by.taxa as Record<string, string[]>) || {}, version, loadedAt: Date.now() };
  return bank;
}
function indexFor(b: Bank, promptId: string) {
  if (!indexes.has(promptId)) indexes.set(promptId, dive.buildIndex(b.promptsById[promptId], b.entitiesById, b.taxa));
  return indexes.get(promptId);
}
const token = () => crypto.randomUUID().replace(/-/g, "");
const playerIdFor = () => "p_" + crypto.randomUUID().slice(0, 8);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const action = String(body.action || "");
  const now = Date.now();

  // who is calling (optional sign-in: signed-in players get duel_played / duel_wins on their profile)
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) !== ANON_KEY) {
    try { const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } }); const { data } = await u.auth.getUser(); userId = data?.user?.id ?? null; } catch { userId = null; }
  }
  const name = String(body.name || "").trim().slice(0, 20);
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : null;

  // deno-lint-ignore no-explicit-any
  async function saveRoom(roomId: string, full: any, secrets: Record<string, unknown>, events: unknown[]) {
    const pub = duel.publicState(full);
    const { error } = await admin.from("duel_rooms").update({ status: full.status, state: pub, seq: full.seq, updated_at: new Date().toISOString() }).eq("id", roomId);
    if (error) throw new Error(error.message);
    const sec = { room_id: roomId, state: full, deadline: full.round ? full.round.deadline : null, fuse_ms: full.round ? full.round.fuseMs : null, ...secrets };
    const { error: e2 } = await admin.from("duel_secrets").upsert(sec);
    if (e2) throw new Error(e2.message);
    if (events.length) await admin.from("duel_events").insert(events.map((ev, i) => ({ room_id: roomId, seq: full.seq - events.length + i + 1, event: ev })));
    return pub;
  }
  // deno-lint-ignore no-explicit-any
  async function loadRoom(roomId: string): Promise<{ full: any; secret: any } | null> {
    if (!roomId || !/^[0-9a-f-]{36}$/.test(roomId)) return null;
    const { data } = await admin.from("duel_secrets").select("state,deadline,fuse_ms,pop_pause_until").eq("room_id", roomId).maybeSingle();
    if (!data) return null;
    return { full: data.state, secret: data };
  }
  async function requirePlayer(roomId: string, tok: string) {
    const { data } = await admin.from("duel_players").select("player_id,user_id").eq("room_id", roomId).eq("token", String(tok || "")).maybeSingle();
    return data ? { playerId: data.player_id as string, userId: data.user_id as string | null } : null;
  }
  // deno-lint-ignore no-explicit-any
  async function finishBookkeeping(full: any) {
    if (full.status !== "finished") return;
    const { data: players } = await admin.from("duel_players").select("player_id,user_id").eq("room_id", full.roomId);
    for (const p of players ?? []) {
      if (!p.user_id) continue;
      const { data: prof } = await admin.from("profiles").select("duel_played,duel_wins").eq("user_id", p.user_id).maybeSingle();
      if (!prof) continue;
      await admin.from("profiles").update({ duel_played: (prof.duel_played || 0) + 1, duel_wins: (prof.duel_wins || 0) + (full.winnerId === p.player_id ? 1 : 0) }).eq("user_id", p.user_id);
    }
  }
  // the server clock decides pops; a pop is followed, after a pause, by the next round
  // deno-lint-ignore no-explicit-any
  async function settle(roomId: string, full: any, secret: any, b: Bank) {
    const events: unknown[] = [];
    let changed = false;
    if (full.status === "playing" && full.round && now >= full.round.deadline) {
      const ev = { type: "pop", t: now, round: full.round.n };
      const next = duel.reduce(full, ev);
      if (next !== full) { full = next; events.push(ev); changed = true; secret = { ...secret, pop_pause_until: now + POP_PAUSE_MS }; }
      await finishBookkeeping({ ...full, roomId });
    }
    if (full.status === "playing" && !full.round && (!secret.pop_pause_until || now >= secret.pop_pause_until)) {
      const promptId = duel.pickPrompt(b.prompts, full.used);
      const ev = promptId ? { type: "next_round", t: now, promptId, fuseMs: duel.drawFuse() } : { type: "end", t: now };
      const next = duel.reduce(full, ev);
      if (next !== full) { full = next; events.push(ev); changed = true; secret = { ...secret, pop_pause_until: null }; }
      await finishBookkeeping({ ...full, roomId });
    }
    return { full, secret, events, changed };
  }

  try {
    const b = await loadBank(admin);
    if (action === "create") {
      if (!name) return json(400, { error: "a name is needed" });
      // sweep: finished rooms older than six hours, anything untouched for two days
      try {
        await admin.from("duel_rooms").delete().eq("status", "finished").lt("updated_at", new Date(now - 6 * 3600 * 1000).toISOString());
        await admin.from("duel_rooms").delete().lt("updated_at", new Date(now - 48 * 3600 * 1000).toISOString());
      } catch { /* next time */ }
      let code = duel.makeCode();
      for (let i = 0; i < 20; i++) {
        const { data } = await admin.from("duel_rooms").select("id").eq("code", code).neq("status", "finished").maybeSingle();
        if (!data) break;
        code = duel.makeCode();
      }
      const playerId = playerIdFor();
      let full = duel.initial({ code, hostId: playerId, t: now });
      const ev = { type: "join", playerId, name, userId, t: now };
      full = duel.reduce(full, ev);
      const { data: room, error } = await admin.from("duel_rooms").insert({ code, status: "lobby", state: duel.publicState(full), seq: full.seq }).select("id").single();
      if (error || !room) return json(500, { error: error?.message || "could not create" });
      const tok = token();
      await admin.from("duel_players").insert({ room_id: room.id, player_id: playerId, token: tok, user_id: userId, device_id: deviceId, name });
      const pub = await saveRoom(room.id, full, {}, [ev]);
      return json(200, { roomId: room.id, code, playerId, token: tok, state: pub, now });
    }
    if (action === "join") {
      if (!name) return json(400, { error: "a name is needed" });
      const code = String(body.code || "").toUpperCase().trim();
      if (!/^[A-Z]{4}$/.test(code)) return json(400, { error: "a room code is four letters" });
      const { data: room } = await admin.from("duel_rooms").select("id,status").eq("code", code).neq("status", "finished").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!room) return json(404, { error: "no open room with that code" });
      const loaded = await loadRoom(room.id);
      if (!loaded) return json(404, { error: "room is gone" });
      let full = loaded.full;
      if (full.status !== "lobby") return json(409, { error: "that duel has already started" });
      if (full.players.length >= duel.MAX_PLAYERS) return json(409, { error: "that room is full (8 players)" });
      const playerId = playerIdFor();
      const ev = { type: "join", playerId, name, userId, t: now };
      const next = duel.reduce(full, ev);
      if (next === full) return json(409, { error: "could not join" });
      full = next;
      const tok = token();
      await admin.from("duel_players").insert({ room_id: room.id, player_id: playerId, token: tok, user_id: userId, device_id: deviceId, name });
      const pub = await saveRoom(room.id, full, {}, [ev]);
      return json(200, { roomId: room.id, code, playerId, token: tok, state: pub, now });
    }
    const roomId = String(body.roomId || "");
    const loaded = await loadRoom(roomId);
    if (!loaded) return json(404, { error: "room not found" });
    let full = loaded.full;
    let secret = loaded.secret;
    if (action === "state" || action === "tick") {
      const s = await settle(roomId, full, secret, b);
      const pub = s.changed ? await saveRoom(roomId, s.full, { pop_pause_until: s.secret.pop_pause_until ?? null }, s.events) : duel.publicState(full);
      return json(200, { state: pub, now });
    }
    const me = await requirePlayer(roomId, body.token);
    if (!me) return json(403, { error: "not a player in this room" });
    if (action === "start") {
      if (full.hostId !== me.playerId) return json(403, { error: "only the host starts" });
      const promptId = duel.pickPrompt(b.prompts, full.used);
      if (!promptId) return json(503, { error: "no questions to deal" });
      const ev = { type: "start", t: now, promptId, fuseMs: duel.drawFuse() };
      const next = duel.reduce(full, ev);
      if (next === full) return json(409, { error: full.players.length < duel.MIN_PLAYERS ? "two players at least" : "cannot start now" });
      const pub = await saveRoom(roomId, next, { pop_pause_until: null }, [ev]);
      return json(200, { state: pub, now });
    }
    if (action === "answer") {
      const s = await settle(roomId, full, secret, b);
      full = s.full; secret = s.secret;
      if (s.changed) await saveRoom(roomId, full, { pop_pause_until: secret.pop_pause_until ?? null }, s.events);
      if (full.status !== "playing" || !full.round) return json(200, { accepted: false, reason: "not_playing", state: duel.publicState(full), now });
      if (full.round.holder !== me.playerId) return json(200, { accepted: false, reason: "not_your_turn", state: duel.publicState(full), now });
      const typed = String(body.typed || "").slice(0, MAX_TYPED_LENGTH);
      const m = dive.matchAnswer(typed, indexFor(b, full.round.promptId), b.entitiesById);
      if (!m.entityId) return json(200, { accepted: false, reason: "not_accepted", correction: m.correction || null, ambiguous: m.ambiguous || null, state: duel.publicState(full), now });
      const said = duel.alreadySaid(full, m.entityId);
      if (said) return json(200, { accepted: false, reason: "already_said", name: said.name, byName: said.byName, state: duel.publicState(full), now });
      // deno-lint-ignore no-explicit-any
      const ent: any = dive.isTaxonId(m.entityId) ? { name: m.name || typed } : b.entitiesById[m.entityId];
      const e1 = { type: "answer", playerId: me.playerId, entityId: m.entityId, name: ent.name, tier: m.tier, t: now, round: full.round.n };
      const e2 = { type: "pass", t: now };
      let next = duel.reduce(full, e1);
      if (next === full) return json(200, { accepted: false, reason: "not_accepted", state: duel.publicState(full), now });
      next = duel.reduce(next, e2);
      const pub = await saveRoom(roomId, next, { pop_pause_until: null }, [e1, e2]);
      return json(200, { accepted: true, entityId: m.entityId, name: ent.name, tier: m.tier, correction: m.correction && m.correction.accepted ? m.correction : null, state: pub, now });
    }
    if (action === "leave") {
      const ev = { type: "leave", playerId: me.playerId, t: now };
      const next = duel.reduce(full, ev);
      if (next === full) return json(200, { state: duel.publicState(full), now });
      await finishBookkeeping({ ...next, roomId });
      const pub = await saveRoom(roomId, next, {}, [ev]);
      return json(200, { state: pub, now });
    }
    if (action === "rematch") {
      if (full.hostId !== me.playerId) return json(403, { error: "only the host starts a rematch" });
      const ev = { type: "rematch", t: now };
      const next = duel.reduce(full, ev);
      if (next === full) return json(409, { error: "the duel is not over" });
      const pub = await saveRoom(roomId, next, { pop_pause_until: null }, [ev]);
      return json(200, { state: pub, now });
    }
    return json(400, { error: "unknown action" });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
