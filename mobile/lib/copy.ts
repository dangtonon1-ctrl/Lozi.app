import { normalizeDigits } from './normalizeDigits';

// Arabic auth copy — lifted VERBATIM from the frozen web app (src/scripts:
// app.data.js LOZI_T.ar + the hardcoded strings in app.catalog.js) so the two
// clients speak identically. Do not paraphrase; if the web app changes a
// string, mirror it here.

export const copy = {
  // ── Login ────────────────────────────────────────────────────────────────
  loginTitle: 'تسجيل الدخول',
  tabCustomer: 'زبون',
  tabVendor: 'متجر / مزارع',
  loginSub: 'سجّل دخولك لتبدأ التسوّق',
  signIn: 'دخول',
  busy: 'جارٍ...',
  forgotLink: 'نسيت كلمة المرور؟',
  customerForgotPrompt: 'أدخل بريدك وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.',
  vendorForgotPrompt: 'أدخل رقمك لإرسال رمز التحقق',
  forgotSent: 'تم الإرسال ✓',

  // ── Fields ───────────────────────────────────────────────────────────────
  email: 'البريد الإلكتروني',
  emailPlaceholder: 'name@example.com',
  password: 'كلمة المرور',
  passwordConfirm: 'تأكيد كلمة المرور',
  passwordPlaceholder: '••••••••',
  passwordNew: 'كلمة المرور الجديدة',
  showPassword: 'إظهار كلمة المرور',
  hidePassword: 'إخفاء كلمة المرور',
  fullName: 'الاسم الكامل',
  fullNamePlaceholder: 'مثال: محمد أحمد',
  phone: 'رقم الهاتف',
  phonePlaceholder: '7X XXX XXXX',

  // ── Register ─────────────────────────────────────────────────────────────
  welcome: 'أهلاً بك في لوزي',
  registerTitle: 'إنشاء حساب',
  chooseRole: 'اختر نوع حسابك',
  chooseRoleSub: 'لكل فئة تجربة وصلاحيات مختلفة',
  roleCustomer: 'زبون',
  roleCustomerDesc: 'تصفّح واطلب المكسرات',
  roleFarmer: 'مزارع',
  roleFarmerDesc: 'انشر محصولك من اللوز أو الزبيب',
  roleRetail: 'محل تجزئة',
  roleRetailDesc: 'بيع للزبائن وشراء من الجملة',
  roleWholesale: 'محل جملة',
  roleWholesaleDesc: 'بيع بالجملة لمحلات التجزئة',
  farmerKind: 'نوع المحصول',
  farmerAlmond: 'لوز',
  farmerRaisin: 'زبيب',
  yemenOnly: 'التسجيل متاح حالياً في اليمن فقط',
  cont: 'متابعة',
  haveAccount: 'لديك حساب؟ تسجيل الدخول',
  createAccount: 'إنشاء حساب',
  creating: 'جارٍ الإنشاء...',
  agreePre: 'بالمتابعة فأنت توافق على',
  termsLink: 'الشروط والأحكام',
  createAccountLink: 'ليس لديك حساب؟ إنشاء حساب',
  errPwMismatch: 'كلمتا المرور غير متطابقتين.',

  // ── Vendor register (name + phone → OTP) ──────────────────────────────────
  vendorWelcomeTitle: 'مرحباً بك في لوزي',
  vendorWelcomeSub: 'قم بإنشاء حسابك، لتجعل سوق المكسرات بين يديك',
  vendorNameHint: 'قم بإدخال الاسم كما في الهوية',
  nameFirst: 'الاسم الأول',
  nameSecond: 'الاسم الثاني',
  nameThird: 'الاسم الثالث',
  nameFourth: 'الاسم الرابع',
  agreeCheckbox: 'أوافق على',
  sending: 'جارٍ الإرسال...',
  errSendCodeFailed: 'تعذّر إرسال الرمز',
  // Blocked states from request-otp (verbatim).
  blockedNotAuthorized: 'رقمك غير مفعّل للتسجيل كمورد. تواصل مع الدعم لتفعيل حسابك.',
  blockedRateLimited: 'تم إرسال رمز خلال آخر ٢٤ ساعة. حاول لاحقاً أو تواصل مع الدعم.',
  supportWhatsapp: 'تواصل مع الدعم عبر واتساب',
  back: 'رجوع',

  // ── Vendor OTP ───────────────────────────────────────────────────────────
  otpTitle: 'أدخل رمز التحقق',
  otpSentPrefix: 'أرسلنا رمزاً عبر SMS إلى ‎+967 ',
  otpCodeLabel: 'رمز التحقق',
  otpCodePlaceholder: '٦ أرقام',
  otpVerify: 'تأكيد',
  otpVerifying: 'جارٍ التحقق...',
  otpResend: 'إعادة إرسال الرمز',
  setupPasswordTitle: 'إعداد كلمة المرور',
  setupPasswordSub: 'ستدخل لاحقاً برقم هاتفك وكلمة المرور هذه.',
  setpwSave: 'حفظ ودخول',

  // ── Password recovery ────────────────────────────────────────────────────
  resetTitle: 'إعادة تعيين كلمة المرور',
  resetSub: 'اختر كلمة مرور جديدة لحسابك.',

  // ── Sign out ─────────────────────────────────────────────────────────────
  signOut: 'تسجيل الخروج',

  // ── Errors / validation (verbatim) ───────────────────────────────────────
  errServiceDown: 'الخدمة غير متاحة',
  errCustomerCreds: 'البريد أو كلمة المرور غير صحيحة',
  errVendorCreds: 'الرقم أو كلمة المرور غير صحيحة',
  errCustomerPwLen: 'كلمة المرور ٦ أحرف على الأقل',
  errVendorPwLen: 'كلمة المرور ٤ أحرف على الأقل',
  errBadCode: 'الرمز غير صحيح',
  errBadOrExpiredCode: 'الرمز غير صحيح أو منتهي',
  errEnterEmail: 'أدخل بريدك الإلكتروني',
  errSendFailed: 'تعذّر الإرسال',
  errSavePwFailed: 'تعذّر حفظ كلمة المرور',
  errSignInFailed: 'تعذّر الدخول',
  errNeedLogin: 'سجّل الدخول أولاً',
  errAccountSuspended: 'هذا الحساب معلّق أو محظور. تواصل مع الدعم.',
  errAccountBanned: 'تم حظر هذا الحساب. للاستفسار تواصل مع الدعم.',
  errNotAuthorized: 'هذا الرقم غير مصرّح له بالتسجيل كتاجر. تواصل مع الدعم.',
  errEmailAlreadyRegistered:
    'هذا البريد الإلكتروني مسجّل بالفعل. إن لم تؤكّد حسابك بعد فابحث عن رسالة التأكيد في بريدك، وإلا فسجّل الدخول مباشرة.',
  needsConfirm: 'تحقّق من بريدك لتأكيد حسابك، ثم سجّل الدخول.',
  errRateLimited: 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة.',
  // Generic fallback — shown for any auth error we haven't explicitly mapped, so
  // a raw Supabase message never reaches the user.
  errGeneric: 'حدث خطأ، حاول مرة أخرى.',
} as const;

// Validation rules mirrored from the web app.
export const validate = {
  email: (v: string) => /\S+@\S+\.\S+/.test(v.trim()),
  // digits only, at least 7 (web: phone.replace(/[^0-9]/g,'').length >= 7).
  // normalizeDigits first so Arabic-Indic input validates correctly.
  phone: (v: string) => normalizeDigits(v).replace(/[^0-9]/g, '').length >= 7,
  customerPassword: (v: string) => v.length >= 6,
  vendorPassword: (v: string) => v.length >= 4,
};
