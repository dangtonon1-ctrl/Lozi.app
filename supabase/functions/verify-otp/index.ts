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
    const { phone, code, purpose = "register" } = await req.json();
    const to = normalizePhone(phone);
    if (!to || !code) return json({ ok: false, reason: "missing" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) Check the code. TEST MODE: while TEST_BYPASS_CODE is set, that exact
    //    code is accepted for any phone (skips Twilio). Real Twilio codes still
    //    work either way. Remove the env var to disable the bypass entirely.
    const bypass = Deno.env.get("TEST_BYPASS_CODE") || "";
    let approved = false;
    if (bypass.length > 0 && String(code) === bypass) {
      approved = true;
    } else {
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
      const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
      const service = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!;
      const resp = await fetch(`https://verify.twilio.com/v2/Services/${service}/VerificationCheck`, {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa(`${sid}:${token}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, Code: String(code) }),
      });
      const data = await resp.json().catch(() => ({}));
      approved = resp.ok && data.status === "approved";
    }
    if (!approved) return json({ ok: false, reason: "invalid_code" });

    // 2) Issue a one-time setup token
    const setup = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    const hash = await sha256(setup);
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    if (purpose === "register") {
      const { data: authz } = await admin.from("vendor_authorizations").select("role,status").eq("phone", to).maybeSingle();
      if (!authz || (authz.status !== "active" && authz.status !== "used")) return json({ ok: false, reason: "not_authorized" });
      const role = authz.role as string;

      let userId: string | null = null;
      const { data: existing } = await admin.rpc("get_user_id_by_phone", { p: to });
      userId = (existing as string) ?? null;
      if (!userId) {
        const { data: created, error } = await admin.auth.admin.createUser({ phone: to, phone_confirm: true, user_metadata: { role } });
        if (error) return json({ ok: false, reason: "create_failed", detail: error.message }, 500);
        userId = created.user!.id;
        const table = role === "farmer" ? "farmers" : role === "retail" ? "retail_stores" : "wholesale_stores";
        await admin.from(table).insert({ user_id: userId, phone: to });
      }
      await admin.from("vendor_authorizations").update({ status: "used" }).eq("phone", to);
      await admin.from("vendor_setup_tokens").insert({ phone: to, token_hash: hash, purpose: "register", expires_at });
      return json({ ok: true, setup_token: setup, role });
    } else {
      const { data: uid } = await admin.rpc("get_user_id_by_phone", { p: to });
      if (!uid) return json({ ok: false, reason: "no_account" });
      await admin.from("vendor_setup_tokens").insert({ phone: to, token_hash: hash, purpose: "reset", expires_at });
      return json({ ok: true, setup_token: setup });
    }
  } catch (e) {
    return json({ ok: false, reason: "error", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
