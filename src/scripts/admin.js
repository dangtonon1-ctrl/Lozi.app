
const { useState, useEffect } = React;

// ---- Precise date & time helpers (shown across the whole dashboard) ----
const fmtDT = (s) => {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch (e) { return '—'; }
};
const nowStamp = () => fmtDT(new Date().toISOString());
function Stamp({ at, label }) {
  return <div className="kv ts"><b>{label || 'التاريخ والوقت'}:</b> 🕒 {fmtDT(at)}</div>;
}

// ---- Commission helpers (cumulative-sales tier system) ----
const TIERS_CACHE = { data: null, p: null };
async function getTiers() {
  if (TIERS_CACHE.data) return TIERS_CACHE.data;
  if (!TIERS_CACHE.p) {
    TIERS_CACHE.p = SB.from('commission_tiers').select('*').then(({ data }) => {
      TIERS_CACHE.data = data || []; return TIERS_CACHE.data;
    });
  }
  return TIERS_CACHE.p;
}
// Level/rate row matching a cumulative value within a segment (single source of truth).
const tierOf = (tiers, segment, cum) => {
  const rows = (tiers || []).filter((t) => t.segment === segment).sort((a, b) => a.level - b.level);
  const c = Number(cum) || 0;
  for (const r of rows) {
    if (c >= Number(r.min_sales) && (r.max_sales == null || c <= Number(r.max_sales))) return r;
  }
  return rows[rows.length - 1] || null;
};
const AR = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const pct = (rate, seg) => (Number(rate) * 100).toFixed(seg === 'wholesale' ? 1 : 2) + '%';
const money2 = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: (Number(n) % 1 !== 0 ? 2 : 0), maximumFractionDigits: 2 });
const SEG_AR = { retail: 'تجزئة', wholesale: 'جملة' };
// Mixed-bundle component weight units
const UNIT_AR = { gram: 'جرام', kilo: 'كيلو' };
const fmtItemWeight = (it) => {
  const w = (it && it.weight != null ? String(it.weight) : '').trim();
  if (!w) return '';
  const u = it && it.unit ? (UNIT_AR[it.unit] || '') : '';
  return u ? w + ' ' + u : w;
};

function Login({ onIn }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    if (!email.trim() || !pass) return;
    setBusy(true); setErr('');
    const { data, error } = await SB.auth.signInWithPassword({ email: email.trim(), password: pass });
    if (error) { setBusy(false); return setErr('بيانات الدخول غير صحيحة'); }
    const { data: a } = await SB.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
    setBusy(false);
    if (!a) { await SB.auth.signOut(); return setErr('هذا الحساب غير مصرّح له بالدخول للوحة الإدارة.'); }
    onIn(data.user);
  };
  return (
    <div className="login">
      <div className="logo">لوزي</div>
      <h2>لوحة الإدارة</h2>
      <p>أدخل اسم الأدمن (البريد) والرمز السري.</p>
      <label className="fld"><span>اسم الأدمن (البريد)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@lozi.ye" inputMode="email" autoCapitalize="off" /></label>
      <label className="fld"><span>الرمز السري</span>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && go()} /></label>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy || !email.trim() || !pass} onClick={go} style={{ marginTop: 8 }}>{busy ? 'جارٍ الدخول…' : 'دخول'}</button>
    </div>
  );
}

// ---- Verifications ----
function Verifications() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [msg, setMsg] = useState('');
  const load = async () => {
    setRows(null);
    let q = SB.from('vendor_verifications').select('*').order('submitted_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    setRows(error ? [] : (data || []));
  };
  useEffect(() => { load(); }, [filter]);
  const openDoc = async (path) => {
    if (!path) return;
    const { data, error } = await SB.storage.from('vendor-docs').createSignedUrl(path, 3600);
    if (error) return alert('تعذّر فتح المستند: ' + error.message);
    window.open(data.signedUrl, '_blank');
  };
  const setStatus = async (r, status) => {
    let note = null;
    if (status === 'rejected') { note = prompt('سبب الرفض (اختياري):') || null; }
    const { error } = await SB.from('vendor_verifications').update({ status, note, reviewed_at: new Date().toISOString() }).eq('user_id', r.user_id);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg((status === 'approved' ? 'تم التفعيل ✓' : 'تم الرفض') + ' · 🕒 ' + nowStamp());
    setTimeout(() => setMsg(''), 3000);
    load();
  };
  const ROLE = { farmer_almond: 'مزارع لوز', farmer_raisin: 'مزارع زبيب', retail: 'تاجر تجزئة', wholesale: 'تاجر جملة', farmer: 'مزارع' };
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {['pending', 'approved', 'rejected', 'all'].map((f) =>
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{{ pending: 'منتظر', approved: 'مفعّل', rejected: 'مرفوض', all: 'الكل' }[f]}</button>)}
      </div>
      {msg && <div className="ok" style={{ marginBottom: 10 }}>{msg}</div>}
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد طلبات.</div>
          : rows.map((r) => {
            const d = r.docs || {};
            return (
              <div className="card" key={r.user_id}>
                <div className="v-head"><strong>{r.name || 'بدون اسم'}</strong><span className={`tag ${r.status}`}>{{ pending: 'منتظر', approved: 'مفعّل', rejected: 'مرفوض' }[r.status] || r.status}</span></div>
                <div className="kv"><b>الهاتف:</b> {r.phone || '—'}</div>
                <div className="kv"><b>العنوان:</b> {r.address || '—'}</div>
                <div className="kv"><b>المعرّف:</b> <span style={{ fontSize: 11 }}>{r.user_id}</span></div>
                <Stamp at={r.submitted_at} label="تاريخ التقديم" />
                {r.reviewed_at && <Stamp at={r.reviewed_at} label="تاريخ المراجعة" />}
                <div className="docs">
                  {d.id_front && <a onClick={() => openDoc(d.id_front)}>البطاقة (أمام)</a>}
                  {d.id_back && <a onClick={() => openDoc(d.id_back)}>البطاقة (خلف)</a>}
                  {d.commercial && <a onClick={() => openDoc(d.commercial)}>السجل التجاري</a>}
                  {d.shop && <a onClick={() => openDoc(d.shop)}>صورة المحل</a>}
                </div>
                {r.note && <div className="kv"><b>ملاحظة:</b> {r.note}</div>}
                {r.status !== 'approved' &&
                  <div className="acts">
                    <button className="btn sm" onClick={() => setStatus(r, 'approved')}>✓ تفعيل</button>
                    {r.status !== 'rejected' && <button className="btn sm danger" onClick={() => setStatus(r, 'rejected')}>رفض</button>}
                  </div>}
              </div>
            );
          })}
    </div>
  );
}

// ---- Reports (البلاغات) ----
function Reports() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('review');
  const [msg, setMsg] = useState('');
  const load = async () => {
    setRows(null);
    let q = SB.from('reports').select('*').order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    setRows(error ? [] : (data || []));
  };
  useEffect(() => { load(); }, [filter]);
  const reply = async (r) => {
    const txt = prompt('الرد على البلاغ:', r.reply || '');
    if (txt === null) return;
    const { error } = await SB.from('reports').update({ reply: txt, status: 'resolved' }).eq('id', r.id);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg('تم الرد والإغلاق ✓ · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 3000); load();
  };
  const TYPE = { farmer: 'مزارع', retail: 'تجزئة', wholesale: 'جملة', general: 'عام' };
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {['review', 'resolved', 'all'].map((f) =>
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{{ review: 'قيد المراجعة', resolved: 'مغلقة', all: 'الكل' }[f]}</button>)}
      </div>
      {msg && <div className="ok" style={{ marginBottom: 10 }}>{msg}</div>}
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد بلاغات.</div>
          : rows.map((r) => (
            <div className="card" key={r.id}>
              <div className="v-head"><strong>{r.subject || 'بلاغ'}</strong><span className={`tag ${r.status === 'resolved' ? 'approved' : 'pending'}`}>{r.status === 'resolved' ? 'مغلقة' : 'مراجعة'}</span></div>
              <div className="kv"><b>النوع:</b> {TYPE[r.type_id] || r.type_id || '—'}{r.target ? ' · ' + r.target : ''}{r.order_id ? ' · طلب #' + r.order_id : ''}</div>
              <div className="kv"><b>من:</b> {r.reporter_name || '—'} · {r.reporter_phone || '—'}</div>
              <Stamp at={r.created_at} label="تاريخ البلاغ" />
              {r.status === 'resolved' && r.updated_at && <Stamp at={r.updated_at} label="تاريخ الإغلاق" />}
              <div className="kv" style={{ marginTop: 6 }}>{r.description}</div>
              {r.reply && <div className="kv" style={{ marginTop: 6, color: 'var(--green-deep)' }}><b>الرد:</b> {r.reply}</div>}
              <div className="acts"><button className="btn sm" onClick={() => reply(r)}>{r.status === 'resolved' ? 'تعديل الرد' : 'رد وإغلاق'}</button></div>
            </div>
          ))}
    </div>
  );
}

// ---- Reviews moderation (التقييمات) ----
function ReviewsMod() {
  const [rows, setRows] = useState(null);
  const load = async () => { setRows(null); const { data, error } = await SB.from('reviews').select('*').order('created_at', { ascending: false }); setRows(error ? [] : (data || [])); };
  useEffect(() => { load(); }, []);
  const toggle = async (r) => { const { error } = await SB.from('reviews').update({ hidden: !r.hidden }).eq('id', r.id); if (!error) load(); };
  const del = async (r) => { if (!confirm('حذف هذا التقييم نهائياً؟')) return; const { error } = await SB.from('reviews').delete().eq('id', r.id); if (!error) load(); };
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  return (
    <div>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد تقييمات.</div>
          : rows.map((r) => (
            <div className="card" key={r.id}>
              <div className="v-head"><strong>{r.reviewer_name || 'عميل'}</strong><span style={{ color: 'var(--gold-deep)', fontWeight: 900 }}>{stars(r.rating)}</span>{r.hidden && <span className="tag rejected">مخفي</span>}</div>
              {r.comment && <div className="kv" style={{ marginTop: 4 }}>{r.comment}</div>}
              {r.reply && <div className="kv" style={{ color: 'var(--green-deep)' }}><b>ردّ المتجر:</b> {r.reply}</div>}
              <div className="kv"><b>متجر:</b> <span style={{ fontSize: 11 }}>{r.store_vendor_id}</span></div>
              <Stamp at={r.created_at} label="تاريخ التقييم" />
              <div className="acts">
                <button className="btn sm ghost" onClick={() => toggle(r)}>{r.hidden ? 'إظهار' : 'إخفاء'}</button>
                <button className="btn sm danger" onClick={() => del(r)}>حذف</button>
              </div>
            </div>
          ))}
    </div>
  );
}

// ---- Number activation ----
function Numbers() {
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('farmer');
  const [msg, setMsg] = useState('');
  const ROLES = [{ v: 'farmer', l: 'مزارع' }, { v: 'retail', l: 'تاجر تجزئة' }, { v: 'wholesale', l: 'تاجر جملة' }];
  const norm = (p) => { let d = String(p).replace(/[^0-9]/g, ''); if (d.indexOf('967') !== 0) d = '967' + d.replace(/^0+/, ''); return '+' + d; };
  const activate = async () => {
    if (!phone.trim()) return;
    const ph = norm(phone);
    const { error } = await SB.from('vendor_authorizations').upsert({ phone: ph, role, status: 'active' }, { onConflict: 'phone' });
    setMsg(error ? 'خطأ: ' + error.message : 'تم تفعيل الرقم ' + ph + ' كـ' + (ROLES.find((r) => r.v === role)?.l || role) + ' ✓ · 🕒 ' + nowStamp());
  };
  const resetOtp = async () => {
    if (!phone.trim()) return;
    const ph = norm(phone);
    const { error } = await SB.from('otp_attempts').delete().eq('phone', ph);
    setMsg(error ? 'خطأ (قد يكون اسم جدول OTP مختلفاً): ' + error.message : 'تم تصفير حدّ الرمز للرقم ' + ph + ' ✓ · 🕒 ' + nowStamp());
  };
  return (
    <div className="card">
      <div className="secttl">تفعيل رقم بائع</div>
      <label className="fld"><span>رقم الهاتف</span>
        <div style={{ display: 'flex', gap: 8 }}><span style={{ background: 'var(--sand)', borderRadius: 12, padding: '13px 12px', fontWeight: 800 }}>+967</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="7X XXX XXXX" inputMode="tel" /></div></label>
      <label className="fld"><span>نوع البائع</span>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select></label>
      <div className="row2">
        <button className="btn sm" onClick={activate}>تفعيل الرقم</button>
        <button className="btn sm ghost" onClick={resetOtp}>تصفير حدّ الرمز</button>
      </div>
      {msg && <div className={msg.indexOf('خطأ') === 0 ? 'err' : 'ok'}>{msg}</div>}
      <p className="muted" style={{ marginTop: 10 }}>التفعيل يسمح للرقم باستلام رمز التسجيل كبائع. التصفير يُستخدم عند ظهور «تم إرسال رمز خلال ٢٤ ساعة».</p>
    </div>
  );
}

// ---- Deletion requests ----
function Deletions() {
  const [rows, setRows] = useState(null);
  const load = async () => { setRows(null); const { data, error } = await SB.from('deletion_requests').select('*').order('created_at', { ascending: false }); setRows(error ? [] : (data || [])); };
  useEffect(() => { load(); }, []);
  const mark = async (r) => { const { error } = await SB.from('deletion_requests').update({ handled: true, status: 'handled' }).eq('user_id', r.user_id); if (!error) load(); };
  return (
    <div>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد طلبات حذف.</div>
          : rows.map((r) => (
            <div className="card" key={r.user_id}>
              <div className="v-head"><strong>{r.name || 'مستخدم'}</strong><span className="tag">{r.role || ''}</span>{r.handled && <span className="tag approved">منجز</span>}</div>
              <div className="kv"><b>الهاتف:</b> {r.phone || '—'} · <b>البريد:</b> {r.email || '—'}</div>
              <div className="kv"><b>المعرّف:</b> <span style={{ fontSize: 11 }}>{r.user_id}</span></div>
              <Stamp at={r.created_at} label="تاريخ الطلب" />
              {r.handled && r.handled_at && <Stamp at={r.handled_at} label="تاريخ التنفيذ" />}
              <p className="muted" style={{ margin: '8px 0' }}>الحذف النهائي من Authentication → Users في Supabase. هنا تضع علامة «منجز» بعد الحذف.</p>
              {!r.handled && <button className="btn sm ghost" onClick={() => mark(r)}>وضع علامة منجز</button>}
            </div>
          ))}
    </div>
  );
}

// ---- Settings & badges ----
function SettingsTab() {
  const [wa, setWa] = useState('');
  const [waMsg, setWaMsg] = useState('');
  const [waUpdated, setWaUpdated] = useState(null);
  const [bundleLimit, setBundleLimit] = useState('1');
  const [blMsg, setBlMsg] = useState('');
  const [blUpdated, setBlUpdated] = useState(null);
  const [rfqLaunch, setRfqLaunch] = useState('');
  const [rlMsg, setRlMsg] = useState('');
  const [rlUpdated, setRlUpdated] = useState(null);
  useEffect(() => {
    SB.from('settings').select('value,updated_at').eq('key', 'support_wa').maybeSingle().then(({ data }) => { if (data) { setWa(data.value || ''); setWaUpdated(data.updated_at || null); } });
    SB.from('settings').select('value,updated_at').eq('key', 'retail_bundle_limit').maybeSingle().then(({ data }) => { if (data && data.value != null && data.value !== '') { setBundleLimit(String(data.value)); setBlUpdated(data.updated_at || null); } });
    SB.from('settings').select('value,updated_at').eq('key', 'rfq_launch_date').maybeSingle().then(({ data }) => { if (data && data.value != null && data.value !== '') { setRfqLaunch(String(data.value).replace(/"/g, '').slice(0, 10)); setRlUpdated(data.updated_at || null); } });
  }, []);
  const saveWa = async () => {
    const now = new Date().toISOString();
    const { error } = await SB.from('settings').upsert({ key: 'support_wa', value: wa, updated_at: now }, { onConflict: 'key' });
    if (!error) setWaUpdated(now);
    setWaMsg(error ? 'خطأ: ' + error.message : 'تم الحفظ ✓ · 🕒 ' + nowStamp()); setTimeout(() => setWaMsg(''), 3000);
  };
  const saveBundleLimit = async () => {
    const n = Math.max(0, Math.floor(Number(bundleLimit) || 0));
    const now = new Date().toISOString();
    const { error } = await SB.from('settings').upsert({ key: 'retail_bundle_limit', value: String(n), updated_at: now }, { onConflict: 'key' });
    if (!error) { setBundleLimit(String(n)); setBlUpdated(now); }
    setBlMsg(error ? 'خطأ: ' + error.message : 'تم الحفظ ✓ · 🕒 ' + nowStamp()); setTimeout(() => setBlMsg(''), 3000);
  };
  const saveRfqLaunch = async () => {
    const now = new Date().toISOString();
    const { error } = await SB.from('settings').upsert({ key: 'rfq_launch_date', value: rfqLaunch || '', updated_at: now }, { onConflict: 'key' });
    if (!error) setRlUpdated(now);
    setRlMsg(error ? 'خطأ: ' + error.message : (rfqLaunch ? 'تم الحفظ ✓ · 🕒 ' : 'أُلغي التاريخ ✓ · 🕒 ') + nowStamp()); setTimeout(() => setRlMsg(''), 3000);
  };
  const clearRfqLaunch = () => { setRfqLaunch(''); };
  return (
    <div>
      <div className="card">
        <div className="secttl">رقم دعم واتساب</div>
        <label className="fld"><span>الرقم (مع +967)</span>
          <input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="+9677XXXXXXXX" inputMode="tel" /></label>
        <button className="btn sm" onClick={saveWa}>حفظ الرقم</button>
        {waUpdated && <Stamp at={waUpdated} label="آخر تحديث" />}
        {waMsg && <div className={waMsg.indexOf('خطأ') === 0 ? 'err' : 'ok'}>{waMsg}</div>}
      </div>
      <div className="card">
        <div className="secttl">حد العروض المشكّلة للتجزئة</div>
        <div className="kv" style={{ marginBottom: 8, color: 'var(--muted)' }}>أقصى عدد من «العروض المشكّلة» يسمح به لكل تاجر تجزئة. الافتراضي ١.</div>
        <label className="fld"><span>الحد الأقصى لكل متجر</span>
          <input value={bundleLimit} onChange={(e) => setBundleLimit(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1" inputMode="numeric" /></label>
        <button className="btn sm" onClick={saveBundleLimit}>حفظ الحد</button>
        {blUpdated && <Stamp at={blUpdated} label="آخر تحديث" />}
        {blMsg && <div className={blMsg.indexOf('خطأ') === 0 ? 'err' : 'ok'}>{blMsg}</div>}
      </div>
      <div className="card">
        <div className="secttl">تاريخ إطلاق «الطلب المسبق»</div>
        <div className="kv" style={{ marginBottom: 8, color: 'var(--muted)' }}>
          عند تحديد التاريخ: يُفتح النظام لكل التجّار المُوثّقين لمدة ٦ أشهر من هذا التاريخ، ثم يقتصر بعدها على تجزئة المستوى ٥ (مبيعات تراكمية ٥٠٠٬٠٠٠ فأكثر). اترك الحقل فارغاً ليبقى مفتوحاً دائماً لكل التجّار المُوثّقين.
        </div>
        <label className="fld"><span>التاريخ</span>
          <input type="date" value={rfqLaunch} onChange={(e) => setRfqLaunch(e.target.value)} /></label>
        <div className="acts" style={{ flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={saveRfqLaunch}>حفظ التاريخ</button>
          {rfqLaunch && <button className="btn sm ghost" onClick={clearRfqLaunch}>مسح</button>}
        </div>
        {rlUpdated && <Stamp at={rlUpdated} label="آخر تحديث" />}
        {rlMsg && <div className={rlMsg.indexOf('خطأ') === 0 ? 'err' : 'ok'}>{rlMsg}</div>}
      </div>
    </div>
  );
}

// ---- Shahti (خالٍ من المرارة) per-product requests ----
function ShahtiReqs() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [msg, setMsg] = useState('');
  const load = async () => {
    setRows(null);
    let q = SB.from('products').select('id,name,data,status,shahti_status,vendor_id,created_at').order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('shahti_status', filter); else q = q.not('shahti_status', 'is', null);
    const { data, error } = await q;
    setRows(error ? [] : (data || []));
  };
  useEffect(() => { load(); }, [filter]);
  const decide = async (r, status) => {
    const data = Object.assign({}, r.data || {}); data.shahtiStatus = status;
    const { error } = await SB.from('products').update({ shahti_status: status, data: data }).eq('id', r.id);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg((status === 'approved' ? 'تم القبول ✓' : 'تم الرفض') + ' · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 3000); load();
  };
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {['pending', 'approved', 'rejected', 'all'].map((f) =>
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{{ pending: 'منتظر', approved: 'مقبول', rejected: 'مرفوض', all: 'الكل' }[f]}</button>)}
      </div>
      {msg && <div className="ok" style={{ marginBottom: 10 }}>{msg}</div>}
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد طلبات شارة.</div>
          : rows.map((r) => {
            const nm = (r.name) || (r.data && r.data.name && r.data.name.ar) || 'منتج';
            const insp = r.data && r.data.inspect && (r.data.inspect.ar || r.data.inspect);
            return (
              <div className="card" key={r.id}>
                <div className="v-head"><strong>{nm}</strong><span className={`tag ${r.shahti_status === 'approved' ? 'approved' : r.shahti_status === 'rejected' ? 'rejected' : 'pending'}`}>{{ pending: 'منتظر', approved: 'مقبول', rejected: 'مرفوض' }[r.shahti_status] || r.shahti_status}</span>{r.status === 'hidden' && <span className="tag">مخفي/مُباع</span>}</div>
                {insp && <div className="kv"><b>الفحص:</b> {insp}</div>}
                <div className="kv"><b>المتجر:</b> <span style={{ fontSize: 11 }}>{r.vendor_id}</span></div>
                <Stamp at={r.created_at} label="تاريخ إضافة المنتج" />
                {r.shahti_status !== 'approved' &&
                  <div className="acts">
                    <button className="btn sm" onClick={() => decide(r, 'approved')}>✓ قبول</button>
                    {r.shahti_status !== 'rejected' && <button className="btn sm danger" onClick={() => decide(r, 'rejected')}>رفض</button>}
                  </div>}
              </div>
            );
          })}
    </div>
  );
}

// ---- User account management (تعليق / حظر / حذف) ----
function Users() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const load = async () => {
    setRows(null);
    let query = SB.from('profiles').select('*').order('created_at', { ascending: false });
    if (filter !== 'all') query = query.eq('status', filter);
    const { data, error } = await query;
    setRows(error ? [] : (data || []));
  };
  useEffect(() => { load(); }, [filter]);
  const setStatus = async (r, status, label) => {
    if (!confirm(label + ' الحساب «' + (r.name || r.phone || 'مستخدم') + '»؟')) return;
    const { error } = await SB.from('profiles').update({ status: status }).eq('user_id', r.user_id);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg('تم ✓ · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 3000); load();
  };
  // Re-activate clears the number-sharing strike state (warning_count -> 0).
  const reactivate = async (r) => {
    if (!confirm('إعادة تفعيل الحساب «' + (r.name || r.phone || 'مستخدم') + '» وتصفير المخالفات؟')) return;
    const { error } = await SB.rpc('admin_reactivate_account', { p_user: r.user_id });
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg('تمت إعادة التفعيل وتصفير المخالفات ✓ · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 3000); load();
  };
  const del = async (r) => {
    if (!confirm('⚠️ حذف الحساب «' + (r.name || r.phone || 'مستخدم') + '» وكل بياناته نهائياً؟ لا يمكن التراجع.')) return;
    if (!confirm('تأكيد أخير: سيتم حذف منتجاته ومتجره. متابعة؟')) return;
    // Best-effort cascade of the user's app data, then flag for final auth removal.
    try { await SB.from('products').delete().eq('vendor_id', r.user_id); } catch (e) {}
    try { await SB.from('stores').delete().eq('vendor_id', r.user_id); } catch (e) {}
    try { await SB.from('deletion_requests').upsert({ user_id: r.user_id, name: r.name, phone: r.phone, role: r.role, status: 'pending', created_at: new Date().toISOString() }, { onConflict: 'user_id' }); } catch (e) {}
    const { error } = await SB.from('profiles').update({ status: 'deleted' }).eq('user_id', r.user_id);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg('تم حذف بيانات الحساب. أزل الحساب نهائياً من تبويب «طلبات الحذف».'); setTimeout(() => setMsg(''), 3500); load();
  };
  const ROLE = { farmer_almond: 'مزارع لوز', farmer_raisin: 'مزارع زبيب', farmer: 'مزارع', retail: 'تاجر تجزئة', wholesale: 'تاجر جملة', customer: 'زبون' };
  const ST = { active: ['مفعّل', 'approved'], suspended: ['معلّق', 'pending'], banned: ['محظور', 'rejected'], deleted: ['محذوف', 'rejected'] };
  const visible = (rows || []).filter((r) => !q.trim() || (r.name || '').includes(q.trim()) || (r.phone || '').includes(q.trim()));
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {['all', 'active', 'suspended', 'banned'].map((f) =>
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{{ all: 'الكل', active: 'مفعّل', suspended: 'معلّق', banned: 'محظور' }[f]}</button>)}
      </div>
      <label className="fld"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم أو الهاتف…" /></label>
      {msg && <div className="ok" style={{ margin: '4px 0 10px' }}>{msg}</div>}
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !visible.length ? <div className="empty">لا يوجد مستخدمون. (تأكّد من إنشاء جدول profiles)</div>
          : visible.map((r) => {
            const st = ST[r.status] || ['—', 'pending'];
            return (
              <div className="card" key={r.user_id}>
                <div className="v-head"><strong>{r.name || 'بدون اسم'}</strong><span className={`tag ${st[1]}`}>{st[0]}</span></div>
                <div className="kv"><b>الهاتف:</b> {r.phone || '—'}</div>
                <div className="kv"><b>الدور:</b> {ROLE[r.role] || r.role || '—'}</div>
                {(r.warning_count > 0 || r.suspended_reason) &&
                  <div className="kv"><b>مخالفات مشاركة الأرقام:</b> <span style={{ color: r.warning_count >= 3 ? 'var(--danger)' : 'var(--gold-deep)', fontWeight: 800 }}>{r.warning_count || 0} / 3</span>{r.suspended_reason === 'three_strikes_number_sharing' ? ' · موقوف تلقائياً' : ''}</div>}
                <div className="kv"><b>المعرّف:</b> <span style={{ fontSize: 11 }}>{r.user_id}</span></div>
                <Stamp at={r.created_at} label="تاريخ التسجيل" />
                {r.updated_at && <Stamp at={r.updated_at} label="آخر تحديث" />}
                {r.status !== 'deleted' &&
                  <div className="acts" style={{ flexWrap: 'wrap' }}>
                    {r.status !== 'suspended' && <button className="btn sm ghost" onClick={() => setStatus(r, 'suspended', 'تعليق')}>تعليق</button>}
                    {r.status === 'suspended' && <button className="btn sm" onClick={() => reactivate(r)}>إلغاء التعليق</button>}
                    {r.status !== 'banned' && <button className="btn sm danger" onClick={() => setStatus(r, 'banned', 'حظر')}>حظر</button>}
                    {r.status === 'banned' && <button className="btn sm" onClick={() => reactivate(r)}>رفع الحظر</button>}
                    <button className="btn sm danger" onClick={() => del(r)}>حذف</button>
                  </div>}
              </div>
            );
          })}
    </div>
  );
}

// ---- LOZI savings products (خانة التوفير) ----
function SavingsAdmin() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [weight, setWeight] = useState('');
  const [price, setPrice] = useState('');
  const [oldPrice, setOldPrice] = useState('');
  const [pub, setPub] = useState(true);
  const [imgUrl, setImgUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState('');
  const [view, setView] = useState('products');
  const load = async () => {
    setRows(null);
    const { data, error } = await SB.from('products').select('*').eq('category', 'savings').order('pinned', { ascending: false }).order('created_at', { ascending: false });
    setRows(error ? [] : (data || []));
  };
  useEffect(() => { load(); }, []);
  const reset = () => { setName(''); setDesc(''); setWeight(''); setPrice(''); setOldPrice(''); setPub(true); setImgUrl(''); setEditId(null); };
  const pickImg = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg('جارٍ رفع الصورة…');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = 'lozi-savings/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
    const { error } = await SB.storage.from('product-images').upload(path, file, { upsert: true });
    if (error) { setBusy(false); return setMsg('تعذّر رفع الصورة: ' + error.message); }
    const { data } = SB.storage.from('product-images').getPublicUrl(path);
    setImgUrl(data.publicUrl); setBusy(false); setMsg('تم رفع الصورة ✓'); setTimeout(() => setMsg(''), 1500);
  };
  const save = async () => {
    if (!name.trim() || !price || Number(price) <= 0) return setMsg('أدخل الاسم والسعر.');
    setBusy(true); setMsg('');
    const { data: au } = await SB.auth.getUser();
    const uid = au && au.user && au.user.id;
    const data = {
      name: { ar: name.trim(), en: name.trim() },
      weight: { ar: weight.trim() || '—', en: weight.trim() || '—' },
      desc: { ar: desc.trim(), en: desc.trim() },
      img: imgUrl, images: imgUrl ? [imgUrl] : [],
      price: Number(price), old: oldPrice ? Number(oldPrice) : null, cat: 'savings',
    };
    const row = {
      vendor_id: uid, vendor_role: 'retail', category: 'savings',
      name: name.trim(), description: desc.trim() || null,
      price: Number(price), status: pub ? 'available' : 'hidden', data: data,
    };
    const res = editId ? await SB.from('products').update(row).eq('id', editId) : await SB.from('products').insert(row);
    setBusy(false);
    if (res.error) return setMsg('خطأ: ' + res.error.message);
    setMsg(editId ? 'تم التعديل ✓' : 'تمت الإضافة ✓'); setTimeout(() => setMsg(''), 1800); reset(); load();
  };
  const edit = (r) => {
    const d = r.data || {};
    setEditId(r.id); setName((d.name && d.name.ar) || r.name || '');
    setDesc((d.desc && d.desc.ar) || r.description || ''); setWeight((d.weight && d.weight.ar) || '');
    setPrice(String(r.price || d.price || '')); setOldPrice(d.old ? String(d.old) : '');
    setPub(r.status !== 'hidden'); setImgUrl(d.img || '');
    window.scrollTo(0, 0);
  };
  const toggle = async (r) => { const { error } = await SB.from('products').update({ status: r.status === 'hidden' ? 'available' : 'hidden' }).eq('id', r.id); if (!error) load(); };
  const del = async (r) => { if (!confirm('حذف هذا المنتج من خانة التوفير؟')) return; const { error } = await SB.from('products').delete().eq('id', r.id); if (!error) load(); };
  const pin = async (r) => {
    const val = !r.pinned;
    if (val && (rows || []).filter((x) => x.pinned && x.id !== r.id).length >= 3) {
      setMsg('الحد الأقصى 3 منتجات مثبّتة'); setTimeout(() => setMsg(''), 3000); return;
    }
    const { error } = await SB.from('products').update({ pinned: val, pinned_at: val ? new Date().toISOString() : null }).eq('id', r.id);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg((val ? 'تم التثبيت 📌' : 'تم إلغاء التثبيت') + ' · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 2500); load();
  };
  const regular = (rows || []).filter((r) => !(r.data && r.data.bundle));
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        <button className={view === 'products' ? 'on' : ''} onClick={() => setView('products')}>منتجات التوفير</button>
        <button className={view === 'bundles' ? 'on' : ''} onClick={() => setView('bundles')}>عرض مشكّل</button>
      </div>
      {view === 'bundles' ? <BundleAdmin /> : <div>
      <div className="card">
        <div className="secttl">{editId ? 'تعديل منتج توفير' : 'إضافة منتج إلى خانة التوفير'}</div>
        <label className="fld"><span>اسم المنتج</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: لوز جبري مقشّر" /></label>
        <label className="fld"><span>الوصف</span><textarea rows="2" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="وصف مختصر للمنتج" /></label>
        <label className="fld"><span>الوزن / الكمية</span><input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="مثال: ٥٠٠ جم" /></label>
        <div className="row2">
          <label className="fld" style={{ flex: 1 }}><span>سعر لوزي (ريال)</span><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="السعر الفعلي" /></label>
          <label className="fld" style={{ flex: 1 }}><span>السعر المشطوب (السوق)</span><input value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} inputMode="numeric" placeholder="سعر السوق" /></label>
        </div>
        {(price || oldPrice) &&
          <div className="kv" style={{ marginBottom: 10 }}><b>المعاينة:</b> <span style={{ color: 'var(--green-deep)', fontWeight: 900, fontSize: 16 }}>{price || '—'} ريال</span>{oldPrice && <span style={{ textDecoration: 'line-through', color: 'var(--muted)', marginInlineStart: 8 }}>{oldPrice} ريال</span>}</div>}
        <label className="fld"><span>صورة المنتج</span>
          <input type="file" accept="image/*" onChange={pickImg} /></label>
        {imgUrl && <img src={imgUrl} alt="" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} />}
        <div className="store-row" style={{ borderTop: 'none', padding: '4px 0 12px' }}>
          <span className="sr-name">نشر المنتج (ظاهر للعملاء)</span>
          <div className={`switch ${pub ? 'on' : ''}`} onClick={() => setPub(!pub)}><i></i></div>
        </div>
        <div className="row2">
          <button className="btn sm" disabled={busy} onClick={save}>{busy ? 'جارٍ…' : (editId ? 'حفظ التعديل' : 'إضافة المنتج')}</button>
          {editId && <button className="btn sm ghost" onClick={reset}>إلغاء</button>}
        </div>
        {msg && <div className={msg.indexOf('خطأ') === 0 || msg.indexOf('تعذّر') === 0 ? 'err' : 'ok'} style={{ marginTop: 8 }}>{msg}</div>}
      </div>
      <div className="secttl">منتجات التوفير الحالية</div>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !regular.length ? <div className="empty">لا توجد منتجات بعد.</div>
          : regular.map((r) => {
            const d = r.data || {};
            return (
              <div className="card" key={r.id}>
                <div className="v-head" style={{ alignItems: 'center' }}>
                  {d.img && <img src={d.img} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10 }} />}
                  <strong style={{ flex: 1 }}>{r.pinned && <span title="مثبّت">📌 </span>}{r.name}</strong>
                  {r.pinned && <span className="tag approved">مثبّت</span>}
                  {r.status === 'hidden' && <span className="tag rejected">مخفي</span>}
                </div>
                <div className="kv"><b>السعر:</b> <span style={{ color: 'var(--green-deep)', fontWeight: 800 }}>{r.price} ريال</span>{d.old && <span style={{ textDecoration: 'line-through', color: 'var(--muted)', marginInlineStart: 8 }}>{d.old} ريال</span>}</div>
                <Stamp at={r.created_at} label="تاريخ الإضافة" />
                {r.updated_at && <Stamp at={r.updated_at} label="آخر تعديل" />}
                <div className="acts">
                  <button className="btn sm ghost" onClick={() => edit(r)}>تعديل</button>
                  <button className={`btn sm ${r.pinned ? 'gold' : 'ghost'}`} onClick={() => pin(r)}>{r.pinned ? '📌 إلغاء التثبيت' : '📌 تثبيت'}</button>
                  <button className="btn sm ghost" onClick={() => toggle(r)}>{r.status === 'hidden' ? 'إظهار' : 'إخفاء'}</button>
                  <button className="btn sm danger" onClick={() => del(r)}>حذف</button>
                </div>
              </div>
            );
          })}
      </div>}
    </div>
  );
}

// ---- LOZI VIP market (سوق VIP) — admin-created premium products ----
// Cloned from SavingsAdmin: same product-adding mechanism, same weight/unit
// handling, same price input, same form layout. The only difference is the
// data goes to the VIP collection (category 'vip'); the customer-facing VIP
// page renders it in the gold/dark theme.
function VipAdmin() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [weight, setWeight] = useState('');
  const [price, setPrice] = useState('');
  const [oldPrice, setOldPrice] = useState('');
  const [pub, setPub] = useState(true);
  const [imgUrl, setImgUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    setRows(null);
    const { data, error } = await SB.from('products').select('*').eq('category', 'vip').order('pinned', { ascending: false }).order('created_at', { ascending: false });
    setRows(error ? [] : (data || []));
  };
  useEffect(() => { load(); }, []);
  const reset = () => { setName(''); setDesc(''); setWeight(''); setPrice(''); setOldPrice(''); setPub(true); setImgUrl(''); setEditId(null); };
  const pickImg = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg('جارٍ رفع الصورة…');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = 'lozi-vip/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
    const { error } = await SB.storage.from('product-images').upload(path, file, { upsert: true });
    if (error) { setBusy(false); return setMsg('تعذّر رفع الصورة: ' + error.message); }
    const { data } = SB.storage.from('product-images').getPublicUrl(path);
    setImgUrl(data.publicUrl); setBusy(false); setMsg('تم رفع الصورة ✓'); setTimeout(() => setMsg(''), 1500);
  };
  const save = async () => {
    if (!name.trim() || !price || Number(price) <= 0) return setMsg('أدخل الاسم والسعر.');
    setBusy(true); setMsg('');
    const { data: au } = await SB.auth.getUser();
    const uid = au && au.user && au.user.id;
    const data = {
      name: { ar: name.trim(), en: name.trim() },
      weight: { ar: weight.trim() || '—', en: weight.trim() || '—' },
      desc: { ar: desc.trim(), en: desc.trim() },
      img: imgUrl, images: imgUrl ? [imgUrl] : [],
      price: Number(price), old: oldPrice ? Number(oldPrice) : null, cat: 'vip',
    };
    const row = {
      vendor_id: uid, vendor_role: 'retail', category: 'vip',
      name: name.trim(), description: desc.trim() || null,
      price: Number(price), status: pub ? 'available' : 'hidden', data: data,
    };
    const res = editId ? await SB.from('products').update(row).eq('id', editId) : await SB.from('products').insert(row);
    setBusy(false);
    if (res.error) return setMsg('خطأ: ' + res.error.message);
    setMsg(editId ? 'تم التعديل ✓' : 'تمت الإضافة ✓'); setTimeout(() => setMsg(''), 1800); reset(); load();
  };
  const edit = (r) => {
    const d = r.data || {};
    setEditId(r.id); setName((d.name && d.name.ar) || r.name || '');
    setDesc((d.desc && d.desc.ar) || r.description || ''); setWeight((d.weight && d.weight.ar) || '');
    setPrice(String(r.price || d.price || '')); setOldPrice(d.old ? String(d.old) : '');
    setPub(r.status !== 'hidden'); setImgUrl(d.img || '');
    window.scrollTo(0, 0);
  };
  const toggle = async (r) => { const { error } = await SB.from('products').update({ status: r.status === 'hidden' ? 'available' : 'hidden' }).eq('id', r.id); if (!error) load(); };
  const del = async (r) => { if (!confirm('حذف هذا المنتج من سوق VIP؟')) return; const { error } = await SB.from('products').delete().eq('id', r.id); if (!error) load(); };
  const pin = async (r) => {
    const val = !r.pinned;
    if (val && (rows || []).filter((x) => x.pinned && x.id !== r.id).length >= 3) {
      setMsg('الحد الأقصى 3 منتجات مثبّتة'); setTimeout(() => setMsg(''), 3000); return;
    }
    const { error } = await SB.from('products').update({ pinned: val, pinned_at: val ? new Date().toISOString() : null }).eq('id', r.id);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg((val ? 'تم التثبيت 📌' : 'تم إلغاء التثبيت') + ' · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 2500); load();
  };
  return (
    <div>
      <div className="card">
        <div className="secttl">{editId ? 'تعديل منتج VIP' : 'إضافة منتج إلى سوق VIP'}</div>
        <label className="fld"><span>اسم المنتج</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: لوز جبري فاخر منتقى" /></label>
        <label className="fld"><span>الوصف</span><textarea rows="2" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="وصف مختصر للمنتج" /></label>
        <label className="fld"><span>الوزن / الكمية</span><input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="مثال: ٥٠٠ جم" /></label>
        <div className="row2">
          <label className="fld" style={{ flex: 1 }}><span>سعر لوزي (ريال)</span><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="السعر الفعلي" /></label>
          <label className="fld" style={{ flex: 1 }}><span>السعر المشطوب (السوق)</span><input value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} inputMode="numeric" placeholder="سعر السوق" /></label>
        </div>
        {(price || oldPrice) &&
          <div className="kv" style={{ marginBottom: 10 }}><b>المعاينة:</b> <span style={{ color: 'var(--green-deep)', fontWeight: 900, fontSize: 16 }}>{price || '—'} ريال</span>{oldPrice && <span style={{ textDecoration: 'line-through', color: 'var(--muted)', marginInlineStart: 8 }}>{oldPrice} ريال</span>}</div>}
        <label className="fld"><span>صورة المنتج</span>
          <input type="file" accept="image/*" onChange={pickImg} /></label>
        {imgUrl && <img src={imgUrl} alt="" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} />}
        <div className="store-row" style={{ borderTop: 'none', padding: '4px 0 12px' }}>
          <span className="sr-name">نشر المنتج (ظاهر للعملاء)</span>
          <div className={`switch ${pub ? 'on' : ''}`} onClick={() => setPub(!pub)}><i></i></div>
        </div>
        <div className="row2">
          <button className="btn sm" disabled={busy} onClick={save}>{busy ? 'جارٍ…' : (editId ? 'حفظ التعديل' : 'إضافة المنتج')}</button>
          {editId && <button className="btn sm ghost" onClick={reset}>إلغاء</button>}
        </div>
        {msg && <div className={msg.indexOf('خطأ') === 0 || msg.indexOf('تعذّر') === 0 ? 'err' : 'ok'} style={{ marginTop: 8 }}>{msg}</div>}
      </div>
      <div className="secttl">منتجات VIP الحالية</div>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد منتجات بعد.</div>
          : rows.map((r) => {
            const d = r.data || {};
            return (
              <div className="card" key={r.id}>
                <div className="v-head" style={{ alignItems: 'center' }}>
                  {d.img && <img src={d.img} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10 }} />}
                  <strong style={{ flex: 1 }}>{r.pinned && <span title="مثبّت">📌 </span>}{r.name}</strong>
                  {r.pinned && <span className="tag approved">مثبّت</span>}
                  {r.status === 'hidden' && <span className="tag rejected">مخفي</span>}
                </div>
                <div className="kv"><b>السعر:</b> <span style={{ color: 'var(--green-deep)', fontWeight: 800 }}>{r.price} ريال</span>{d.old && <span style={{ textDecoration: 'line-through', color: 'var(--muted)', marginInlineStart: 8 }}>{d.old} ريال</span>}</div>
                <Stamp at={r.created_at} label="تاريخ الإضافة" />
                {r.updated_at && <Stamp at={r.updated_at} label="آخر تعديل" />}
                <div className="acts">
                  <button className="btn sm ghost" onClick={() => edit(r)}>تعديل</button>
                  <button className={`btn sm ${r.pinned ? 'gold' : 'ghost'}`} onClick={() => pin(r)}>{r.pinned ? '📌 إلغاء التثبيت' : '📌 تثبيت'}</button>
                  <button className="btn sm ghost" onClick={() => toggle(r)}>{r.status === 'hidden' ? 'إظهار' : 'إخفاء'}</button>
                  <button className="btn sm danger" onClick={() => del(r)}>حذف</button>
                </div>
              </div>
            );
          })}
    </div>
  );
}

// ---- LOZI mixed bundle offers (عرض مشكّل) ----
function BundleAdmin() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [pub, setPub] = useState(true);
  const [imgUrl, setImgUrl] = useState('');
  const [items, setItems] = useState([{ name: '', weight: '', unit: 'gram' }, { name: '', weight: '', unit: 'gram' }]);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    setRows(null);
    const { data, error } = await SB.from('products').select('*').eq('category', 'savings').order('created_at', { ascending: false });
    setRows(error ? [] : (data || []).filter((r) => r.data && r.data.bundle));
  };
  useEffect(() => { load(); }, []);
  const reset = () => { setName(''); setPrice(''); setStock(''); setPub(true); setImgUrl(''); setItems([{ name: '', weight: '' }, { name: '', weight: '' }]); setEditId(null); };
  const pickImg = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg('جارٍ رفع الصورة…');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = 'lozi-savings/bundle-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
    const { error } = await SB.storage.from('product-images').upload(path, file, { upsert: true });
    if (error) { setBusy(false); return setMsg('تعذّر رفع الصورة: ' + error.message); }
    const { data } = SB.storage.from('product-images').getPublicUrl(path);
    setImgUrl(data.publicUrl); setBusy(false); setMsg('تم رفع الصورة ✓'); setTimeout(() => setMsg(''), 1500);
  };
  const setItem = (i, k, v) => setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const addItem = () => setItems((arr) => [...arr, { name: '', weight: '', unit: 'gram' }]);
  const removeItem = (i) => setItems((arr) => (arr.length > 1 ? arr.filter((_, j) => j !== i) : arr));
  const save = async () => {
    const cleanItems = items.map((it) => ({ name: it.name.trim(), weight: String(it.weight || '').trim(), unit: it.unit === 'kilo' ? 'kilo' : 'gram' })).filter((it) => it.name);
    if (!name.trim() || !price || Number(price) <= 0) return setMsg('أدخل اسم العرض والسعر الإجمالي.');
    if (cleanItems.length < 2) return setMsg('أضف عنصرين على الأقل إلى العرض المشكّل.');
    setBusy(true); setMsg('');
    const { data: au } = await SB.auth.getUser();
    const uid = au && au.user && au.user.id;
    const summary = cleanItems.map((it) => { const w = fmtItemWeight(it); return it.name + (w ? ' ' + w : ''); }).join(' + ');
    const stockVal = stock !== '' ? Math.max(0, Math.floor(Number(stock) || 0)) : null;
    const data = {
      name: { ar: name.trim(), en: name.trim() },
      weight: { ar: 'عرض مشكّل', en: 'Mixed bundle' },
      desc: { ar: 'عرض مشكّل — محتويات وأوزان ثابتة بسعر واحد.', en: 'Mixed bundle — fixed contents and weights, one price.' },
      img: imgUrl, images: imgUrl ? [imgUrl] : [],
      price: Number(price), cat: 'savings',
      bundle: true, items: cleanItems, stock: stockVal,
    };
    const row = {
      vendor_id: uid, vendor_role: 'retail', category: 'savings',
      name: name.trim(), description: summary,
      price: Number(price), status: pub ? 'available' : 'hidden',
      stock: stockVal, data: data,
    };
    const res = editId ? await SB.from('products').update(row).eq('id', editId) : await SB.from('products').insert(row);
    setBusy(false);
    if (res.error) return setMsg('خطأ: ' + res.error.message);
    setMsg(editId ? 'تم التعديل ✓' : 'تمت الإضافة ✓'); setTimeout(() => setMsg(''), 1800); reset(); load();
  };
  const edit = (r) => {
    const d = r.data || {};
    setEditId(r.id);
    setName((d.name && d.name.ar) || r.name || '');
    setPrice(String(r.price || d.price || ''));
    setStock(r.stock != null ? String(r.stock) : (d.stock != null ? String(d.stock) : ''));
    setPub(r.status !== 'hidden');
    setImgUrl(d.img || '');
    setItems(d.items && d.items.length ? d.items.map((it) => ({ name: it.name || '', weight: it.weight != null ? String(it.weight) : '', unit: it.unit === 'kilo' ? 'kilo' : 'gram' })) : [{ name: '', weight: '', unit: 'gram' }, { name: '', weight: '', unit: 'gram' }]);
    window.scrollTo(0, 0);
  };
  const toggle = async (r) => { const { error } = await SB.from('products').update({ status: r.status === 'hidden' ? 'available' : 'hidden' }).eq('id', r.id); if (!error) load(); };
  const del = async (r) => { if (!confirm('حذف هذا العرض المشكّل؟')) return; const { error } = await SB.from('products').delete().eq('id', r.id); if (!error) load(); };
  return (
    <div>
      <div className="card">
        <div className="secttl">{editId ? 'تعديل عرض مشكّل' : 'إنشاء عرض مشكّل'}</div>
        <label className="fld"><span>اسم العرض (يمكن تغييره لاحقاً)</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: عرض المكسّرات المشكّل" /></label>
        <label className="fld"><span>السعر الإجمالي للعرض (ريال)</span><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="سعر العرض كاملاً" /></label>
        <label className="fld"><span>الكمية المتوفّرة (مخزون العرض)</span><input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" placeholder="اتركه فارغاً لغير محدود" /></label>
        <div className="secttl" style={{ marginTop: 6 }}>مكوّنات العرض</div>
        {items.map((it, i) => (
          <div className="bundle-item" key={i}>
            <div className="bundle-item-head">
              <span className="bundle-item-title">الصنف {i + 1}</span>
              <button className="btn sm danger" disabled={items.length <= 1} onClick={() => removeItem(i)}>حذف</button>
            </div>
            <label className="fld"><span>الصنف</span><input value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} placeholder="مثال: لوز" /></label>
            <div className="row2">
              <label className="fld" style={{ flex: 2 }}><span>الوزن</span><input value={it.weight} onChange={(e) => setItem(i, 'weight', e.target.value)} inputMode="decimal" placeholder="مثال: ٢٥٠" /></label>
              <label className="fld" style={{ flex: 1, minWidth: 110 }}><span>الوحدة</span>
                <select value={it.unit || 'gram'} onChange={(e) => setItem(i, 'unit', e.target.value)}>
                  <option value="gram">جرام</option>
                  <option value="kilo">كيلو</option>
                </select>
              </label>
            </div>
          </div>
        ))}
        <button className="btn sm ghost" onClick={addItem} style={{ marginBottom: 10 }}>+ إضافة صنف</button>
        <label className="fld"><span>صورة العرض</span>
          <input type="file" accept="image/*" onChange={pickImg} /></label>
        {imgUrl && <img src={imgUrl} alt="" style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} />}
        <div className="store-row" style={{ borderTop: 'none', padding: '4px 0 12px' }}>
          <span className="sr-name">نشر العرض (ظاهر للعملاء)</span>
          <div className={`switch ${pub ? 'on' : ''}`} onClick={() => setPub(!pub)}><i></i></div>
        </div>
        <div className="row2">
          <button className="btn sm" disabled={busy} onClick={save}>{busy ? 'جارٍ…' : (editId ? 'حفظ التعديل' : 'إنشاء العرض')}</button>
          {editId && <button className="btn sm ghost" onClick={reset}>إلغاء</button>}
        </div>
        {msg && <div className={msg.indexOf('خطأ') === 0 || msg.indexOf('تعذّر') === 0 ? 'err' : 'ok'} style={{ marginTop: 8 }}>{msg}</div>}
      </div>
      <div className="secttl">العروض المشكّلة الحالية</div>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد عروض مشكّلة بعد.</div>
          : rows.map((r) => {
            const d = r.data || {};
            const its = Array.isArray(d.items) ? d.items : [];
            return (
              <div className="card" key={r.id}>
                <div className="v-head" style={{ alignItems: 'center' }}>
                  {d.img && <img src={d.img} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 10 }} />}
                  <strong style={{ flex: 1 }}>{r.name}</strong>
                  <span className="tag approved">عرض مشكّل</span>
                  {r.status === 'hidden' && <span className="tag rejected">مخفي</span>}
                </div>
                <div className="kv"><b>السعر:</b> <span style={{ color: 'var(--green-deep)', fontWeight: 800 }}>{r.price} ريال</span></div>
                <div className="kv"><b>المخزون:</b> {r.stock != null ? r.stock : 'غير محدود'}</div>
                <div className="kv"><b>المكوّنات:</b> {its.map((it) => { const w = fmtItemWeight(it); return it.name + (w ? ' ' + w : ''); }).join(' + ') || '—'}</div>
                <Stamp at={r.created_at} label="تاريخ الإنشاء" />
                {r.updated_at && <Stamp at={r.updated_at} label="آخر تعديل" />}
                <div className="acts">
                  <button className="btn sm ghost" onClick={() => edit(r)}>تعديل</button>
                  <button className="btn sm ghost" onClick={() => toggle(r)}>{r.status === 'hidden' ? 'إظهار' : 'إخفاء'}</button>
                  <button className="btn sm danger" onClick={() => del(r)}>حذف</button>
                </div>
              </div>
            );
          })}
    </div>
  );
}

// ---- Orders management (الطلبات) ----
function OrdersAdmin() {
  const [orders, setOrders] = useState(null);
  const [prof, setProf] = useState({});   // user_id -> {name, phone, role}
  const [stores, setStores] = useState({}); // vendor_id -> store name
  const [pcat, setPcat] = useState({});    // product id -> category
  const [vcat, setVcat] = useState({});    // vendor_id -> category (fallback)
  const [tab, setTab] = useState('savings');
  const [sub, setSub] = useState('almond');
  const [msg, setMsg] = useState('');
  const [feeInput, setFeeInput] = useState({}); // order_no -> wholesale delivery fee being edited
  const [tiers, setTiers] = useState([]);
  const load = async () => {
    setOrders(null);
    const [o, p, s, pr, t] = await Promise.all([
      SB.from('orders').select('*').order('created_at', { ascending: false }),
      SB.from('products').select('id,category,vendor_id'),
      SB.from('stores').select('vendor_id,name'),
      SB.from('profiles').select('user_id,name,phone,role'),
      getTiers(),
    ]);
    setTiers(t || []);
    const pc = {}, vc = {};
    (p.data || []).forEach((r) => { pc[r.id] = r.category; if (r.category) vc[r.vendor_id] = r.category; });
    const sm = {}; (s.data || []).forEach((r) => { sm[r.vendor_id] = r.name; });
    const pm = {}; (pr.data || []).forEach((r) => { pm[r.user_id] = r; });
    setPcat(pc); setVcat(vc); setStores(sm); setProf(pm);
    setOrders(o.error ? [] : (o.data || []));
  };
  useEffect(() => { load(); }, []);
  // Each order's section is taken from its products' category (the accurate source),
  // falling back to the seller's category / role if a product was deleted.
  const catOf = (o) => {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) { const c = pcat[it.p]; if (c) return c; }
    if (vcat[o.seller_vendor_id]) return vcat[o.seller_vendor_id];
    const role = (prof[o.seller_vendor_id] || {}).role || '';
    if (role.indexOf('almond') >= 0) return 'almond';
    if (role.indexOf('raisin') >= 0) return 'raisin';
    if (role === 'retail' || role === 'wholesale') return role;
    return 'other';
  };
  const bucketOf = (c) => (c === 'savings' ? 'savings' : c === 'vip' ? 'vip' : (c === 'almond' || c === 'raisin') ? 'farmer' : (c === 'retail' || c === 'wholesale') ? c : 'other');
  const ROLE = { farmer_almond: 'مزارع لوز', farmer_raisin: 'مزارع زبيب', farmer: 'مزارع', retail: 'تاجر تجزئة', wholesale: 'تاجر جملة', customer: 'زبون', admin: 'لوزي' };
  const STAT = { new: ['جديد', 'pending'], received: ['جديد', 'pending'], payreview: ['بانتظار مراجعة الدفع', 'pending'], preparing: ['قيد التجهيز', 'pending'], delivering: ['قيد التسليم', 'pending'], delivered: ['مكتمل', 'approved'], rejected: ['مرفوض', 'rejected'], cancelled: ['ملغى', 'rejected'] };
  const PAYST = { pending: ['بانتظار المراجعة', 'pending'], approved: ['مقبول', 'approved'], rejected: ['مرفوض', 'rejected'] };
  const money = (n) => (Number(n) || 0).toLocaleString('en-US') + ' ريال';
  const when = (s) => fmtDT(s);
  const setStatus = async (o, status) => {
    const { error } = await SB.from('orders').update({ status }).eq('order_no', o.order_no);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg('تم تحديث الحالة ✓ · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 3000); load();
  };
  const openReceipt = async (o) => {
    let url = o.pay_receipt;
    if (url && url.indexOf('http') !== 0) { const { data } = SB.storage.from('product-images').getPublicUrl(url); url = data.publicUrl; }
    if (url) window.open(url, '_blank');
  };
  const setPay = async (o, pay_status) => {
    const { error } = await SB.from('orders').update({ pay_status }).eq('order_no', o.order_no);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg((pay_status === 'approved' ? 'تم قبول الإيصال ✓' : 'تم رفض الإيصال') + ' · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 3000); load();
  };
  // Wholesale only: admin enters the delivery cost; total = subtotal + fee.
  const setDelivery = async (o) => {
    const raw = feeInput[o.order_no];
    if (raw === '' || raw == null) return setMsg('أدخل رسوم التوصيل أولاً');
    const fee = Math.max(0, Math.round(Number(raw) || 0));
    const items = Array.isArray(o.items) ? o.items : [];
    const subtotal = items.reduce((a, it) => a + (Number(it.price) || 0) * (Number(it.q) || 0), 0);
    const { error } = await SB.from('orders').update({ delivery_fee: fee, total: subtotal + fee }).eq('order_no', o.order_no);
    if (error) return setMsg('خطأ: ' + error.message);
    setMsg('تم تحديث رسوم التوصيل ✓ · 🕒 ' + nowStamp()); setTimeout(() => setMsg(''), 3000); load();
  };
  const shown = (orders || []).filter((o) => { const b = bucketOf(catOf(o)); if (b !== tab) return false; if (tab === 'farmer') return catOf(o) === sub; return true; });
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 10px' }}>
        {[['savings', 'طلبات التوفير'], ['vip', 'طلبات VIP'], ['farmer', 'طلبات المزارعين'], ['retail', 'طلبات التجزئة'], ['wholesale', 'طلبات الجملة']].map(([id, label]) =>
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'farmer' &&
        <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
          {[['almond', 'لوز'], ['raisin', 'زبيب']].map(([id, label]) =>
            <button key={id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>{label}</button>)}
        </div>}
      {msg && <div className="ok" style={{ marginBottom: 10 }}>{msg}</div>}
      {orders === null ? <div className="empty">جارٍ التحميل…</div>
        : !shown.length ? <div className="empty">لا توجد طلبات في هذا القسم.</div>
          : shown.map((o) => {
            const seller = prof[o.seller_vendor_id] || {};
            const c = o.customer || {};
            const st = STAT[o.status] || [o.status, 'pending'];
            const items = Array.isArray(o.items) ? o.items : [];
            const isRfq = items.some((it) => String(it.p || '').startsWith('rfq-'));
            const isPlatform = tab === 'savings' || tab === 'vip';
            return (
              <div className="card" key={o.order_no}>
                <div className="v-head"><strong>طلب #{o.order_no}</strong>
                  {isRfq && <span className="tag" style={{ background: 'var(--gold-deep)', color: '#fff' }}>طلب مسبق</span>}
                  <span className={`tag ${st[1]}`}>{st[0]}</span></div>
                <Stamp at={o.created_at} label="تاريخ ووقت الطلب" />
                {o.updated_at && <Stamp at={o.updated_at} label="آخر تحديث" />}

                <div className="secttl" style={{ margin: '12px 0 4px', fontSize: 13.5 }}>🌿 البائع</div>
                <div className="kv"><b>الاسم:</b> {seller.name || (isPlatform ? (tab === 'vip' ? 'لوزي · VIP' : 'لوزي · التوفير') : '—')}</div>
                <div className="kv"><b>الهاتف:</b> {seller.phone || '—'}</div>
                <div className="kv"><b>الدور:</b> {ROLE[seller.role] || (isPlatform ? 'لوزي' : seller.role || '—')}</div>
                {stores[o.seller_vendor_id] && <div className="kv"><b>المتجر:</b> {stores[o.seller_vendor_id]}</div>}

                <div className="secttl" style={{ margin: '12px 0 4px', fontSize: 13.5 }}>🛒 المشتري</div>
                <div className="kv"><b>الاسم:</b> {c.name || '—'}</div>
                <div className="kv"><b>الهاتف:</b> {c.phone || '—'}</div>
                <div className="kv"><b>العنوان:</b> {[c.city, c.address].filter(Boolean).join('، ') || '—'}</div>

                <div className="secttl" style={{ margin: '12px 0 4px', fontSize: 13.5 }}>📦 تفاصيل الطلب</div>
                {items.map((it, i) =>
                  <div className="kv" key={i}>• {it.name || 'منتج'} — {it.q}{it.weight ? ' × ' + it.weight : ''} · {money(it.price)}</div>)}
                {tab === 'wholesale' &&
                  <div className="kv" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>
                    <b>رسوم التوصيل:</b>
                    <input type="number" min="0" inputMode="numeric" placeholder="أدخل التكلفة"
                      value={feeInput[o.order_no] != null ? feeInput[o.order_no] : (o.delivery_fee != null ? o.delivery_fee : '')}
                      onChange={(e) => setFeeInput((s) => ({ ...s, [o.order_no]: e.target.value }))}
                      style={{ width: 120 }} />
                    <button className="btn sm" onClick={() => setDelivery(o)}>حفظ</button>
                    <span style={{ color: 'var(--muted)' }}>{o.delivery_fee != null ? 'الحالي: ' + money(o.delivery_fee) : 'لم تُحدَّد بعد'}</span>
                  </div>}
                <div className="kv"><b>الإجمالي:</b> <span style={{ color: 'var(--green-deep)', fontWeight: 900 }}>{money(o.total)}</span></div>

                {o.commission_amount != null && (() => {
                  const tr = tierOf(tiers, o.segment, o.cumulative_before);
                  const reversed = o.commission_state === 'reversed' || o.commission_state === 'partially_reversed';
                  return (
                    <div style={{ margin: '10px 0', background: 'var(--sand)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 900, color: 'var(--gold-deep)' }}>٪ عمولة لوزي</div>
                        <div style={{ fontWeight: 900, color: 'var(--danger)', direction: 'ltr' }}>− {money2(o.commission_amount)} ر</div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                        <span className="tag">{SEG_AR[o.segment] || o.segment}</span>
                        {tr && <span className="tag">مستوى {AR(tr.level)}</span>}
                        <span className="tag">النسبة {pct(o.commission_rate_applied, o.segment)}</span>
                        <span className="tag">الأساس: البضاعة {money2(o.goods_subtotal)} ر</span>
                      </div>
                      {reversed && <div className="kv" style={{ marginTop: 8, color: 'var(--danger)', fontWeight: 800 }}>
                        {o.commission_state === 'reversed' ? 'أُعيدت العمولة كاملة' : 'أُعيد جزء من العمولة'} ({money2(o.reversed_amount)} ر)
                      </div>}
                    </div>
                  );
                })()}

                <div className="kv"><b>الدفع:</b> {o.pay === 'prepaid' ? 'تحويل مسبق' : 'نقداً عند الاستلام'}
                  {o.pay === 'prepaid' && <span className={`tag ${(PAYST[o.pay_status] || PAYST.pending)[1]}`} style={{ marginInlineStart: 6 }}>{(PAYST[o.pay_status] || PAYST.pending)[0]}</span>}</div>
                {o.reject_reason && <div className="kv"><b>سبب الرفض:</b> {o.reject_reason}</div>}

                {o.pay === 'prepaid' && o.pay_receipt &&
                  <div className="acts" style={{ flexWrap: 'wrap' }}>
                    <button className="btn sm ghost" onClick={() => openReceipt(o)}>عرض الإيصال</button>
                    {o.pay_status !== 'approved' && <button className="btn sm" onClick={() => setPay(o, 'approved')}>قبول الدفع</button>}
                    {o.pay_status !== 'rejected' && <button className="btn sm danger" onClick={() => setPay(o, 'rejected')}>رفض الدفع</button>}
                  </div>}

                <div className="acts" style={{ flexWrap: 'wrap', marginTop: 10 }}>
                  {[['preparing', 'قيد التجهيز'], ['delivering', 'قيد التسليم'], ['delivered', 'مكتمل'], ['cancelled', 'إلغاء']].map(([s, label]) =>
                    <button key={s} className={`btn sm ${o.status === s ? '' : (s === 'cancelled' ? 'danger' : 'ghost')}`} onClick={() => setStatus(o, s)}>{label}</button>)}
                </div>
              </div>
            );
          })}
    </div>
  );
}

// ---- Seller commission levels ----
function SellerLevels() {
  const [rows, setRows] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [filter, setFilter] = useState('all'); // all | retail | wholesale | top
  const load = async () => {
    setRows(null);
    const [t, p] = await Promise.all([
      getTiers(),
      SB.from('profiles').select('user_id,name,role,retail_cumulative_sales,wholesale_cumulative_sales'),
    ]);
    setTiers(t || []);
    const sellers = (p.data || []).filter((r) => {
      const role = r.role || '';
      const isSeller = role === 'farmer' || role.indexOf('farmer') === 0 || role === 'retail' || role === 'wholesale';
      const hasSales = Number(r.retail_cumulative_sales) > 0 || Number(r.wholesale_cumulative_sales) > 0;
      return isSeller || hasSales;
    });
    setRows(sellers);
  };
  useEffect(() => { load(); }, []);
  const Badge = ({ seg, cum }) => {
    const has = Number(cum) > 0;
    const tr = has ? tierOf(tiers, seg, cum) : null;
    const isW = seg === 'wholesale';
    const bg = !has ? '#F1F2F1' : isW ? 'var(--sand)' : 'var(--green-soft)';
    const col = !has ? '#9AA49D' : isW ? 'var(--gold-deep)' : 'var(--green-deep)';
    return (
      <span className="tag" style={{ background: bg, color: col, fontSize: 11.5, padding: '5px 10px' }}>
        {SEG_AR[seg]} {has && tr ? <b style={{ fontWeight: 900 }}>{'م' + AR(tr.level)} · {pct(tr.rate, seg)}</b> : '—'}
      </span>
    );
  };
  let shown = (rows || []);
  if (filter === 'retail') shown = shown.filter((r) => Number(r.retail_cumulative_sales) > 0);
  else if (filter === 'wholesale') shown = shown.filter((r) => Number(r.wholesale_cumulative_sales) > 0);
  else if (filter === 'top') shown = [...shown].sort((a, b) =>
    (Number(b.retail_cumulative_sales) + Number(b.wholesale_cumulative_sales)) -
    (Number(a.retail_cumulative_sales) + Number(a.wholesale_cumulative_sales)));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US') + ' ر';
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {[['all', 'الكل'], ['retail', 'تجزئة'], ['wholesale', 'جملة'], ['top', 'الأعلى مبيعاً']].map(([f, l]) =>
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{l}</button>)}
      </div>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !shown.length ? <div className="empty">لا يوجد بائعون.</div>
          : shown.map((r) => (
            <div className="card" key={r.user_id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: '0 0 auto', width: 44, height: 44, borderRadius: 13, background: 'var(--green-soft)', color: 'var(--green-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 17, border: '1px solid var(--line)' }}>{(r.name || '؟').trim().charAt(0)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 15 }}>{r.name || 'بدون اسم'}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  تراكمي: تجزئة <b style={{ color: 'var(--green-deep)' }}>{money(r.retail_cumulative_sales)}</b>
                  {Number(r.wholesale_cumulative_sales) > 0 && <> · جملة <b style={{ color: 'var(--gold-deep)' }}>{money(r.wholesale_cumulative_sales)}</b></>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', flex: '0 0 auto' }}>
                <Badge seg="retail" cum={r.retail_cumulative_sales} />
                <Badge seg="wholesale" cum={r.wholesale_cumulative_sales} />
              </div>
            </div>
          ))}
      <div className="muted" style={{ textAlign: 'center', padding: '6px 0' }}>
        {rows ? AR(shown.length) + ' بائع' : ''}
      </div>
    </div>
  );
}

function TrustBadges() {
  const [rows, setRows] = useState(null);
  const [view, setView] = useState('all'); // all | candidates | badged
  const [busy, setBusy] = useState('');
  const load = async () => {
    setRows(null);
    const { data } = await SB.from('stores')
      .select('vendor_id,name,trusted_badge,badge_source,badge_granted_at,badge_blocked,ratings_count,average_rating')
      .order('trusted_badge', { ascending: false })
      .order('average_rating', { ascending: false, nullsFirst: false });
    setRows(data || []);
  };
  useEffect(() => { load(); }, []);
  const act = async (fn, vendor) => {
    if (fn === 'admin_revoke_trusted_badge' && !window.confirm('سحب شارة «موثوق» من هذا المتجر؟ لن تُمنح تلقائياً مرة أخرى حتى تلغي الحظر.')) return;
    setBusy(vendor);
    const { error } = await SB.rpc(fn, { p_vendor: vendor });
    setBusy('');
    if (error) { alert('خطأ: ' + (error.message || 'تعذّر تنفيذ العملية')); return; }
    load();
  };
  const meets = (r) => Number(r.ratings_count) > 100 && Number(r.average_rating || 0) >= 4.5;
  const near = (r) => Number(r.ratings_count) > 80 && Number(r.average_rating || 0) >= 4.3;
  const srcLabel = (r) => r.trusted_badge ? (r.badge_source === 'auto' ? 'تلقائي' : 'يدوي') : (r.badge_blocked ? 'محظور (سُحبت إدارياً)' : '—');
  let shown = rows || [];
  if (view === 'candidates') shown = shown.filter((r) => !r.trusted_badge && (meets(r) || near(r)));
  else if (view === 'badged') shown = shown.filter((r) => r.trusted_badge);
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, padding: '0 2px 10px', lineHeight: 1.7 }}>
        شارة «موثوق» تُمنح تلقائياً عند تجاوز <b>100 تقييم</b> بمعدّل <b>4.5</b> فأعلى، أو يدوياً من هنا. لا تُسحب إلا يدوياً؛ والسحب يمنع المنح التلقائي لاحقاً.
      </div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {[['all', 'كل المتاجر'], ['candidates', 'مرشّحون للشارة'], ['badged', 'الحاصلون عليها']].map(([f, l]) =>
          <button key={f} className={view === f ? 'on' : ''} onClick={() => setView(f)}>{l}</button>)}
      </div>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !shown.length ? <div className="empty">لا توجد متاجر مطابقة.</div>
          : shown.map((r) => (
            <div className="card" key={r.vendor_id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {r.name || 'متجر'}
                  {r.trusted_badge && <span className="tag" style={{ background: 'var(--green-soft)', color: 'var(--green-deep)', fontSize: 11, padding: '4px 9px' }}>موثوق ⭐</span>}
                  {!r.trusted_badge && meets(r) && <span className="tag" style={{ background: '#FFF4DA', color: 'var(--gold-deep)', fontSize: 11, padding: '4px 9px' }}>مستوفٍ للمعايير</span>}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                  التقييمات: <b style={{ color: 'var(--ink)' }}>{r.ratings_count || 0}</b> · المعدّل: <b style={{ color: 'var(--gold-deep)' }}>{r.average_rating != null ? Number(r.average_rating).toFixed(2) : '—'}</b> · المصدر: <b>{srcLabel(r)}</b>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                {r.trusted_badge
                  ? <button className="btn sm danger" disabled={busy === r.vendor_id} onClick={() => act('admin_revoke_trusted_badge', r.vendor_id)}>سحب</button>
                  : <button className="btn sm" disabled={busy === r.vendor_id} onClick={() => act('admin_grant_trusted_badge', r.vendor_id)}>منح</button>}
                {r.badge_blocked && <button className="btn sm" disabled={busy === r.vendor_id} onClick={() => act('admin_unblock_trusted_badge', r.vendor_id)}>إلغاء الحظر</button>}
              </div>
            </div>
          ))}
      <div className="muted" style={{ textAlign: 'center', padding: '6px 0' }}>
        {rows ? shown.length + ' متجر' : ''}
      </div>
    </div>
  );
}

// ---- Chats oversight (الدردشات) — FULL monitoring of every conversation ----
// Admin can read ALL conversations (not only flagged ones). The automatic
// number/link/email flagging is an extra ALERT layer: flagged chats are
// highlighted and sortable to the top. Penalty is MANUAL per case — the admin
// decides warn/suspend/ban from the «المستخدمون» tab.
const CHAT_ROLE = { customer: 'عميل', farmer: 'مزارع', farmer_almond: 'مزارع لوز', farmer_raisin: 'مزارع زبيب', retail: 'تاجر تجزئة', wholesale: 'تاجر جملة', admin: 'إدارة' };
const roleLabel = (r) => CHAT_ROLE[r] || r || '—';
const FLAG_AR = { number: 'رقم هاتف', whatsapp: 'واتساب', telegram: 'تلغرام', email: 'بريد' };

function ChatThread({ conv, me, onBack }) {
  const [msgs, setMsgs] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Only savings/admin-managed conversations have LOZI admin as a participant.
  // The admin can reply only there; every other chat stays read-only oversight.
  const canReply = !!(me && (me.id === conv.participant_a || me.id === conv.participant_b));
  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const { error } = await SB.from('messages').insert({ conversation_id: conv.id, sender_id: me.id, body });
    setSending(false);
    if (!error) setDraft(''); // the realtime subscription appends the new message
  };
  const scroller = React.useRef(null);
  const nameOf = (sid) => sid === conv.participant_a ? (conv.participant_a_name || 'طرف أول')
    : sid === conv.participant_b ? (conv.participant_b_name || 'طرف ثاني') : 'مستخدم';
  const sideOf = (sid) => sid === conv.participant_a ? 'a' : 'b';
  useEffect(() => {
    let live = true;
    const load = async () => {
      const { data } = await SB.from('messages').select('*').eq('conversation_id', conv.id).order('created_at', { ascending: true });
      if (live) setMsgs(data || []);
    };
    load();
    // Mark this conversation's flag alerts as seen (admin opened it).
    SB.from('chat_flag_alerts').update({ seen: true }).eq('conversation_id', conv.id).eq('seen', false).then(() => {});
    // Realtime: new/updated messages appear instantly while the admin watches.
    const ch = SB.channel('admin-thread-' + conv.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conv.id }, (payload) => {
        setMsgs((prev) => {
          const list = prev ? prev.slice() : [];
          if (payload.eventType === 'INSERT') {
            if (list.some((m) => m.id === payload.new.id)) return list;
            return list.concat(payload.new);
          }
          if (payload.eventType === 'UPDATE') return list.map((m) => m.id === payload.new.id ? payload.new : m);
          if (payload.eventType === 'DELETE') return list.filter((m) => m.id !== payload.old.id);
          return list;
        });
      }).subscribe();
    return () => { live = false; SB.removeChannel(ch); };
  }, [conv.id]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [msgs]);
  return (
    <div className="card">
      <div className="chat-head">
        <button className="bk" onClick={onBack}>‹ رجوع</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="conv-parties">
            {conv.participant_a_name || 'طرف أول'} <span className="role-chip">{roleLabel(conv.participant_a_role)}</span>
            <span style={{ color: 'var(--muted)' }}>↔</span>
            {conv.participant_b_name || 'طرف ثاني'} <span className="role-chip">{roleLabel(conv.participant_b_role)}</span>
          </div>
          <div className="conv-meta">
            {conv.order_no ? 'مرتبطة بالطلب #' + conv.order_no + ' · ' : ''}آخر نشاط: {fmtDT(conv.last_message_at)}
          </div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        العقوبة يدوية: لتحذير/إيقاف/حظر أحد الطرفين استخدم تبويب «المستخدمون».
      </div>
      <div className="chat-scroll" ref={scroller}>
        {msgs === null ? <div className="empty">جارٍ التحميل…</div>
          : !msgs.length ? <div className="empty">لا توجد رسائل بعد.</div>
            : msgs.map((m) => (
              <div key={m.id} className={`bub ${sideOf(m.sender_id)}${m.flagged ? ' flag' : ''}`}>
                <div className="who">{nameOf(m.sender_id)}</div>
                <div>{m.body || (Array.isArray(m.attachments) && m.attachments.length ? '📎 مرفق' : '—')}</div>
                {m.flagged && (m.flag_reasons || []).length > 0 &&
                  <div className="reasons">{(m.flag_reasons || []).map((r) => <span key={r} className="flag-chip">⚠ {FLAG_AR[r] || r}</span>)}</div>}
                <div className="tm">🕒 {fmtDT(m.created_at)}</div>
              </div>
            ))}
      </div>
      {canReply &&
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="اكتب ردّك كإدارة لوزي…" style={{ flex: 1, minWidth: 0, height: 50 }} />
          <button className="btn" disabled={sending || !draft.trim()} onClick={send}
            style={{ width: 'auto', flexShrink: 0, padding: '0 22px' }}>{sending ? '…' : 'إرسال'}</button>
        </div>}
    </div>
  );
}

function ChatsAdmin({ me }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all'); // all | flagged
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [alerts, setAlerts] = useState(0);
  const load = async () => {
    // Flagged-first, then most recent activity — high-risk chats surface to top.
    const { data, error } = await SB.from('admin_conversations').select('*')
      .order('flagged', { ascending: false }).order('last_message_at', { ascending: false }).limit(500);
    setRows(error ? [] : (data || []));
    const { count } = await SB.from('chat_flag_alerts').select('id', { count: 'exact', head: true }).eq('resolved', false);
    setAlerts(count || 0);
  };
  useEffect(() => {
    load();
    // Realtime: list reorders/refreshes as conversations get new activity or flags.
    const ch = SB.channel('admin-convs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_flag_alerts' }, () => load())
      .subscribe();
    return () => { SB.removeChannel(ch); };
  }, []);
  if (open) return <ChatThread conv={open} me={me} onBack={() => { setOpen(null); load(); }} />;
  let shown = rows || [];
  if (filter === 'flagged') shown = shown.filter((r) => r.flagged);
  const query = q.trim().toLowerCase();
  if (query) shown = shown.filter((r) =>
    [(r.participant_a_name || ''), (r.participant_b_name || ''), (r.order_no || '')].join(' ').toLowerCase().includes(query));
  return (
    <div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.7 }}>
        مراقبة كاملة لكل المحادثات داخل التطبيق. النظام يميّز تلقائياً الرسائل المشبوهة (أرقام هواتف، روابط واتساب/تلغرام، بريد) كطبقة تنبيه إضافية.
        {alerts > 0 && <span style={{ color: 'var(--danger)', fontWeight: 800 }}>{' '}· تنبيهات غير معالجة: {alerts}</span>}
      </div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {[['all', 'كل المحادثات'], ['flagged', 'المُعلَّمة فقط']].map(([f, l]) =>
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{l}</button>)}
      </div>
      <label className="fld" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث باسم أحد الطرفين أو رقم الطلب…" />
      </label>
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !shown.length ? <div className="empty">لا توجد محادثات مطابقة.</div>
          : shown.map((r) => (
            <button className={`conv-row${r.flagged ? ' flag' : ''}`} key={r.id} onClick={() => setOpen(r)}>
              <div className="ci">
                <div className="conv-parties">
                  {(r.participant_a_name || 'طرف أول')} <span className="role-chip">{roleLabel(r.participant_a_role)}</span>
                  <span style={{ color: 'var(--muted)' }}>↔</span>
                  {(r.participant_b_name || 'طرف ثاني')} <span className="role-chip">{roleLabel(r.participant_b_role)}</span>
                  {r.flagged && <span className="flag-chip">⚠ مُعلَّمة{r.flagged_count ? ' (' + r.flagged_count + ')' : ''}</span>}
                </div>
                {r.last_message_preview && <div className="conv-prev">{r.last_message_preview}</div>}
                <div className="conv-meta">
                  {r.rfq_offer_id ? 'طلب مسبق · ' : r.order_no ? 'طلب #' + r.order_no + ' · ' : ''}🕒 {fmtDT(r.last_message_at)}
                </div>
              </div>
              <span style={{ color: 'var(--muted)', fontSize: 20 }}>‹</span>
            </button>
          ))}
      <div className="muted" style={{ textAlign: 'center', padding: '6px 0' }}>{rows ? shown.length + ' محادثة' : ''}</div>
    </div>
  );
}

function RfqAdmin({ me }) {
  const [rows, setRows] = useState(null);
  const [names, setNames] = useState({});
  const [flags, setFlags] = useState([]);
  const [subtab, setSubtab] = useState('overview');
  const [convs, setConvs] = useState(null);
  const [chatOpen, setChatOpen] = useState(null);
  const loadConvs = async () => {
    const { data } = await SB.from('admin_conversations').select('*').not('rfq_offer_id', 'is', null)
      .order('flagged', { ascending: false }).order('last_message_at', { ascending: false }).limit(300);
    setConvs(data || []);
  };
  const load = async () => {
    const { data } = await SB.from('rfq_requests')
      .select('*, rfq_request_items(*), rfq_offers(*, rfq_offer_items(*))')
      .order('created_at', { ascending: false }).limit(300);
    const reqs = data || [];
    setRows(reqs);
    const ids = new Set();
    reqs.forEach((r) => { if (r.buyer_id) ids.add(r.buyer_id); (r.rfq_offers || []).forEach((o) => o.seller_id && ids.add(o.seller_id)); });
    if (ids.size) {
      const { data: ps } = await SB.from('profiles').select('user_id,name,role').in('user_id', Array.from(ids));
      const m = {}; (ps || []).forEach((p) => { m[p.user_id] = p; }); setNames(m);
    }
    const { data: fl } = await SB.from('rfq_flag_alerts').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(100);
    setFlags(fl || []);
  };
  useEffect(() => {
    load();
    const ch = SB.channel('admin-rfq')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfq_requests' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfq_offers' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rfq_flag_alerts' }, () => load())
      .subscribe();
    return () => { SB.removeChannel(ch); };
  }, []);
  useEffect(() => {
    if (subtab !== 'chats') return;
    loadConvs();
    const ch = SB.channel('admin-rfq-convs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => loadConvs())
      .subscribe();
    return () => { SB.removeChannel(ch); };
  }, [subtab]);
  const nm = (id) => { const p = names[id]; return p ? (p.name || 'مستخدم') + (p.role ? ' · ' + p.role : '') : (id ? id.slice(0, 8) : '—'); };
  const stAr = { open: 'مفتوح', closed: 'مغلق', expired: 'منتهي', pending: 'قيد الانتظار', accepted: 'مقبول', declined: 'مرفوض' };
  const unit = (it) => { let u = it.unit === 'g' ? 'غرام' : it.unit === 'ton' ? 'طن' : it.unit === 'ratl' ? 'رطل' : it.unit === 'qadah' ? 'قدح' : it.unit === 'carton' ? 'كرتون' : it.unit === 'sack' ? 'شوال' : 'كغ'; if (it.unit_weight_kg) u += ' (' + it.unit_weight_kg + 'ك)'; return u; };
  const resolveFlag = async (id) => { await SB.from('rfq_flag_alerts').update({ resolved: true }).eq('id', id); setFlags((f) => f.filter((x) => x.id !== id)); };
  if (chatOpen) return <ChatThread conv={chatOpen} me={me} onBack={() => { setChatOpen(null); loadConvs(); }} />;
  return (
    <div>
      <div className="tabs" style={{ position: 'static', padding: '0 0 12px' }}>
        {[['overview', 'الطلبات والعروض'], ['chats', 'الدردشات']].map(([s, l]) =>
          <button key={s} className={subtab === s ? 'on' : ''} onClick={() => setSubtab(s)}>{l}</button>)}
      </div>
      {subtab === 'chats' ? (
        convs === null ? <div className="empty">جارٍ التحميل…</div>
          : !convs.length ? <div className="empty">لا توجد دردشات طلبات مسبقة بعد.</div>
            : convs.map((r) => (
              <button className={`conv-row${r.flagged ? ' flag' : ''}`} key={r.id} onClick={() => setChatOpen(r)}>
                <div className="ci">
                  <div className="conv-parties">
                    {(r.participant_a_name || 'طرف أول')} <span className="role-chip">{roleLabel(r.participant_a_role)}</span>
                    <span style={{ color: 'var(--muted)' }}>↔</span>
                    {(r.participant_b_name || 'طرف ثاني')} <span className="role-chip">{roleLabel(r.participant_b_role)}</span>
                    <span className="role-chip" style={{ background: 'var(--green-soft)', color: 'var(--green-deep)' }}>طلب مسبق</span>
                    {r.flagged && <span className="flag-chip">⚠ مُعلَّمة{r.flagged_count ? ' (' + r.flagged_count + ')' : ''}</span>}
                  </div>
                  {r.last_message_preview && <div className="conv-prev">{r.last_message_preview}</div>}
                  <div className="conv-meta">🕒 {fmtDT(r.last_message_at)}</div>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: 20 }}>‹</span>
              </button>
            ))
      ) : (<>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.7 }}>
        مراقبة كاملة لكل طلبات الأسعار والعروض.
        {flags.length > 0 && <span style={{ color: 'var(--danger)', fontWeight: 800 }}>{' '}· تنبيهات تسريب أرقام غير معالجة: {flags.length}</span>}
      </div>
      {flags.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="v-head"><strong>⚠ تنبيهات مشاركة أرقام</strong></div>
          {flags.map((f) => (
            <div className="kv" key={f.id}>
              <b>{f.source === 'offer_desc' ? 'وصف عرض' : 'وصف طلب'}:</b> {nm(f.user_id)} — <span style={{ color: 'var(--danger)' }}>{f.excerpt}</span>
              <button className="btn sm ghost" style={{ marginInlineStart: 8 }} onClick={() => resolveFlag(f.id)}>معالجة</button>
            </div>
          ))}
        </div>
      )}
      {rows === null ? <div className="empty">جارٍ التحميل…</div>
        : !rows.length ? <div className="empty">لا توجد طلبات مسبقة.</div>
          : rows.map((r) => (
            <div className="card" key={r.id}>
              <div className="v-head">
                <strong>{nm(r.buyer_id)}</strong>
                <span className={'tag ' + (r.status === 'open' ? 'approved' : r.status === 'expired' ? 'rejected' : '')}>{stAr[r.status] || r.status}</span>
              </div>
              <div className="kv"><b>المدينة:</b> {r.city} · <b>الأصناف:</b> {(r.rfq_request_items || []).map((it) => it.product_type + ' ' + (+it.quantity) + ' ' + unit(it)).join('، ')}</div>
              {(r.rfq_offers || []).length === 0
                ? <div className="muted" style={{ fontSize: 12 }}>لا توجد عروض بعد</div>
                : (r.rfq_offers || []).map((o) => (
                  <div className="kv" key={o.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}>
                    <b>عرض من {nm(o.seller_id)}</b>{' '}
                    <span className={'tag ' + (o.status === 'accepted' ? 'approved' : o.status === 'declined' ? 'rejected' : 'pending')}>{stAr[o.status] || o.status}</span>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
                      {(o.rfq_offer_items || []).map((oi) => {
                        const ri = (r.rfq_request_items || []).find((x) => x.id === oi.request_item_id) || {};
                        return (ri.product_type || 'صنف') + ': ' + (+oi.price) + ' ريال × ' + (+oi.available_quantity);
                      }).join(' · ')}
                    </div>
                  </div>
                ))}
              <div className="kv ts"><b>التاريخ:</b> 🕒 {fmtDT(r.created_at)}</div>
            </div>
          ))}
      </>)}
    </div>
  );
}

function Admin() {
  const [user, setUser] = useState(undefined); // undefined=loading, null=logged out
  const [tab, setTab] = useState('verif');
  useEffect(() => {
    SB.auth.getSession().then(async ({ data }) => {
      const u = data && data.session && data.session.user;
      if (!u) return setUser(null);
      const { data: a } = await SB.from('admins').select('user_id').eq('user_id', u.id).maybeSingle();
      setUser(a ? u : null);
    });
  }, []);
  if (user === undefined) return <div className="empty">جارٍ التحميل…</div>;
  if (!user) return <Login onIn={setUser} />;
  const TABS = [['verif', 'التحقق من البائعين'], ['users', 'المستخدمون'], ['orders', 'الطلبات'], ['chats', 'الدردشات'], ['rfq', 'الطلبات المسبقة'], ['levels', 'مستويات البائعين'], ['trust', 'شارات الثقة'], ['lozisave', 'خانة التوفير'], ['vip', 'سوق VIP'], ['shahti', 'شارة المرارة'], ['reports', 'البلاغات'], ['reviews', 'التقييمات'], ['numbers', 'تفعيل الأرقام'], ['del', 'طلبات الحذف'], ['settings', 'الإعدادات']];
  return (
    <div>
      <div className="topbar"><h1>لوزي · لوحة الإدارة</h1><button onClick={() => { SB.auth.signOut(); setUser(null); }}>خروج</button></div>
      <div className="tabs">{TABS.map(([id, label]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      <div className="wrap">
        {tab === 'verif' && <Verifications />}
        {tab === 'users' && <Users />}
        {tab === 'orders' && <OrdersAdmin />}
        {tab === 'chats' && <ChatsAdmin me={user} />}
        {tab === 'rfq' && <RfqAdmin me={user} />}
        {tab === 'levels' && <SellerLevels />}
        {tab === 'trust' && <TrustBadges />}
        {tab === 'lozisave' && <SavingsAdmin />}
        {tab === 'vip' && <VipAdmin />}
        {tab === 'shahti' && <ShahtiReqs />}
        {tab === 'reports' && <Reports />}
        {tab === 'reviews' && <ReviewsMod />}
        {tab === 'numbers' && <Numbers />}
        {tab === 'del' && <Deletions />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Admin />);
