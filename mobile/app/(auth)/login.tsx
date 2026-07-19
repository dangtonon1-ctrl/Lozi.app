import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type KeyboardTypeOptions,
  View,
} from 'react-native';

import { useAuth } from '../../lib/auth';
import { copy, validate } from '../../lib/copy';
import { normalizeDigits } from '../../lib/normalizeDigits';
import { colors, fonts } from '../../lib/theme';

type Tab = 'customer' | 'vendor';
type ForgotState = 'off' | 'on' | 'sent';
type VForgot = 'off' | 'phone' | 'code' | 'newpw';

export default function Login() {
  const { customerSignIn, vendorSignIn, customerForgot, vendorSendOtp, vendorVerifyOtp, vendorSetPassword } =
    useAuth();
  const [tab, setTab] = useState<Tab>('customer');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [forgot, setForgot] = useState<ForgotState>('off');

  // vendor password reset (OTP): phone → code → newpw
  const [vforgot, setVforgot] = useState<VForgot>('off');
  const [code, setCode] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [newpw, setNewpw] = useState('');

  const emailOk = validate.email(email);
  const phoneOk = validate.phone(phone);

  const switchTab = (t: Tab) => {
    setTab(t);
    setErr('');
    setForgot('off');
    setVforgot('off');
    setPassword('');
  };

  // On success the AuthProvider status flips to 'authed' and (auth)/_layout
  // redirects to /home — no manual navigation needed here.
  const doCustomerLogin = async () => {
    setErr('');
    setBusy(true);
    const r = await customerSignIn({ email, password });
    setBusy(false);
    if (!r.ok) setErr(r.error || copy.errCustomerCreds);
  };

  const doVendorLogin = async () => {
    setErr('');
    setBusy(true);
    const r = await vendorSignIn({ phone, password });
    setBusy(false);
    if (!r.ok) setErr(r.error || copy.errVendorCreds);
  };

  const doForgotSend = async () => {
    if (!emailOk) {
      setErr(copy.errEnterEmail);
      return;
    }
    setErr('');
    setBusy(true);
    const r = await customerForgot({ email });
    setBusy(false);
    if (r.ok) setForgot('sent');
    else setErr(r.error || copy.errSendFailed);
  };

  // ── Vendor password reset (mirrors web forgotSend / forgotVerify / forgotSet) ──
  const openVendorReset = () => {
    setErr('');
    setPassword('');
    setCode('');
    setNewpw('');
    setVforgot('phone');
  };

  const vendorResetSend = async () => {
    if (!phoneOk) return;
    setErr('');
    setBusy(true);
    const r = await vendorSendOtp({ phone, purpose: 'reset' });
    setBusy(false);
    if (r.ok) {
      setVforgot('code');
      return;
    }
    setErr(r.error || copy.errSendCodeFailed);
  };

  const vendorResetVerify = async () => {
    setErr('');
    setBusy(true);
    const r = await vendorVerifyOtp({ phone, code: code.trim(), purpose: 'reset' });
    setBusy(false);
    if (r.ok && r.setup_token) {
      setSetupToken(r.setup_token);
      setVforgot('newpw');
      return;
    }
    setErr(r.error || copy.errBadOrExpiredCode);
  };

  const vendorResetSave = async () => {
    if (!validate.vendorPassword(newpw)) {
      setErr(copy.errVendorPwLen);
      return;
    }
    setErr('');
    setBusy(true);
    const r = await vendorSetPassword({ phone, setup_token: setupToken, password: newpw });
    if (!r.ok) {
      setBusy(false);
      setErr(r.error || copy.errSavePwFailed);
      return;
    }
    const s = await vendorSignIn({ phone, password: newpw });
    setBusy(false);
    if (!s.ok) setErr(s.error || copy.errSignInFailed);
    // ok → AuthProvider flips to authed → (auth)/_layout redirects to /home.
  };

  const sentToLabel = copy.otpSentPrefix + normalizeDigits(phone).replace(/[^0-9]/g, '');

  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>لوزي</Text>
      <Text style={styles.title}>{copy.loginTitle}</Text>

      <View style={styles.tabs}>
        <TabButton label={copy.tabCustomer} active={tab === 'customer'} onPress={() => switchTab('customer')} />
        <TabButton label={copy.tabVendor} active={tab === 'vendor'} onPress={() => switchTab('vendor')} />
      </View>

      {tab === 'customer' && forgot === 'off' && (
        <>
          <Field label={copy.email} value={email} onChangeText={setEmail} placeholder={copy.emailPlaceholder} keyboardType="email-address" />
          <PasswordField value={password} onChangeText={setPassword} show={showPw} onToggle={() => setShowPw((v) => !v)} />
          <ErrorText text={err} />
          <PrimaryButton label={busy ? copy.busy : copy.signIn} disabled={busy || !emailOk || !password} onPress={doCustomerLogin} />
          <Pressable onPress={() => { setErr(''); setForgot('on'); }} hitSlop={8}>
            <Text style={styles.link}>{copy.forgotLink}</Text>
          </Pressable>
        </>
      )}

      {tab === 'customer' && forgot === 'on' && (
        <>
          <Text style={styles.sub}>{copy.customerForgotPrompt}</Text>
          <Field label={copy.email} value={email} onChangeText={setEmail} placeholder={copy.emailPlaceholder} keyboardType="email-address" />
          <ErrorText text={err} />
          <PrimaryButton label={busy ? copy.busy : copy.cont} disabled={busy || !emailOk} onPress={doForgotSend} />
          <Pressable onPress={() => { setErr(''); setForgot('off'); }} hitSlop={8}>
            <Text style={styles.link}>{copy.signIn}</Text>
          </Pressable>
        </>
      )}

      {tab === 'customer' && forgot === 'sent' && (
        <Text style={styles.sent}>{copy.forgotSent}</Text>
      )}

      {/* ── Vendor: sign in ─────────────────────────────────────────────── */}
      {tab === 'vendor' && vforgot === 'off' && (
        <>
          <Field label={copy.phone} value={phone} onChangeText={(t) => setPhone(normalizeDigits(t))} placeholder={copy.phonePlaceholder} keyboardType="number-pad" />
          <PasswordField value={password} onChangeText={setPassword} show={showPw} onToggle={() => setShowPw((v) => !v)} />
          <ErrorText text={err} />
          <PrimaryButton label={busy ? copy.busy : copy.signIn} disabled={busy || !phoneOk || !password} onPress={doVendorLogin} />
          <Pressable onPress={openVendorReset} hitSlop={8}>
            <Text style={styles.link}>{copy.forgotLink}</Text>
          </Pressable>
        </>
      )}

      {/* ── Vendor reset: phone → send OTP ──────────────────────────────── */}
      {tab === 'vendor' && vforgot === 'phone' && (
        <>
          <Text style={styles.sub}>{copy.vendorForgotPrompt}</Text>
          <Field label={copy.phone} value={phone} onChangeText={(t) => setPhone(normalizeDigits(t))} placeholder={copy.phonePlaceholder} keyboardType="number-pad" />
          <ErrorText text={err} />
          <PrimaryButton label={busy ? copy.sending : copy.cont} disabled={busy || !phoneOk} onPress={vendorResetSend} />
          <Pressable onPress={() => { setErr(''); setVforgot('off'); }} hitSlop={8}>
            <Text style={styles.link}>{copy.signIn}</Text>
          </Pressable>
        </>
      )}

      {/* ── Vendor reset: OTP code ──────────────────────────────────────── */}
      {tab === 'vendor' && vforgot === 'code' && (
        <>
          <Text style={styles.sub}>{sentToLabel}</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{copy.otpCodeLabel}</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={(t) => setCode(normalizeDigits(t).replace(/[^0-9]/g, ''))}
              placeholder={copy.otpCodePlaceholder}
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ErrorText text={err} />
          <PrimaryButton label={busy ? copy.otpVerifying : copy.otpVerify} disabled={busy || code.trim().length < 4} onPress={vendorResetVerify} />
          <Pressable onPress={vendorResetSend} disabled={busy} hitSlop={8}>
            <Text style={styles.link}>{copy.otpResend}</Text>
          </Pressable>
        </>
      )}

      {/* ── Vendor reset: new password ──────────────────────────────────── */}
      {tab === 'vendor' && vforgot === 'newpw' && (
        <>
          <Text style={styles.sub}>{copy.resetTitle}</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{copy.passwordNew}</Text>
            <View style={styles.pwWrap}>
              <TextInput
                style={styles.pwInput}
                value={newpw}
                onChangeText={setNewpw}
                placeholder={copy.passwordPlaceholder}
                placeholderTextColor={colors.muted}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8} accessibilityLabel={showPw ? copy.hidePassword : copy.showPassword}>
                <Text style={styles.pwToggle}>{showPw ? 'إخفاء' : 'إظهار'}</Text>
              </Pressable>
            </View>
          </View>
          <ErrorText text={err} />
          <PrimaryButton label={busy ? copy.busy : copy.setpwSave} disabled={busy || !validate.vendorPassword(newpw)} onPress={vendorResetSave} />
        </>
      )}

      <Pressable onPress={() => router.replace('/register')} hitSlop={8}>
        <Text style={styles.registerLink}>{copy.createAccountLink}</Text>
      </Pressable>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function PasswordField({
  value,
  onChangeText,
  show,
  onToggle,
}: {
  value: string;
  onChangeText: (t: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{copy.password}</Text>
      <View style={styles.pwWrap}>
        <TextInput
          style={styles.pwInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={copy.passwordPlaceholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={onToggle} hitSlop={8} accessibilityLabel={show ? copy.hidePassword : copy.showPassword}>
          <Text style={styles.pwToggle}>{show ? 'إخفاء' : 'إظهار'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PrimaryButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.btn, disabled && styles.btnDisabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

function ErrorText({ text }: { text: string }) {
  if (!text) return null;
  return <Text style={styles.err}>{text}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 14, backgroundColor: colors.cream },
  brand: { fontSize: 40, fontFamily: fonts.extraBold, color: colors.greenDeep, textAlign: 'center' },
  title: { fontSize: 22, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center', marginBottom: 4 },
  sub: { fontSize: 14, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colors.greenDeep, borderColor: colors.greenDeep },
  tabText: { fontSize: 15, fontFamily: fonts.bold, color: colors.inkSoft },
  tabTextActive: { color: '#fff' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.inkSoft },
  input: {
    height: 50,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
    backgroundColor: colors.surface,
    // Email/phone values are always Latin — force LTR so bidi reordering doesn't
    // scramble them when the device keyboard is in Arabic mode.
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 20 },
  pwWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  // Password is Latin too → LTR + left align, so it never runs under the toggle.
  pwInput: {
    flex: 1,
    height: 50,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  pwToggle: { fontSize: 14, fontFamily: fonts.bold, color: colors.greenDeep, paddingVertical: 6 },
  btn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 17, fontFamily: fonts.bold, color: '#fff' },
  link: { fontSize: 14, fontFamily: fonts.medium, color: colors.greenDeep, textAlign: 'center', marginTop: 4 },
  registerLink: { fontSize: 15, fontFamily: fonts.bold, color: colors.greenDeep, textAlign: 'center', marginTop: 16 },
  err: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger, textAlign: 'center' },
  sent: { fontSize: 16, fontFamily: fonts.bold, color: colors.greenDeep, textAlign: 'center' },
});
