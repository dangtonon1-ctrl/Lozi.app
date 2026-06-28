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
