// FATHOM — stripe-webhook Edge Function (Deno). Deploy with --no-verify-jwt (Stripe calls it unauthenticated).
// On checkout.session.completed it writes one entitlement row. The product comes from the Payment Link's
// metadata.product_id, or from STRIPE_PRICE_MAP ({"price_123":"supporter", ...}) as a fallback.
// client_reference_id is "<user_id>" or "<user_id>:<pack_id>" for a single-pack purchase (see monetise.js).
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRODUCT_IDS = new Set(["supporter", "archive", "packs-all", "pack"]);

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  const whsec = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret || !whsec) return new Response("stripe not configured", { status: 500 });
  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });
  const sig = req.headers.get("stripe-signature") || "";
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, whsec, undefined, Stripe.createSubtleCryptoProvider());
  } catch (e) {
    return new Response("bad signature: " + (e as Error).message, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const ref = session.client_reference_id || "";
    const [userId, packId] = ref.split(":");
    if (!userId) return new Response("no client_reference_id", { status: 200 });

    let productId = (session.metadata && session.metadata.product_id) || "";
    if (!productId) {
      const map = JSON.parse(Deno.env.get("STRIPE_PRICE_MAP") || "{}");
      const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ["line_items"] });
      const price = full.line_items?.data?.[0]?.price?.id || "";
      productId = map[price] || "";
    }
    if (!PRODUCT_IDS.has(productId)) return new Response("unknown product " + productId, { status: 200 });
    const entitlement = productId === "pack" ? "pack:" + (packId || "") : productId;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await admin.from("entitlements").upsert({ user_id: userId, product_id: entitlement, payment_session_id: session.id }, { onConflict: "payment_session_id" });
    if (error && !/duplicate|unique/i.test(error.message)) return new Response("db error: " + error.message, { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
