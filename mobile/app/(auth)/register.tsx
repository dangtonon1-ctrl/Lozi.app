import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
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
  const { customerSignUp } = useAuth();
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<PickRole | null>(null);
  const [kind, setKind] = useState<'almond' | 'raisin' | ''>('');
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

  // Matches the web: select highlights (farmer needs a crop), then متابعة proceeds.
  const roleReady = role !== null && (role !== 'farmer' || kind !== '');

  const selectRole = (r: PickRole) => {
    setErr('');
    setNotice('');
    setRole(r);
    if (r !== 'farmer') setKind('');
  };

  const onContinue = () => {
    setErr('');
    setNotice('');
    if (role === 'customer') setStep('customer');
    else setNotice(copy.vendorRegSoon); // vendor OTP flow ships in 3b
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
      {step === 'role' && (
        <>
          <LoziBadge />
          <Text style={styles.title}>{copy.welcome}</Text>
          <Text style={styles.sub}>{copy.chooseRole}</Text>
          <Text style={styles.subMuted}>{copy.chooseRoleSub}</Text>

          <View style={styles.yemen}>
            <Text style={styles.yemenText}>🇾🇪 {copy.yemenOnly}</Text>
          </View>

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

          {!!notice && <Text style={styles.notice}>{notice}</Text>}

          <PrimaryButton label={copy.cont} disabled={!roleReady} onPress={onContinue} />

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

function LoziBadge() {
  return (
    <View style={styles.badge}>
      <Image source={require('../../assets/adaptive-icon.png')} style={styles.badgeImg} resizeMode="contain" />
    </View>
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
  yemen: {
    alignSelf: 'center',
    backgroundColor: colors.sand,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginVertical: 4,
  },
  yemenText: { fontSize: 13, fontFamily: fonts.medium, color: colors.inkSoft },
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
