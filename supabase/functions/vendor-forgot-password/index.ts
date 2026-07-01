import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const normalizePhone = (p: string) => { let s = (p || "").replace(/[^0-9+]/g, ""); if (!s.startsWith("+")) s = "+967" + s.replace(/^0+/, ""); return s; };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
async function sha256(t: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { phone, setup_token, password } = await req.json();
    const to = normalizePhone(phone);
    if (!to || !setup_token) return json({ ok: false, reason: "missing" }, 400);
    // Vendor accounts (farmers / retail / wholesale) may use a 4-character
    // minimum password. This endpoint is vendor-only (register set-password and
    // OTP reset both route here), so the floor is 4 for every caller. Customers
    // never reach this function; they keep their 6-character minimum.
    if (!password || String(password).length < 4) return json({ ok: false, reason: "weak_password" });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const hash = await sha256(setup_token);
    const { data: tok } = await admin.from("vendor_setup_tokens").select("id")
      .eq("phone", to).eq("token_hash", hash).eq("used", false)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!tok) return json({ ok: false, reason: "invalid_token" });

    const { data: uid } = await admin.rpc("get_user_id_by_phone", { p: to });
    if (!uid) return json({ ok: false, reason: "no_account" });

    const { error } = await admin.auth.admin.updateUserById(uid as string, { password: String(password) });
    if (error) return json({ ok: false, reason: "update_failed", detail: error.message }, 500);

    await admin.from("vendor_setup_tokens").update({ used: true }).eq("id", (tok as { id: string }).id);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, reason: "error", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
