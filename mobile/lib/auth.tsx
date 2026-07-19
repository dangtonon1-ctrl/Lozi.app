import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { copy } from './copy';
import { normalizeDigits } from './normalizeDigits';
import { supabase } from './supabase';

// Roles as stored in profiles.role (server-controlled since migration 20260742).
export type Role = 'customer' | 'farmer' | 'farmer_almond' | 'retail' | 'wholesale';
export type Person = { name: string; phone: string };

export type AuthResult = {
  ok: boolean;
  error?: string;
  reason?: string;
  needsConfirm?: boolean;
  alreadyRegistered?: boolean;
  setup_token?: string;
  role?: string;
};

type AuthStatus = 'checking' | 'authed' | 'signedOut';

// Yemen +967 default, mirrors the web app's e164(). normalizeDigits first so
// Arabic-Indic / Persian numerals (from Yemeni keyboards) become Latin before the
// [^0-9] strip — otherwise every digit is dropped and the phone breaks silently.
export const e164 = (p: string) => {
  const s = normalizeDigits(String(p));
  return s.charAt(0) === '+' ? s : '+967' + s.replace(/[^0-9]/g, '').replace(/^0+/, '');
};

// Map any Supabase auth error to an Arabic string. A raw error.message must
// NEVER reach the UI: known cases map to existing copy, everything else falls
// back to a generic Arabic message. `creds` is used only for invalid_credentials
// (customer vs vendor wording); `fallback` overrides the generic default.
function mapAuthError(err: unknown, opts?: { creds?: string; fallback?: string }): string {
  const e = (err ?? {}) as { code?: string; message?: string; status?: number };
  const code = String(e.code ?? '').toLowerCase();
  const msg = String(e.message ?? '').toLowerCase();
  const fallback = opts?.fallback ?? copy.errGeneric;
  if (e.status === 429 || code.includes('rate') || msg.includes('rate limit') || msg.includes('too many'))
    return copy.errRateLimited;
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials'))
    return opts?.creds ?? copy.errGeneric;
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return copy.needsConfirm;
  if (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    msg.includes('already registered') ||
    msg.includes('already been registered')
  )
    return copy.errEmailAlreadyRegistered;
  if (code === 'weak_password' || msg.includes('password should be')) return copy.errCustomerPwLen;
  return fallback;
}

// Map an edge-function reason code (verify-otp / request-otp) to Arabic.
function mapReason(reason: string): string {
  switch (reason) {
    case 'not_authorized':
      return copy.errNotAuthorized;
    case 'invalid_code':
      return copy.errBadOrExpiredCode;
    case 'rate_limited':
      return copy.errRateLimited;
    default:
      return copy.errGeneric;
  }
}

// Edge-function caller. Returns an Arabic `error` on any failure (mapped from the
// structured {reason}); `reason` is kept for callers that need to branch, but the
// raw reason/message is never surfaced.
async function invokeFn(fn: string, body: Record<string, unknown>): Promise<AuthResult> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (!error) {
    const d = (data ?? { ok: false }) as AuthResult;
    if (d.ok) return d;
    return { ok: false, reason: d.reason, error: mapReason(String(d.reason ?? '')) };
  }
  let reason = '';
  try {
    const b = await (error as { context: Response }).context.json();
    reason = String(b?.reason ?? '');
  } catch {
    /* body unreadable — fall through to generic */
  }
  return { ok: false, reason, error: mapReason(reason) };
}

async function isBanned(uid: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('status')
    .eq('user_id', uid)
    .maybeSingle();
  if (error || !data) return false;
  return data.status === 'banned';
}

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  role: Role | null;
  person: Person;
  recovery: boolean; // true while a PASSWORD_RECOVERY link is being handled
  customerSignIn: (a: { email: string; password: string }) => Promise<AuthResult>;
  customerSignUp: (a: {
    name: string;
    email: string;
    password: string;
    phone: string;
  }) => Promise<AuthResult>;
  customerForgot: (a: { email: string }) => Promise<AuthResult>;
  vendorSignIn: (a: { phone: string; password: string }) => Promise<AuthResult>;
  vendorSendOtp: (a: { phone: string; purpose?: string }) => Promise<AuthResult>;
  vendorVerifyOtp: (a: {
    phone: string;
    code: string;
    purpose?: string;
    default_crop?: string;
  }) => Promise<AuthResult>;
  vendorSetPassword: (a: {
    phone: string;
    setup_token: string;
    password: string;
  }) => Promise<AuthResult>;
  setNewPassword: (a: { password: string }) => Promise<AuthResult>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = not checked yet; null = no session; Session = signed in.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [role, setRole] = useState<Role | null>(null);
  const [person, setPerson] = useState<Person>({ name: '', phone: '' });
  const [recovery, setRecovery] = useState(false);

  // Restore any persisted session on boot, then track auth changes. We only
  // touch `session` here — deriving role/ban status calls supabase, which must
  // not run inside the onAuthStateChange callback (deadlock risk), so it lives
  // in the effect below.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(next ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Derive role/person from the SERVER-authoritative profiles row (not
  // user_metadata) and enforce the ban check, whenever the session changes.
  useEffect(() => {
    if (session === undefined) return; // still checking
    const uid = session?.user?.id;
    if (!uid) {
      setRole(null);
      setPerson({ name: '', phone: '' });
      setStatus('signedOut');
      return;
    }
    let active = true;
    (async () => {
      const { data: prof } = await supabase
        .from('profiles')
        .select('role,name,phone,status')
        .eq('user_id', uid)
        .maybeSingle();
      if (!active) return;
      if (prof?.status === 'banned') {
        await supabase.auth.signOut(); // → session null → this effect re-runs → signedOut
        return;
      }
      const md = (session?.user.user_metadata ?? {}) as Record<string, string | undefined>;
      setRole((prof?.role as Role) ?? (md.role as Role) ?? 'customer');
      setPerson({
        name: prof?.name ?? md.name ?? '',
        phone: prof?.phone ?? md.phone ?? '',
      });
      setStatus('authed');
    })();
    return () => {
      active = false;
    };
  }, [session]);

  const customerSignIn = useCallback<AuthContextValue['customerSignIn']>(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: mapAuthError(error, { creds: copy.errCustomerCreds }) };
    if (data.user && (await isBanned(data.user.id))) {
      await supabase.auth.signOut();
      return { ok: false, error: copy.errAccountSuspended };
    }
    return { ok: true };
  }, []);

  const customerSignUp = useCallback<AuthContextValue['customerSignUp']>(
    async ({ name, email, password, phone }) => {
      // role:'customer' is now ignored server-side (migration 20260742) but kept
      // to match the web signup contract; the server forces 'customer' anyway.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role: 'customer', name, phone: e164(phone) } },
      });
      if (error) return { ok: false, error: mapAuthError(error) };
      if (data.session) {
        if (data.user) {
          try {
            await supabase
              .from('customers')
              .insert({ user_id: data.user.id, full_name: name, phone: e164(phone), email });
          } catch {
            /* non-fatal, mirrors web */
          }
        }
        return { ok: true };
      }
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { ok: false, alreadyRegistered: true, error: copy.errEmailAlreadyRegistered };
      }
      return { ok: true, needsConfirm: true };
    },
    [],
  );

  const customerForgot = useCallback<AuthContextValue['customerForgot']>(async ({ email }) => {
    // Option A: no redirectTo → Supabase uses the project's Site URL (the frozen
    // web app) for the reset link. In-app lozi://reset is a tracked open item.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    return error ? { ok: false, error: mapAuthError(error, { fallback: copy.errSendFailed }) } : { ok: true };
  }, []);

  const vendorSignIn = useCallback<AuthContextValue['vendorSignIn']>(async ({ phone, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ phone: e164(phone), password });
    if (error) return { ok: false, error: mapAuthError(error, { creds: copy.errVendorCreds }) };
    if (data.user && (await isBanned(data.user.id))) {
      await supabase.auth.signOut();
      return { ok: false, error: copy.errAccountSuspended };
    }
    return { ok: true };
  }, []);

  const vendorSendOtp = useCallback<AuthContextValue['vendorSendOtp']>(
    ({ phone, purpose = 'register' }) => invokeFn('request-otp', { phone: e164(phone), purpose }),
    [],
  );
  const vendorVerifyOtp = useCallback<AuthContextValue['vendorVerifyOtp']>(
    ({ phone, code, purpose = 'register', default_crop }) =>
      invokeFn('verify-otp', { phone: e164(phone), code, purpose, default_crop }),
    [],
  );
  const vendorSetPassword = useCallback<AuthContextValue['vendorSetPassword']>(
    ({ phone, setup_token, password }) =>
      invokeFn('vendor-forgot-password', { phone: e164(phone), setup_token, password }),
    [],
  );

  const setNewPassword = useCallback<AuthContextValue['setNewPassword']>(async ({ password }) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: mapAuthError(error, { fallback: copy.errSavePwFailed }) };
    setRecovery(false);
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* session state resets via onAuthStateChange regardless */
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session: session ?? null,
      userId: session?.user?.id ?? null,
      role,
      person,
      recovery,
      customerSignIn,
      customerSignUp,
      customerForgot,
      vendorSignIn,
      vendorSendOtp,
      vendorVerifyOtp,
      vendorSetPassword,
      setNewPassword,
      logout,
    }),
    [
      status,
      session,
      role,
      person,
      recovery,
      customerSignIn,
      customerSignUp,
      customerForgot,
      vendorSignIn,
      vendorSendOtp,
      vendorVerifyOtp,
      vendorSetPassword,
      setNewPassword,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
