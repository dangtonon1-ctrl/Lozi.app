import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
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

type Step = 'role' | 'customer';
type PickRole = 'customer' | 'farmer' | 'retail' | 'wholesale';

const ROLES: { key: PickRole; label: string; desc: string }[] = [
  { key: 'customer', label: copy.roleCustomer, desc: copy.roleCustomerDesc },
  { key: 'farmer', label: copy.roleFarmer, desc: copy.roleFarmerDesc },
  { key: 'retail', label: copy.roleRetail, desc: copy.roleRetailDesc },
  { key: 'wholesale', label: copy.roleWholesale, desc: copy.roleWholesaleDesc },
];

export default function Register() {
  const { customerSignUp } = useAuth();
  const [step, setStep] = useState<Step>('role');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [phone, setPhone] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  const emailOk = validate.email(email);
  const phoneOk = validate.phone(phone);
  const pwOk = validate.customerPassword(password);
  const pwMismatch = password2.length > 0 && password !== password2;
  const canSubmit = name.trim().length > 0 && emailOk && phoneOk && pwOk && password === password2;

  const pickRole = (r: PickRole) => {
    setErr('');
    setNotice('');
    // Vendor onboarding (farmer/retail/wholesale) is the OTP flow — ships next.
    if (r === 'customer') setStep('customer');
    else setNotice(copy.vendorRegSoon);
  };

  const submit = async () => {
    setErr('');
    setNotice('');
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

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>لوزي</Text>

      {step === 'role' && (
        <>
          <Text style={styles.title}>{copy.welcome}</Text>
          <Text style={styles.sub}>{copy.chooseRole}</Text>
          <Text style={styles.subMuted}>{copy.chooseRoleSub}</Text>

          <View style={styles.yemen}>
            <Text style={styles.yemenText}>🇾🇪 {copy.yemenOnly}</Text>
          </View>

          {ROLES.map((r) => (
            <Pressable key={r.key} style={styles.roleCard} onPress={() => pickRole(r.key)}>
              <Text style={styles.roleLabel}>{r.label}</Text>
              <Text style={styles.roleDesc}>{r.desc}</Text>
            </Pressable>
          ))}

          {!!notice && <Text style={styles.notice}>{notice}</Text>}

          <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
            <Text style={styles.link}>{copy.haveAccount}</Text>
          </Pressable>
        </>
      )}

      {step === 'customer' && (
        <>
          <Pressable onPress={() => { setStep('role'); setErr(''); setNotice(''); }} hitSlop={8}>
            <Text style={styles.back}>‹ {copy.chooseRole}</Text>
          </Pressable>
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

          <PrimaryButton label={busy ? copy.creating : copy.createAccount} disabled={busy || !canSubmit} onPress={submit} />
        </>
      )}
    </ScrollView>
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
  screen: { padding: 24, gap: 12, paddingTop: 64, paddingBottom: 48 },
  brand: { fontSize: 38, fontFamily: fonts.extraBold, color: colors.greenDeep, textAlign: 'center' },
  title: { fontSize: 22, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center', marginTop: 4 },
  subMuted: { fontSize: 14, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'center' },
  yemen: {
    alignSelf: 'center',
    backgroundColor: colors.sand,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginVertical: 4,
  },
  yemenText: { fontSize: 13, fontFamily: fonts.medium, color: colors.inkSoft },
  roleCard: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    gap: 4,
    backgroundColor: colors.surface,
  },
  roleLabel: { fontSize: 17, fontFamily: fonts.bold, color: colors.greenDeep },
  roleDesc: { fontSize: 13, fontFamily: fonts.regular, color: colors.inkSoft },
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
