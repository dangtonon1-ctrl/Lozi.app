import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "npm:standardwebhooks@1.0.0";

// Supabase Auth "Send Email" hook.
//
// Supabase calls this function whenever it needs to send an auth email
// (signup confirmation, password recovery, magic link, email change, invite,
// reauthentication). It replaces the rate-limited built-in email sender with
// Resend so messages actually reach real inboxes.
//
// Required secrets (set with: supabase secrets set ...):
//   RESEND_API_KEY          - Resend API key (re_...)
//   RESEND_FROM             - verified sender, e.g. "لوزي <no-reply@your-domain.com>"
//   SEND_EMAIL_HOOK_SECRET  - the hook signing secret from the Supabase dashboard
//                             (the "v1,whsec_..." value shown when you enable the hook)
// Optional:
//   SUPABASE_URL            - injected automatically; used to build the verify link

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Lozi <onboarding@resend.dev>";
const HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "";
const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";

interface EmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
}

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

// Builds the Supabase verification URL that confirms the action when clicked.
function verifyUrl(d: EmailData): string {
  const base = (PROJECT_URL || d.site_url).replace(/\/$/, "");
  const params = new URLSearchParams({
    token: d.token_hash,
    type: d.email_action_type,
    redirect_to: d.redirect_to || d.site_url,
  });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

// Subject + body per action type, in Arabic (RTL) with Lozi branding.
function render(d: EmailData): { subject: string; html: string } {
  const link = verifyUrl(d);
  const code = d.token;

  const copy: Record<string, { subject: string; title: string; lead: string; cta: string }> = {
    signup: {
      subject: "أكّد بريدك الإلكتروني — لوزي",
      title: "مرحباً بك في لوزي 👋",
      lead: "لإكمال إنشاء حسابك، أكّد بريدك الإلكتروني بالضغط على الزر أدناه.",
      cta: "تأكيد الحساب",
    },
    recovery: {
      subject: "إعادة تعيين كلمة المرور — لوزي",
      title: "إعادة تعيين كلمة المرور",
      lead: "وصلنا طلب لإعادة تعيين كلمة مرور حسابك. اضغط الزر أدناه لتعيين كلمة مرور جديدة. إن لم تطلب ذلك، تجاهل هذه الرسالة.",
      cta: "تعيين كلمة مرور جديدة",
    },
    magiclink: {
      subject: "رابط الدخول — لوزي",
      title: "تسجيل الدخول إلى لوزي",
      lead: "اضغط الزر أدناه لتسجيل الدخول إلى حسابك.",
      cta: "تسجيل الدخول",
    },
    email_change: {
      subject: "أكّد بريدك الإلكتروني الجديد — لوزي",
      title: "تأكيد تغيير البريد الإلكتروني",
      lead: "لإكمال تغيير بريدك الإلكتروني، أكّد العنوان الجديد بالضغط على الزر أدناه.",
      cta: "تأكيد البريد الجديد",
    },
    invite: {
      subject: "دعوة للانضمام إلى لوزي",
      title: "لقد تمت دعوتك إلى لوزي",
      lead: "اضغط الزر أدناه لقبول الدعوة وإنشاء حسابك.",
      cta: "قبول الدعوة",
    },
    reauthentication: {
      subject: "رمز التحقق — لوزي",
      title: "رمز التحقق",
      lead: "استخدم الرمز التالي لإتمام العملية:",
      cta: "",
    },
  };

  const c = copy[d.email_action_type] ?? copy.signup;

  const button = c.cta
    ? `<a href="${esc(link)}" style="display:inline-block;background:#3C7A50;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:14px">${esc(c.cta)}</a>`
    : `<div style="font-size:32px;letter-spacing:8px;font-weight:800;color:#2C271C;background:#F4ECDC;border-radius:14px;padding:18px 0">${esc(code)}</div>`;

  const altLink = c.cta
    ? `<p style="font-size:12px;color:#A39A88;margin:22px 0 0;word-break:break-all">إن لم يعمل الزر، انسخ هذا الرابط في متصفحك:<br><a href="${esc(link)}" style="color:#3C7A50">${esc(link)}</a></p>`
    : "";

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#FAF7F2;font-family:'Cairo',-apple-system,Segoe UI,Tahoma,sans-serif;color:#2C271C">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <div style="background:#FFFFFF;border:1px solid #EEE5D4;border-radius:24px;padding:32px;text-align:center;box-shadow:0 8px 26px rgba(74,59,40,.08)">
      <div style="font-size:26px;font-weight:800;color:#3C7A50;margin-bottom:18px">لوزي</div>
      <h1 style="font-size:20px;margin:0 0 12px">${esc(c.title)}</h1>
      <p style="font-size:15px;line-height:1.8;color:#6E6557;margin:0 0 26px">${esc(c.lead)}</p>
      ${button}
      ${altLink}
    </div>
    <p style="text-align:center;font-size:12px;color:#A39A88;margin:20px 0 0">هذه رسالة آلية من تطبيق لوزي، الرجاء عدم الرد عليها.</p>
  </div>
</body>
</html>`;

  return { subject: c.subject, html };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const payload = await req.text();

  let user: { email: string };
  let email_data: EmailData;
  try {
    if (!HOOK_SECRET) throw new Error("hook secret not configured");
    const headers = Object.fromEntries(req.headers);
    const wh = new Webhook(HOOK_SECRET.replace("v1,whsec_", ""));
    const verified = wh.verify(payload, headers) as { user: { email: string }; email_data: EmailData };
    user = verified.user;
    email_data = verified.email_data;
  } catch (e) {
    console.error("webhook verification failed:", (e as Error)?.message);
    return new Response(JSON.stringify({ error: { http_code: 401, message: "invalid signature" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { subject, html } = render(email_data);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: [user.email], subject, html }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("resend send failed:", res.status, detail);
      // Surface the error to Supabase so it doesn't mark the email as sent.
      return new Response(JSON.stringify({ error: { http_code: 502, message: detail } }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("send-email error:", (e as Error)?.message);
    return new Response(JSON.stringify({ error: { http_code: 500, message: String((e as Error)?.message ?? e) } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Empty 200 tells Supabase the hook handled delivery.
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
});
