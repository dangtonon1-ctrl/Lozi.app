import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
  type KeyboardTypeOptions,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../../lib/auth';
import { copy, validate } from '../../lib/copy';
import { normalizeDigits } from '../../lib/normalizeDigits';
import { colors, fonts } from '../../lib/theme';

type Step = 'role' | 'customer' | 'vphone' | 'otp' | 'setpw';
type PickRole = 'customer' | 'farmer' | 'retail' | 'wholesale';
type Blocked = '' | 'not_authorized' | 'rate_limited';

// LOZI support line (matches the web's support_wa default, 777184208).
const SUPPORT_WA = '967777184208';

// Colors are the darker stop of each web gradient (solid fill — gradient is a
// logged parity gap). Icons are rasterized from the web SVGs (TEMPORARY — the
// native batch replaces them with react-native-svg; see 10-web-parity-gaps.md).
type RoleDef = { key: PickRole; label: string; desc: string; color: string; icon: ImageSourcePropType };
const ROLES: RoleDef[] = [
  { key: 'customer', label: copy.roleCustomer, desc: copy.roleCustomerDesc, color: '#4c6450', icon: require('../../assets/role-customer.png') },
  { key: 'farmer', label: copy.roleFarmer, desc: copy.roleFarmerDesc, color: '#a9743a', icon: require('../../assets/role-farmer.png') },
  { key: 'retail', label: copy.roleRetail, desc: copy.roleRetailDesc, color: '#6b3f5a', icon: require('../../assets/role-retail.png') },
  { key: 'wholesale', label: copy.roleWholesale, desc: copy.roleWholesaleDesc, color: '#8e6b1e', icon: require('../../assets/role-warehouse.png') },
];

export default function Register() {
  const { customerSignUp, vendorSendOtp, vendorVerifyOtp, vendorSetPassword, vendorSignIn } = useAuth();
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<PickRole | null>(null);
  const [kind, setKind] = useState<'almond' | 'raisin' | ''>('');

  // customer form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // vendor ID name (4 parts, as in the web "name-grid")
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [n3, setN3] = useState('');
  const [n4, setN4] = useState('');
  const [agree, setAgree] = useState(false);

  // shared
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState<Blocked>('');

  const emailOk = validate.email(email);
  const phoneOk = validate.phone(phone);
  const pwOk = validate.customerPassword(password);
  const vendorPwOk = validate.vendorPassword(password);
  const pwMismatch = password2.length > 0 && password !== password2;
  const canSubmitCustomer = name.trim().length > 0 && emailOk && phoneOk && pwOk && password === password2;

  const namesReady =
    n1.trim().length >= 2 && n2.trim().length >= 2 && n3.trim().length >= 2 && n4.trim().length >= 2;
  const vendorName = [n1, n2, n3, n4].map((s) => s.trim()).filter(Boolean).join(' ');
  const canSendOtp = namesReady && phoneOk && agree;

  // Matches the web: select highlights (farmer needs a crop), then متابعة proceeds.
  const roleReady = role !== null && (role !== 'farmer' || kind !== '');

  const resetMsgs = () => {
    setErr('');
    setNotice('');
  };

  const selectRole = (r: PickRole) => {
    resetMsgs();
    setRole(r);
    if (r !== 'farmer') setKind('');
  };

  const onContinue = () => {
    resetMsgs();
    if (role === 'customer') setStep('customer');
    else setStep('vphone'); // farmer / retail / wholesale → vendor OTP flow
  };

  const submitCustomer = async () => {
    resetMsgs();
    setBusy(true);
    const r = await customerSignUp({ name: name.trim(), email: email.trim(), password, phone });
    setBusy(false);
    if (r.ok && r.needsConfirm) {
      setNotice(copy.needsConfirm);
      return;
    }
    if (!r.ok) {
      setErr(r.error || copy.errGeneric);
      return;
    }
    // ok + session → AuthProvider flips to authed → (auth)/_layout redirects to /home.
  };

  // ── Vendor OTP flow (mirrors the web vendorSend / vendorVerify / vendorSetPw) ──
  const vendorSend = async () => {
    if (!canSendOtp) return;
    setErr('');
    setBlocked('');
    setBusy(true);
    const r = await vendorSendOtp({ phone });
    setBusy(false);
    if (r.ok) {
      setStep('otp');
      return;
    }
    if (r.reason === 'not_authorized') return setBlocked('not_authorized');
    if (r.reason === 'rate_limited') return setBlocked('rate_limited');
    setErr(r.error || copy.errSendCodeFailed);
  };

  const vendorVerify = async () => {
    setErr('');
    setBusy(true);
    const r = await vendorVerifyOtp({
      phone,
      code: code.trim(),
      default_crop: role === 'farmer' ? kind : undefined,
    });
    setBusy(false);
    if (r.ok && r.setup_token) {
      setSetupToken(r.setup_token);
      setStep('setpw');
      return;
    }
    setErr(r.error || copy.errBadOrExpiredCode);
  };

  const vendorSetPw = async () => {
    if (!vendorPwOk) {
      setErr(copy.errVendorPwLen);
      return;
    }
    if (password !== password2) {
      setErr(copy.errPwMismatch);
      return;
    }
    setErr('');
    setBusy(true);
    const r = await vendorSetPassword({ phone, setup_token: setupToken, password });
    if (!r.ok) {
      setBusy(false);
      setErr(r.error || copy.errSavePwFailed);
      return;
    }
    const s = await vendorSignIn({ phone, password, name: vendorName });
    setBusy(false);
    if (!s.ok) setErr(s.error || copy.errSignInFailed);
    // ok → AuthProvider flips to authed → (auth)/_layout redirects to /home.
  };

  const openSupport = () => {
    Linking.openURL(`https://wa.me/${SUPPORT_WA}`).catch(() => {
      /* no WhatsApp installed — nothing to fall back to */
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {/* ── Step: role picker ─────────────────────────────────────────────── */}
      {step === 'role' && (
        <>
          <LoziBadge />
          <Text style={styles.title}>{copy.welcome}</Text>
          <Text style={styles.sub}>{copy.chooseRole}</Text>
          <Text style={styles.subMuted}>{copy.chooseRoleSub}</Text>

          <View style={styles.roleGrid}>
            {ROLES.map((r) => (
              <RoleCard key={r.key} role={r} selected={role === r.key} onPress={() => selectRole(r.key)} />
            ))}
          </View>

          {role === 'farmer' && (
            <View style={styles.cropWrap}>
              <Text style={styles.fieldLabel}>{copy.farmerKind}</Text>
              <View style={styles.seg}>
                <SegButton label={copy.farmerAlmond} active={kind === 'almond'} onPress={() => setKind('almond')} />
                <SegButton label={copy.farmerRaisin} active={kind === 'raisin'} onPress={() => setKind('raisin')} />
              </View>
            </View>
          )}

          <PrimaryButton label={copy.cont} disabled={!roleReady} onPress={onContinue} />

          <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
            <Text style={styles.link}>{copy.haveAccount}</Text>
          </Pressable>
        </>
      )}

      {/* ── Step: customer form ───────────────────────────────────────────── */}
      {step === 'customer' && (
        <>
          <BackLink onPress={() => { setStep('role'); resetMsgs(); }} />
          <Text style={styles.title}>{copy.roleCustomer}</Text>

          <Field label={copy.fullName} value={name} onChangeText={setName} placeholder={copy.fullNamePlaceholder} />
          <Field label={copy.email} value={email} onChangeText={setEmail} placeholder={copy.emailPlaceholder} keyboardType="email-address" ltr />
          <PasswordField label={copy.password} value={password} onChangeText={setPassword} show={showPw} onToggle={() => setShowPw((v) => !v)} />
          <PasswordField label={copy.passwordConfirm} value={password2} onChangeText={setPassword2} show={showPw} onToggle={() => setShowPw((v) => !v)} />
          {pwMismatch && <Text style={styles.err}>{copy.errPwMismatch}</Text>}
          <Field label={copy.phone} value={phone} onChangeText={(t) => setPhone(normalizeDigits(t))} placeholder={copy.phonePlaceholder} keyboardType="number-pad" ltr />

          <Text style={styles.terms}>
            {copy.agreePre} {copy.termsLink}
          </Text>

          {!!err && <Text style={styles.err}>{err}</Text>}
          {!!notice && <Text style={styles.notice}>{notice}</Text>}

          <PrimaryButton label={busy ? copy.creating : copy.createAccount} disabled={busy || !canSubmitCustomer} onPress={submitCustomer} />
        </>
      )}

      {/* ── Step: vendor name + phone → send OTP ──────────────────────────── */}
      {step === 'vphone' && (
        <>
          <BackLink onPress={() => { setStep('role'); resetMsgs(); setBlocked(''); }} />
          <LoziBadge />
          <Text style={styles.title}>{copy.vendorWelcomeTitle}</Text>
          <Text style={styles.subMuted}>{copy.vendorWelcomeSub}</Text>

          {blocked ? (
            <View style={styles.blockWrap}>
              <Text style={styles.blockText}>
                {blocked === 'not_authorized' ? copy.blockedNotAuthorized : copy.blockedRateLimited}
              </Text>
              <Pressable style={styles.waBtn} onPress={openSupport}>
                <Text style={styles.waBtnText}>{copy.supportWhatsapp}</Text>
              </Pressable>
              <Pressable onPress={() => setBlocked('')} hitSlop={8}>
                <Text style={styles.link}>{copy.back}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>{copy.vendorNameHint}</Text>
              <View style={styles.nameGrid}>
                <NameInput value={n1} onChangeText={setN1} placeholder={copy.nameFirst} />
                <NameInput value={n2} onChangeText={setN2} placeholder={copy.nameSecond} />
                <NameInput value={n3} onChangeText={setN3} placeholder={copy.nameThird} />
                <NameInput value={n4} onChangeText={setN4} placeholder={copy.nameFourth} />
              </View>

              <PhoneField value={phone} onChangeText={(t) => setPhone(normalizeDigits(t))} />

              <Pressable style={styles.agreeRow} onPress={() => setAgree((v) => !v)} hitSlop={6}>
                <View style={[styles.checkbox, agree && styles.checkboxOn]}>
                  {agree && <Text style={styles.checkboxTick}>✓</Text>}
                </View>
                <Text style={styles.agreeText}>
                  {copy.agreeCheckbox} <Text style={styles.agreeLink}>{copy.termsLink}</Text>
                </Text>
              </Pressable>

              {!!err && <Text style={styles.err}>{err}</Text>}

              <PrimaryButton label={busy ? copy.sending : copy.cont} disabled={busy || !canSendOtp} onPress={vendorSend} />
            </>
          )}
        </>
      )}

      {/* ── Step: OTP code ────────────────────────────────────────────────── */}
      {step === 'otp' && (
        <>
          <BackLink onPress={() => { setStep('vphone'); resetMsgs(); }} />
          <LoziBadge />
          <Text style={styles.title}>{copy.otpTitle}</Text>
          <Text style={styles.subMuted}>
            {copy.otpSentPrefix}
            {normalizeDigits(phone).replace(/[^0-9]/g, '')}
          </Text>

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

          {!!err && <Text style={styles.err}>{err}</Text>}

          <PrimaryButton label={busy ? copy.otpVerifying : copy.otpVerify} disabled={busy || code.trim().length < 4} onPress={vendorVerify} />
          <Pressable onPress={vendorSend} disabled={busy} hitSlop={8}>
            <Text style={styles.link}>{copy.otpResend}</Text>
          </Pressable>
        </>
      )}

      {/* ── Step: set password + auto sign-in ─────────────────────────────── */}
      {step === 'setpw' && (
        <>
          <LoziBadge />
          <Text style={styles.title}>{copy.setupPasswordTitle}</Text>
          <Text style={styles.subMuted}>{copy.setupPasswordSub}</Text>

          <PasswordField label={copy.password} value={password} onChangeText={setPassword} show={showPw} onToggle={() => setShowPw((v) => !v)} />
          <PasswordField label={copy.passwordConfirm} value={password2} onChangeText={setPassword2} show={showPw} onToggle={() => setShowPw((v) => !v)} />
          {pwMismatch && <Text style={styles.err}>{copy.errPwMismatch}</Text>}

          {!!err && <Text style={styles.err}>{err}</Text>}

          <PrimaryButton
            label={busy ? copy.busy : copy.setpwSave}
            disabled={busy || !vendorPwOk || password !== password2}
            onPress={vendorSetPw}
          />
        </>
      )}
    </ScrollView>
  );
}

function LoziBadge() {
  return (
    <View style={styles.badge}>
      <Image source={require('../../assets/adaptive-icon.png')} style={styles.badgeImg} resizeMode="contain" />
    </View>
  );
}

function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={styles.back}>‹ {copy.chooseRole}</Text>
    </Pressable>
  );
}

function RoleCard({ role, selected, onPress }: { role: RoleDef; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.roleCard, selected && styles.roleCardOn]} onPress={onPress}>
      <View style={[styles.roleIc, { backgroundColor: role.color }]}>
        <Image source={role.icon} style={styles.roleIcImg} resizeMode="contain" />
      </View>
      <Text style={styles.roleLabel}>{role.label}</Text>
      <Text style={styles.roleDesc}>{role.desc}</Text>
      {selected && (
        <View style={styles.roleCheck}>
          <Text style={styles.roleCheckTxt}>✓</Text>
        </View>
      )}
    </Pressable>
  );
}

function SegButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segBtn, active && styles.segBtnOn]} onPress={onPress}>
      <Text style={[styles.segTxt, active && styles.segTxtOn]}>{label}</Text>
    </Pressable>
  );
}

function NameInput({ value, onChangeText, placeholder }: { value: string; onChangeText: (t: string) => void; placeholder: string }) {
  return (
    <TextInput
      style={styles.nameInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      autoCorrect={false}
    />
  );
}

function PhoneField({ value, onChangeText }: { value: string; onChangeText: (t: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{copy.phone}</Text>
      <View style={styles.phoneWrap}>
        <View style={styles.phoneCc}>
          <Text style={styles.phoneCcText}>+967</Text>
        </View>
        <TextInput
          style={[styles.input, styles.ltr, styles.phoneInput]}
          value={value}
          onChangeText={onChangeText}
          placeholder={copy.phonePlaceholder}
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  ltr,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  ltr?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, ltr && styles.ltr]}
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
  label,
  value,
  onChangeText,
  show,
  onToggle,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.pwWrap}>
        <TextInput
          style={[styles.pwInput, styles.ltr]}
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

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 12, paddingTop: 56, paddingBottom: 48 },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  badgeImg: { width: 60, height: 60 },
  title: { fontSize: 22, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center', marginTop: 4 },
  sub: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center', marginTop: 2 },
  subMuted: { fontSize: 14, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'center' },
  hint: { fontSize: 13, fontFamily: fonts.medium, color: colors.inkSoft, textAlign: 'center', marginTop: 4 },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  roleCard: {
    width: '48%',
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 14,
    gap: 6,
    backgroundColor: colors.surface,
  },
  roleCardOn: { borderColor: colors.greenDeep, borderWidth: 2, backgroundColor: colors.greenSoft },
  roleIc: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  roleIcImg: { width: 28, height: 28 },
  roleLabel: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
  roleDesc: { fontSize: 12, fontFamily: fonts.regular, color: colors.inkSoft },
  roleCheck: {
    position: 'absolute',
    top: 10,
    insetInlineEnd: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCheckTxt: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },
  cropWrap: { gap: 8, marginTop: 4 },
  seg: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  segBtnOn: { backgroundColor: colors.greenDeep, borderColor: colors.greenDeep },
  segTxt: { fontSize: 15, fontFamily: fonts.bold, color: colors.inkSoft },
  segTxtOn: { color: '#fff' },
  back: { fontSize: 15, fontFamily: fonts.medium, color: colors.greenDeep },
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
  },
  ltr: { textAlign: 'left', writingDirection: 'ltr' },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 20 },
  nameGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  nameInput: {
    width: '48%',
    height: 50,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  phoneWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phoneCc: {
    height: 50,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.sand,
  },
  phoneCcText: { fontSize: 15, fontFamily: fonts.bold, color: colors.inkSoft },
  phoneInput: { flex: 1 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.greenDeep, borderColor: colors.greenDeep },
  checkboxTick: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },
  agreeText: { fontSize: 13, fontFamily: fonts.regular, color: colors.inkSoft, flexShrink: 1 },
  agreeLink: { fontFamily: fonts.bold, color: colors.greenDeep },
  blockWrap: { gap: 14, marginTop: 8, alignItems: 'stretch' },
  blockText: { fontSize: 14, fontFamily: fonts.bold, color: colors.danger, textAlign: 'center' },
  waBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waBtnText: { fontSize: 16, fontFamily: fonts.bold, color: '#fff' },
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
  pwInput: { flex: 1, height: 50, fontSize: 16, fontFamily: fonts.regular, color: colors.ink },
  pwToggle: { fontSize: 14, fontFamily: fonts.bold, color: colors.greenDeep, paddingVertical: 6 },
  terms: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textAlign: 'center' },
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
  link: { fontSize: 14, fontFamily: fonts.medium, color: colors.greenDeep, textAlign: 'center', marginTop: 8 },
  err: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger, textAlign: 'center' },
  notice: { fontSize: 14, fontFamily: fonts.medium, color: colors.goldDeep, textAlign: 'center' },
});
