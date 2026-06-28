# Confirmation email not received — diagnosis & fix

## TL;DR
There were **two** separate problems behind "the confirmation email never arrives":

1. **App bug (fixed in this branch):** Signing up again with an email that
   already has an account silently showed *"Account created — check your email"*
   even though Supabase never sends an email in that case. The email in the
   reported screenshot (`dangtonon12@gmail.com`) already had a **confirmed**
   account from Jun 17, so no email was ever sent.
2. **Email deliverability (needs a dashboard change — see below):** Supabase's
   built-in email service is rate-limited and intended for testing only, so
   confirmation emails to real inboxes (Gmail, etc.) are unreliable.

---

## 1. App bug — already fixed (`index.html`)

When email confirmation is enabled and you call `auth.signUp` with an email that
**already exists**, Supabase deliberately returns a *success-looking* response —
no session, no error — to prevent email enumeration. It does **not** send a new
email. The old code treated "no session" as "new user" and told the user to
check their inbox.

The detectable signal for this case is `data.user.identities.length === 0`. The
signup handler now checks for it and returns a clear message instead:

> هذا البريد الإلكتروني مسجّل بالفعل. إن لم تؤكّد حسابك بعد فابحث عن رسالة
> التأكيد في بريدك، وإلا فسجّل الدخول مباشرة.

So a returning user is now told to log in instead of waiting for an email that
will never come.

---

## 2. Email deliverability — Supabase Dashboard change required

Evidence from the project's `auth.users` and auth logs:
- Most early accounts were **auto-confirmed** (email confirmation was OFF when
  they were created — `confirmation_sent_at` is null but `email_confirmed_at` is
  set).
- The accounts that *did* get a confirmation email and confirmed quickly were
  all **disposable test inboxes** (e.g. `*.divahd.com`, `*.afterdo.com`).
- Real Gmail addresses pending confirmation never confirmed.

The default Supabase email sender is **rate-limited (only a few emails per hour,
shared) and is explicitly "for testing only"** — it is not meant for production
and frequently fails to reach real inboxes (no SPF/DKIM aligned to your domain).

### Fix: configure a custom SMTP provider
In the Supabase Dashboard → **Authentication → Emails / SMTP Settings**, enable
**Custom SMTP** with a real provider:

- **Resend**, **SendGrid**, **Brevo (Sendinblue)**, **Mailgun**, or **Amazon SES**.
- Set a verified sender domain (configure SPF + DKIM DNS records) so Gmail
  doesn't drop the messages.
- Raise the auth email rate limit under **Authentication → Rate Limits** once
  custom SMTP is in place.

Also confirm:
- **Authentication → URL Configuration → Redirect URLs** includes the app
  origins (`https://lozi-app.loonqori.workers.dev` and the Vercel URL) so the
  `emailRedirectTo` link is accepted.
- The **Confirm signup** email template is enabled.

### Alternative (if you don't want email verification for customers)
If email confirmation isn't required for the customer flow, turn off
**"Confirm email"** in Authentication settings. Customers then get a session
immediately on signup (the app already handles this — it inserts the customer
row and proceeds), and no confirmation email is needed.

---

## 3. Resend integration (Auth "Send Email" hook) — added in this branch

Instead of (or in addition to) custom SMTP, all auth emails now go through
**Resend** via a Supabase Auth hook. The edge function lives at
`supabase/functions/send-email/` and is already **deployed** to the project. It:

- verifies the Standard Webhooks signature from Supabase,
- renders branded Arabic (RTL) templates for each action type
  (signup, recovery, magic link, email change, invite, reauthentication),
- sends the message through the Resend API,
- returns the Resend error to Supabase on failure so the email isn't silently
  marked as sent.

### Remaining one-time setup (Dashboard / CLI — needs your Resend account)

1. **Create a Resend account & verify a sending domain**
   (Resend → Domains → add your domain, then add the SPF/DKIM DNS records).
   Create an API key (`re_...`).

2. **Set the function secrets** (Supabase → Edge Functions → Secrets, or CLI):
   ```bash
   supabase secrets set \
     RESEND_API_KEY=re_xxxxxxxx \
     RESEND_FROM="لوزي <no-reply@your-domain.com>"
   ```
   > While testing before a domain is verified, you can use Resend's sandbox
   > sender `onboarding@resend.dev` (delivers only to your own Resend account
   > email). `RESEND_FROM` already defaults to it if unset.

3. **Enable the Send Email hook** (Supabase → Authentication → Hooks →
   *Send Email* → enable, type **HTTPS**):
   - **URL:** `https://niloddwnllhsvrmuxfxw.supabase.co/functions/v1/send-email`
   - Copy the generated **secret** (`v1,whsec_...`) and set it as a function
     secret:
     ```bash
     supabase secrets set SEND_EMAIL_HOOK_SECRET="v1,whsec_xxxxxxxx"
     ```

4. **Confirm redirect URLs** (Authentication → URL Configuration → Redirect
   URLs) include the app origins so the confirmation link is accepted:
   `https://lozi-app.loonqori.workers.dev` and the Vercel URL.

Once the hook is enabled and the three secrets are set, signup confirmation and
password-reset emails are delivered by Resend. No app code change is needed —
the existing `auth.signUp` / `resetPasswordForEmail` calls trigger the hook
automatically.

### Re-deploying the function later
```bash
supabase functions deploy send-email --no-verify-jwt
```
(`verify_jwt = false` is also pinned in `supabase/config.toml`.)
