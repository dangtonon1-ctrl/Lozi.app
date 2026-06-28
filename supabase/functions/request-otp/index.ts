import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizePhone(p: string): string {
  let s = (p || "").replace(/[^0-9+]/g, "");
  if (!s.startsWith("+")) s = "+967" + s.replace(/^0+/, "");
  return s;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { phone, purpose = "register" } = await req.json();
    const to = normalizePhone(phone);
    if (!to || to.length < 8) return json({ ok: false, reason: "invalid_phone" }, 400);

    // TEST MODE: enabled only while TEST_BYPASS_CODE is set. Lets testers skip
    // the SMS step (the code is accepted in verify-otp). Admin authorization is
    // still required, so the role is always known. Remove the env var to disable.
    const testMode = (Deno.env.get("TEST_BYPASS_CODE") || "").length > 0;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) Vendor must be authorized by admin (register only)
    if (purpose === "register") {
      const { data: authz } = await admin.from("vendor_authorizations").select("status").eq("phone", to).maybeSingle();
      if (!authz || authz.status !== "active") {
        await admin.from("otp_attempts").insert({ phone: to, purpose, result: "not_authorized" });
        return json({ ok: false, reason: "not_authorized" });
      }
    }

    // 2) Rate limit: one successful send per 24h (skipped in test mode)
    if (!testMode) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await admin.from("otp_attempts").select("id", { count: "exact", head: true })
        .eq("phone", to).eq("result", "sent").gte("created_at", since);
      if ((count ?? 0) >= 3) {
        await admin.from("otp_attempts").insert({ phone: to, purpose, result: "rate_limited" });
        return json({ ok: false, reason: "rate_limited" });
      }
    }

    // 3) Send OTP via Twilio Verify (SMS).
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const service = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!;
    let sendOk = false;
    try {
      const resp = await fetch(`https://verify.twilio.com/v2/Services/${service}/Verifications`, {
        method: "POST",
        headers: { "Authorization": "Basic " + btoa(`${sid}:${token}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, Channel: "sms" }),
      });
      sendOk = resp.ok;
      if (!resp.ok && !testMode) {
        const detail = await resp.text();
        await admin.from("otp_attempts").insert({ phone: to, purpose, result: "failed" });
        return json({ ok: false, reason: "send_failed", detail }, 502);
      }
    } catch (e) {
      // In test mode a real SMS may be impossible (fake number) — proceed anyway.
      if (!testMode) {
        await admin.from("otp_attempts").insert({ phone: to, purpose, result: "failed" });
        return json({ ok: false, reason: "send_failed", detail: String((e as Error)?.message ?? e) }, 502);
      }
    }
    await admin.from("otp_attempts").insert({ phone: to, purpose, result: "sent" });
    return json({ ok: true, test_mode: testMode && !sendOk ? true : undefined });
  } catch (e) {
    return json({ ok: false, reason: "error", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
