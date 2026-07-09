
(function () {
  "use strict";
  var SELLER_ROLES = ["farmer", "retail", "wholesale"];
  var SEG_AR = { retail: "تجزئة", wholesale: "جملة" };
  var AR = function (s) { return String(s).replace(/[0-9]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩"[d]; }); };
  var pct = function (rate, seg) { return (Number(rate) * 100).toFixed(seg === "wholesale" ? 1 : 2) + "%"; };
  var grp = function (n) { return (Number(n) || 0).toLocaleString("en-US"); };
  var money2 = function (n) { return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: (Number(n) % 1 !== 0 ? 2 : 0), maximumFractionDigits: 2 }); };
  var tierOf = function (tiers, seg, cum) {
    var rows = (tiers || []).filter(function (t) { return t.segment === seg; }).sort(function (a, b) { return a.level - b.level; });
    var c = Number(cum) || 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (c >= Number(r.min_sales) && (r.max_sales == null || c <= Number(r.max_sales))) return r;
    }
    return rows[rows.length - 1] || null;
  };
  var nextTier = function (tiers, seg, level) {
    return (tiers || []).filter(function (t) { return t.segment === seg; }).find(function (t) { return t.level === level + 1; }) || null;
  };
  // Progressive/marginal commission across cumulative-sales tier bands — mirrors
  // the DB commission_bracket(). The order pushes the seller's counter from
  // `before` to `before + goods`; each slice of that span is charged at the rate
  // of the band it lands in (band upper bound = next tier's min_sales).
  var bracketCommission = function (tiers, seg, before, goods) {
    var rows = (tiers || []).filter(function (t) { return t.segment === seg; }).sort(function (a, b) { return a.level - b.level; });
    var start = Math.max(0, Number(before) || 0);
    var end = start + Math.max(0, Number(goods) || 0);
    var comm = 0;
    for (var i = 0; i < rows.length; i++) {
      var lo = Number(rows[i].min_sales);
      var hi = i + 1 < rows.length ? Number(rows[i + 1].min_sales) : Infinity;
      var from = Math.max(start, lo), to = Math.min(end, hi);
      if (to > from) comm += (to - from) * Number(rows[i].rate);
    }
    return Math.round(comm * 100) / 100;
  };

  var SB = null, STATE = { uid: null, profile: null, tiers: [], orders: null, calcSeg: "retail", calcAmt: 4500, tab: "level", loaded: false };

  // ---------- styling ----------
  function injectCss() {
    if (document.getElementById("lzc-css")) return;
    if (!document.querySelector('link[href*="Tajawal"]')) {
      var l = document.createElement("link"); l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap";
      document.head.appendChild(l);
    }
    var css = document.createElement("style"); css.id = "lzc-css";
    css.textContent = [
      ".lzc{--g:#2F5E3E;--gd:#234a30;--gs:#eef5f0;--gl:#cfe2d6;--go:#C08A43;--gos:#fbf3e4;--gol:#ecd9b8;--ink:#23302a;--mut:#6c7d73;--red:#b4452f;font-family:'Tajawal',sans-serif;}",
      ".lzc-tabs{display:flex;gap:6px;padding:12px 14px 0;flex-wrap:wrap;}",
      ".lzc-tabs button{flex:1;min-width:74px;border:1px solid #e3e9e3;background:#f7f9f7;color:#4a5a50;font-family:inherit;font-size:12.5px;font-weight:800;padding:9px 6px;border-radius:10px;cursor:pointer;}",
      ".lzc-tabs button.on{background:#2F5E3E;color:#fff;border-color:#2F5E3E;}",
      ".lzc-bd{padding:14px 16px 22px;}",
      ".lzc-track{border:1px solid #eef1ee;border-radius:16px;padding:15px 16px;margin-bottom:12px;}",
      ".lzc-th{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}",
      ".lzc-th .nm{font-weight:900;font-size:15px;display:flex;align-items:center;gap:8px;}",
      ".lzc-dot{width:11px;height:11px;border-radius:50%;}",
      ".lzc-r .lzc-dot{background:#2F5E3E;}.lzc-w .lzc-dot{background:#C08A43;}",
      ".lzc-bdg{font-size:12.5px;font-weight:900;padding:5px 11px;border-radius:20px;}",
      ".lzc-r .lzc-bdg{background:#eef5f0;color:#234a30;}.lzc-w .lzc-bdg{background:#fbf3e4;color:#9a6a25;}",
      ".lzc-rate{display:flex;align-items:baseline;gap:7px;margin-bottom:11px;}",
      ".lzc-rate b{font-size:25px;font-weight:900;}.lzc-rate span{font-size:12px;color:var(--mut);font-weight:700;}",
      ".lzc-bar{height:11px;border-radius:30px;background:#edf1ed;overflow:hidden;}",
      ".lzc-bar i{display:block;height:100%;border-radius:30px;}",
      ".lzc-r .lzc-bar i{background:linear-gradient(90deg,#3f7a52,#2F5E3E);}.lzc-w .lzc-bar i{background:linear-gradient(90deg,#d6a866,#C08A43);}",
      ".lzc-meta{display:flex;justify-content:space-between;margin-top:9px;font-size:12.5px;font-weight:800;}",
      ".lzc-r .lzc-meta .nx{color:#234a30;}.lzc-w .lzc-meta .nx{color:#9a6a25;}",
      ".lzc-meta .tt{color:var(--mut);direction:ltr;}",
      ".lzc-max{display:flex;align-items:center;gap:9px;background:#fbf3e4;border:1px solid #ecd9b8;border-radius:11px;padding:11px 13px;font-size:13px;font-weight:900;color:#9a6a25;}",
      ".lzc-foot{background:#eef5f0;border:1px solid #cfe2d6;border-radius:12px;padding:11px;text-align:center;font-size:12.5px;font-weight:700;color:#234a30;}",
      ".lzc-seg{display:flex;background:#f0f3f0;border-radius:12px;padding:5px;gap:5px;margin-bottom:16px;}",
      ".lzc-seg button{flex:1;border:none;background:transparent;font-family:inherit;font-size:14px;font-weight:800;color:var(--mut);padding:9px;border-radius:9px;cursor:pointer;}",
      ".lzc-seg button.on{background:#fff;color:#234a30;box-shadow:0 2px 6px rgba(35,74,48,.1);}",
      ".lzc-fld{display:block;font-size:13px;font-weight:800;color:var(--mut);margin-bottom:7px;}",
      ".lzc-inp{position:relative;margin-bottom:14px;}",
      ".lzc-inp input{width:100%;font-family:inherit;font-size:23px;font-weight:900;color:var(--ink);padding:14px 16px 14px 52px;border:2px solid #e3e9e3;border-radius:13px;outline:none;direction:ltr;text-align:left;}",
      ".lzc-inp .cur{position:absolute;left:16px;top:50%;transform:translateY(-50%);font-size:14px;font-weight:800;color:var(--mut);}",
      ".lzc-tag{display:flex;align-items:center;justify-content:space-between;background:#eef5f0;border:1px solid #cfe2d6;border-radius:12px;padding:12px 15px;margin-bottom:13px;font-weight:900;color:#234a30;}",
      ".lzc-tag.w{background:#fbf3e4;border-color:#ecd9b8;color:#9a6a25;}",
      ".lzc-res{border:1px solid #eef1ee;border-radius:14px;overflow:hidden;}",
      ".lzc-row{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;font-size:14.5px;}",
      ".lzc-row .k{color:var(--mut);font-weight:700;}.lzc-row .v{font-weight:900;direction:ltr;}",
      ".lzc-row.c{background:#fbf3e4;border-block:1px solid #ecd9b8;}.lzc-row.c .v{color:var(--red);}",
      ".lzc-row.n{background:#2F5E3E;color:#fff;}.lzc-row.n .k{color:#fff;font-weight:900;}.lzc-row.n .v{font-size:19px;}",
      ".lzc-save{margin-top:13px;background:linear-gradient(135deg,#fbf3e4,#fff);border:1px dashed #C08A43;border-radius:13px;padding:13px 15px;font-size:13px;font-weight:700;color:#7a5a22;line-height:1.6;}",
      ".lzc-save b{color:#9a6a25;font-weight:900;}",
      ".lzc-tbl{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:16px;border:1px solid #cfe2d6;border-radius:12px;overflow:hidden;}",
      ".lzc-tbl th{background:#2F5E3E;color:#fff;font-weight:800;padding:10px 6px;}",
      ".lzc-tbl td{padding:10px 6px;text-align:center;border-top:1px solid #e9efe9;font-weight:700;}",
      ".lzc-tbl tr:nth-child(even){background:#eef5f0;}",
      ".lzc-tbl .rng{direction:ltr;color:#2a4cc0;font-weight:800;}",
      ".lzc-secttl{font-size:14px;font-weight:900;color:#234a30;margin:4px 0 8px;}",
      ".lzc-ord{border:1px solid #eef1ee;border-radius:13px;padding:12px 14px;margin-bottom:10px;}",
      ".lzc-ord .top{display:flex;justify-content:space-between;align-items:center;font-weight:900;}",
      ".lzc-ord .amt{color:var(--red);direction:ltr;}",
      ".lzc-ord .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}",
      ".lzc-ord .chips span{font-size:11px;font-weight:800;background:#fbf3e4;border:1px solid #ecd9b8;color:#9a6a25;padding:3px 9px;border-radius:20px;}",
      ".lzc-ord .rev{margin-top:7px;font-size:12px;font-weight:800;color:var(--red);}",
      ".lzc-empty{text-align:center;color:var(--mut);font-weight:700;padding:26px 10px;}",
      // ---- relocated: compact indicator in the RFQ (طلبات الأسعار) header ----
      ".rfq-head-main{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;}",
      ".lzc-rfq-slot{display:flex;min-width:0;max-width:100%;}",
      ".lzc-rfq-slot:empty{display:none;}",
      ".lzc-compact{display:inline-flex;align-items:center;gap:6px;max-width:100%;background:linear-gradient(135deg,#eef5f0,#fbf3e4);border:1px solid #dbe7de;border-radius:20px;padding:3px 10px 3px 6px;line-height:1.2;font-family:'Tajawal',sans-serif;}",
      ".lzc-mini-badge{display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#2F5E3E,#234a30);color:#fff;font-weight:800;font-size:11px;padding:3px 9px;border-radius:12px;white-space:nowrap;box-shadow:0 1px 3px rgba(35,74,48,.25);}",
      // tappable variant of the mini badge (RFQ header only) — opens the حسابي level tab
      ".lzc-mini-badge-btn{position:relative;border:0;font-family:'Tajawal',sans-serif;cursor:pointer;padding:4px 9px;-webkit-tap-highlight-color:transparent;transition:transform .08s ease,filter .15s ease,box-shadow .15s ease;}",
      ".lzc-mini-badge-btn::after{content:'';position:absolute;inset:-9px -7px;}",  // enlarge touch target without growing the badge
      ".lzc-mini-badge-btn:hover{filter:brightness(1.07);}",
      ".lzc-mini-badge-btn:active{transform:scale(.95);box-shadow:0 1px 2px rgba(35,74,48,.35);}",
      ".lzc-mini-badge-btn:focus-visible{outline:2px solid #C08A43;outline-offset:2px;}",
      ".lzc-mini-chev{flex:none;opacity:.85;margin-inline-start:1px;}",
      ".lzc-compact .lzc-cd{font-size:11px;font-weight:800;color:#234a30;font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".lzc-compact .lzc-cd.open{color:#6c7d73;font-weight:700;}",
      ".lzc-compact .lzc-cd.ended{color:#b4452f;white-space:normal;}",
      ".lzc-cd-perma{font-size:11px;font-weight:800;color:#9a6a25;white-space:nowrap;}",
      // ---- relocated: full level panel as a حسابي (account) tab ----
      ".lzc-panel-slot{display:block;}",
      ".lzc-panel{font-family:'Tajawal',sans-serif;}",
      ".lzc-l5card{border:1px solid #ecd9b8;background:linear-gradient(135deg,#fbf3e4,#f4faf5);border-radius:16px;padding:14px 15px;margin-bottom:14px;}",
      ".lzc-l5card.ok{border-color:#cfe2d6;background:linear-gradient(135deg,#eef5f0,#f4faf5);}",
      ".lzc-l5top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;}",
      ".lzc-l5perma{font-size:12px;font-weight:900;color:#9a6a25;}",
      ".lzc-l5card .lzc-cd{font-size:12.5px;font-weight:800;color:#234a30;font-variant-numeric:tabular-nums;}",
      ".lzc-l5card .lzc-cd.open{color:#6c7d73;font-weight:700;}",
      ".lzc-l5card .lzc-cd.ended{color:#b4452f;}",
      ".lzc-panel .lzc-p5b{height:8px;border-radius:30px;background:#e7efe9;overflow:hidden;margin-bottom:7px;}",
      ".lzc-panel .lzc-p5b i{display:block;height:100%;border-radius:30px;background:linear-gradient(90deg,#e0b574,#C08A43);transition:width .3s ease;}",
      ".lzc-panel .lzc-p5t{font-size:12.5px;font-weight:800;color:#234a30;line-height:1.4;}",
      ".lzc-panel .lzc-p5t.ok{color:#9a6a25;font-weight:900;}",
      ".lzc-panel .lzc-tabs{padding:0 0 12px;}",
      ".lzc-panel .lzc-bd{padding:0;}"
    ].join("\n");
    document.head.appendChild(css);
  }

  // ---------- data ----------
  function loadTiers() {
    if (STATE.tiers.length) return Promise.resolve(STATE.tiers);
    return SB.from("commission_tiers").select("*").then(function (r) { STATE.tiers = r.data || []; return STATE.tiers; });
  }
  function loadProfile() {
    return SB.auth.getUser().then(function (r) {
      var u = r && r.data && r.data.user;
      if (!u) { STATE.uid = null; STATE.profile = null; return null; }
      STATE.uid = u.id;
      return SB.from("profiles").select("name,role,retail_cumulative_sales,wholesale_cumulative_sales").eq("user_id", u.id).maybeSingle()
        .then(function (p) { STATE.profile = p.data || null; return STATE.profile; });
    });
  }
  function isSeller(p) {
    if (!p || !p.role) return false;
    var role = p.role;
    return SELLER_ROLES.some(function (x) { return role === x || role.indexOf(x) === 0; });
  }
  function primarySeg(p) {
    if (!p) return "retail";
    return Number(p.wholesale_cumulative_sales) > Number(p.retail_cumulative_sales) ? "wholesale" : "retail";
  }

  // ---------- level-5 preorder-access qualification ----------
  // Permanent RFQ/preorder access is granted on reaching Level 5 in EITHER
  // track — retail (تجزئة) OR wholesale (جملة). Thresholds are read from config
  // (commission_tiers), never hardcoded. Broadens public.rfq_can_browse(), which
  // checks retail only, to accept either segment.
  function level5Min(seg) {
    var t = (STATE.tiers || []).find(function (x) { return x.segment === seg && Number(x.level) === 5; });
    return t ? Number(t.min_sales) : (seg === "wholesale" ? 5000000 : 500000);
  }
  function l5Status(p) {
    var role = String((p && p.role) || "");
    var roleWs = /wholesale/i.test(role);           // role sells wholesale by default
    var rc = Number(p && p.retail_cumulative_sales) || 0;
    var wc = Number(p && p.wholesale_cumulative_sales) || 0;
    var rMin = level5Min("retail"), wMin = level5Min("wholesale");
    // A track is relevant if the role sells there or the seller has sales there.
    var cand = [];
    if (!roleWs || rc > 0) cand.push({ label: SEG_AR.retail, cum: rc, min: rMin });
    if (roleWs || wc > 0) cand.push({ label: SEG_AR.wholesale, cum: wc, min: wMin });
    if (!cand.length) cand.push({ label: SEG_AR.retail, cum: rc, min: rMin });
    cand.forEach(function (c) { c.pct = c.min > 0 ? c.cum / c.min : 1; });
    // Show progress on the track the seller is CLOSEST to qualifying on.
    var disp = cand.reduce(function (a, b) { return b.pct > a.pct ? b : a; });
    return {
      qualified: rc >= rMin || wc >= wMin,          // L5 in EITHER track
      label: disp.label,
      remaining: Math.max(0, disp.min - disp.cum),
      pct: Math.max(0, Math.min(100, disp.pct * 100))
    };
  }

  // ---------- countdown (single shared interval) ----------
  // Access window = launch_date + 6 months. The launch date lives in the admin
  // setting `rfq_launch_date` (public-readable). Empty = always open. ONE
  // setInterval drives every mounted countdown (the compact RFQ-header indicator
  // and the full حسابي panel share it — they are never on screen at once, but the
  // single interval writes to all `.lzc-cd` nodes regardless).
  // state: loading|open|pre|live|ended. Two counting phases share the same D/H/M/S
  // render: `pre` counts down to the launch date (preorder opens), then rolls into
  // `live` which counts down to launch + 6 months (window closes). `windowEnd` is
  // stashed so the pre→live handoff can retarget without re-reading the setting.
  var CD = { timer: null, end: 0, windowEnd: 0, state: "loading" };
  function cdCounting() { return CD.state === "live" || CD.state === "pre"; }
  function loadLaunch() {
    if (typeof STATE.launch === "string") return Promise.resolve(STATE.launch);
    return SB.from("settings").select("value").eq("key", "rfq_launch_date").maybeSingle()
      .then(function (r) {
        var v = r && r.data ? r.data.value : "";
        STATE.launch = (v == null ? "" : String(v)).replace(/"/g, "").trim().slice(0, 10);
        return STATE.launch;
      }, function () { STATE.launch = ""; return ""; });
  }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function cdText() {
    if (CD.state === "open") return { cls: "lzc-cd open", txt: "مفتوح دائماً" };
    if (CD.state === "ended") return { cls: "lzc-cd ended", txt: "انتهت مهلة الوصول · مقتصر على المستوى ٥" };
    var ms = CD.end - Date.now();
    // Phase A finished (launch reached) → roll straight into Phase B toward window end.
    if (ms <= 0 && CD.state === "pre") { CD.state = "live"; CD.end = CD.windowEnd; ms = CD.end - Date.now(); }
    if (ms <= 0) { CD.state = "ended"; return { cls: "lzc-cd ended", txt: "انتهت مهلة الوصول · مقتصر على المستوى ٥" }; }
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), sec = s % 60;
    // Western digits, zero-padded HH/MM/SS, "يوم" hidden when days = 0.
    var time = (d > 0 ? d + " يوم " : "") + pad2(h) + " ساعة " + pad2(m) + " دقيقة " + pad2(sec) + " ثانية";
    // Phase A prefixes "يبدأ خلال" (full label for the panel); the compact header,
    // which is nowrap-tight, drops the prefix and shows just the D/H/M/S (`compact`).
    if (CD.state === "pre") return { cls: "lzc-cd live", txt: "يبدأ خلال " + time, compact: time };
    return { cls: "lzc-cd live", txt: time };
  }
  function cdApply() {
    var els = document.querySelectorAll(".lzc-cd");
    if (!els.length) return false;
    var info = cdText();
    for (var i = 0; i < els.length; i++) {
      els[i].className = info.cls;
      els[i].textContent = (info.compact && els[i].getAttribute("data-lzc-mini")) ? info.compact : info.txt;
    }
    return true;
  }
  function cdTick() {
    if (!cdApply()) { if (CD.timer) { clearInterval(CD.timer); CD.timer = null; } return; }  // nothing mounted → pause
    if (!cdCounting() && CD.timer) { clearInterval(CD.timer); CD.timer = null; }              // reached open/ended → stop
  }
  // Resolve the access window once, paint every mounted countdown, and keep the
  // single 1s interval alive only while it is genuinely counting down.
  function ensureCountdown() {
    loadLaunch().then(function (launch) {
      if (!launch) { CD.state = "open"; CD.end = 0; }
      else {
        var base = new Date(launch + "T00:00:00");
        if (isNaN(base.getTime())) { CD.state = "open"; CD.end = 0; }
        else {
          // launch_date + 6 calendar months (mirrors `+ interval '6 months'`).
          var windowEnd = new Date(base.getFullYear(), base.getMonth() + 6, base.getDate(),
            base.getHours(), base.getMinutes(), base.getSeconds()).getTime();
          var launchMs = base.getTime(), now = Date.now();
          CD.windowEnd = windowEnd;
          // Two-phase anchor: before launch count to launch (A); during the window
          // count to its end (B); after the window it is closed (C). Window math is
          // unchanged — only which target we count to depends on the phase.
          if (now < launchMs) { CD.state = "pre"; CD.end = launchMs; }
          else if (now < windowEnd) { CD.state = "live"; CD.end = windowEnd; }
          else { CD.state = "ended"; CD.end = windowEnd; }
        }
      }
      if (!cdApply()) return;
      if (cdCounting() && !CD.timer) CD.timer = setInterval(cdTick, 1000);
    });
  }

  // ---------- mounted indicators (no floating chip) ----------
  // The seller badge no longer floats. Two React-owned anchors host it instead:
  //   .lzc-rfq-slot   → compact mini-badge + countdown in the طلبات الأسعار header
  //   .lzc-panel-slot → the full level detail as a حسابي (account) tab
  // A MutationObserver fills these anchors whenever React (re)mounts them; the
  // anchors carry no React children, so injected content survives re-renders.
  function ensureLoaded(cb) {
    if (STATE.loaded) { cb(); return; }
    Promise.all([loadProfile(), loadTiers()]).then(function () { STATE.loaded = true; cb(); });
  }
  function levelInfo() {
    var p = STATE.profile || {};
    var seg = primarySeg(p);
    var cum = Number(p[seg + "_cumulative_sales"]) || 0;
    var tr = tierOf(STATE.tiers, seg, cum);
    return { seg: seg, cum: cum, level: tr ? tr.level : 1, l5: l5Status(p) };
  }
  // Reuse the app's own navigation: App exposes its `go` router as window.LOZI_GO.
  // Tapping the mini badge opens the "sellerlevel" screen — the full level tab in حسابي.
  function gotoLevel() { if (typeof window.LOZI_GO === "function") window.LOZI_GO("sellerlevel"); }
  function fillCompact(slot) {
    slot.setAttribute("data-lzc-filled", "1");
    if (!STATE.profile || !isSeller(STATE.profile)) { slot.innerHTML = ""; return; }
    var info = levelInfo();
    var tail = info.l5.qualified
      ? '<span class="lzc-cd-perma">وصول دائم</span>'
      : '<span class="lzc-cd" data-lzc-mini="1"></span>';
    // Only the badge is tappable (a ticking countdown is a poor tap affordance); the
    // chevron cues the navigation, and the enlarged ::after hit area keeps the target usable.
    var chev = '<svg class="lzc-mini-chev" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    slot.innerHTML = '<span class="lzc lzc-compact"><button type="button" class="lzc-mini-badge lzc-mini-badge-btn" aria-label="عرض تفاصيل المستوى">مستوى ' + AR(info.level) + chev + "</button>" + tail + "</span>";
    var btn = slot.querySelector(".lzc-mini-badge-btn");
    if (btn) btn.addEventListener("click", gotoLevel);
    if (!info.l5.qualified) ensureCountdown();        // qualified => permanent access, no timer
  }
  // Full Level-5 badge (reused verbatim from the old chip): progress bar toward
  // L5, remaining amount on the closest track, qualified/expired states.
  function l5BlockHtml(info) {
    var badge = '<span class="lzc-mini-badge">مستوى ' + AR(info.level) + "</span>";
    if (info.l5.qualified) {
      return '<div class="lzc-l5card ok"><div class="lzc-l5top">' + badge + '<span class="lzc-l5perma">وصول دائم</span></div>' +
        '<div class="lzc-p5b"><i style="width:100%"></i></div>' +
        '<div class="lzc-p5t ok">وصلت للمستوى ٥ · وصول دائم</div></div>';
    }
    return '<div class="lzc-l5card"><div class="lzc-l5top">' + badge + '<span class="lzc-cd"></span></div>' +
      '<div class="lzc-p5b"><i style="width:' + info.l5.pct.toFixed(1) + '%"></i></div>' +
      '<div class="lzc-p5t">متبقٍ ' + grp(info.l5.remaining) + " للوصول للمستوى ٥ (" + info.l5.label + ")</div></div>";
  }
  function fillPanel(slot) {
    slot.setAttribute("data-lzc-filled", "1");
    if (!STATE.profile || !isSeller(STATE.profile)) { slot.innerHTML = '<div class="lzc lzc-empty">هذا القسم متاح للبائعين فقط.</div>'; return; }
    STATE.calcSeg = primarySeg(STATE.profile);
    var info = levelInfo();
    slot.innerHTML = '<div class="lzc lzc-panel">' + l5BlockHtml(info) + '<div class="lzc-tabs"></div><div class="lzc-bd"></div></div>';
    var panel = slot.querySelector(".lzc-panel");
    buildTabs(panel); renderTab(panel);              // reuse the full commission-center tabs/logic
    if (!info.l5.qualified) ensureCountdown();
  }
  function injectMounts() {
    var pending = document.querySelector(".lzc-rfq-slot:not([data-lzc-filled]),.lzc-panel-slot:not([data-lzc-filled])");
    if (!pending) return;                            // nothing new to fill (cheap fast-path)
    ensureLoaded(function () {
      document.querySelectorAll(".lzc-rfq-slot:not([data-lzc-filled])").forEach(fillCompact);
      document.querySelectorAll(".lzc-panel-slot:not([data-lzc-filled])").forEach(fillPanel);
    });
  }
  // Re-fill already-mounted anchors with fresh data (e.g. after auth change).
  function refresh() {
    document.querySelectorAll(".lzc-rfq-slot,.lzc-panel-slot").forEach(function (sl) { sl.removeAttribute("data-lzc-filled"); });
    injectMounts();
  }

  // ---------- commission-center tabs (rendered inline inside the account panel) ----------
  function buildTabs(ov) {
    var tabs = [["level", "مستواي"], ["calc", "احسب"], ["system", "النظام"], ["mine", "عمولاتي"]];
    var box = ov.querySelector(".lzc-tabs"); box.innerHTML = "";
    tabs.forEach(function (t) {
      var b = document.createElement("button");
      b.textContent = t[1]; if (STATE.tab === t[0]) b.className = "on";
      b.addEventListener("click", function () { STATE.tab = t[0]; buildTabs(ov); renderTab(ov); });
      box.appendChild(b);
    });
  }
  function renderTab(ov) {
    var bd = ov.querySelector(".lzc-bd");
    if (STATE.tab === "level") bd.innerHTML = viewLevel();
    else if (STATE.tab === "calc") { bd.innerHTML = viewCalc(); wireCalc(ov); }
    else if (STATE.tab === "system") bd.innerHTML = viewSystem();
    else { bd.innerHTML = '<div class="lzc-empty">جارٍ التحميل…</div>'; loadMine(ov); }
  }

  function trackHtml(seg, cum) {
    var cls = seg === "wholesale" ? "lzc-w" : "lzc-r";
    var tr = tierOf(STATE.tiers, seg, cum);
    if (!tr) return "";
    var nx = nextTier(STATE.tiers, seg, tr.level);
    var head = '<div class="lzc-track ' + cls + '"><div class="lzc-th"><div class="nm"><span class="lzc-dot"></span>' + SEG_AR[seg] +
      '</div><span class="lzc-bdg">مستوى ' + AR(tr.level) + " من ٧</span></div>" +
      '<div class="lzc-rate"><b>' + pct(tr.rate, seg) + "</b><span>عمولتك الحالية</span></div>";
    if (nx) {
      var prog = Math.max(0, Math.min(100, ((cum - tr.min_sales) / (nx.min_sales - tr.min_sales)) * 100));
      var remaining = Math.max(0, nx.min_sales - cum);
      head += '<div class="lzc-bar"><i style="width:' + prog.toFixed(0) + '%"></i></div>' +
        '<div class="lzc-meta"><span class="nx">متبقٍ ' + grp(remaining) + " ر للمستوى " + AR(nx.level) + " · عمولة " + pct(nx.rate, seg) + "</span>" +
        '<span class="tt">' + grp(cum) + " / " + grp(nx.min_sales) + "</span></div>";
    } else {
      head += '<div class="lzc-max">🏆 وصلت لأعلى مستوى — تتمتع بأقل عمولة في المنصة</div>';
    }
    return head + "</div>";
  }
  function viewLevel() {
    var p = STATE.profile || {};
    return trackHtml("retail", Number(p.retail_cumulative_sales) || 0) +
      trackHtml("wholesale", Number(p.wholesale_cumulative_sales) || 0) +
      '<div class="lzc-foot">كل ما بعت أكثر، قلّت عمولتك — والمسارَان مستقلان تماماً</div>';
  }

  function viewCalc() {
    var seg = STATE.calcSeg;
    var p = STATE.profile || {};
    var cum = Number(p[seg + "_cumulative_sales"]) || 0;
    var tr = tierOf(STATE.tiers, seg, cum);
    var amt = Number(STATE.calcAmt) || 0;
    // Progressive brackets over [cum, cum + amt]; effective rate = comm / amt.
    var comm = bracketCommission(STATE.tiers, seg, cum, amt);
    var net = Math.round((amt - comm) * 100) / 100;
    var effRate = amt > 0 ? comm / amt : 0;
    var nx = tr ? nextTier(STATE.tiers, seg, tr.level) : null;
    var save = nx ?
      '<div class="lzc-save">لو بدأت هذا الطلب من المستوى التالي لدفعت على نفس المبلغ عمولة أقل بـ <b>' +
      money2(Math.max(0, Math.round((comm - bracketCommission(STATE.tiers, seg, nx.min_sales, amt)) * 100) / 100)) + " ر</b>.</div>"
      : '<div class="lzc-save"><b>أنت في أعلى مستوى</b> — تتمتع بأقل عمولة ممكنة.</div>';
    return '<div class="lzc-seg"><button data-seg="retail" class="' + (seg === "retail" ? "on" : "") + '">تجزئة</button>' +
      '<button data-seg="wholesale" class="' + (seg === "wholesale" ? "on" : "") + '">جملة</button></div>' +
      '<label class="lzc-fld">قيمة البضاعة (بدون رسوم التوصيل)</label>' +
      '<div class="lzc-inp"><span class="cur">ريال</span><input id="lzc-amt" inputmode="numeric" value="' + grp(amt) + '"></div>' +
      '<div class="lzc-tag ' + (seg === "wholesale" ? "w" : "") + '"><span>مستواك الحالي: ' + (tr ? "مستوى " + AR(tr.level) + " من ٧" : "—") +
      "</span><span>النسبة الفعلية " + (amt > 0 ? pct(effRate, seg) : "—") + "</span></div>" +
      '<div class="lzc-res"><div class="lzc-row"><span class="k">قيمة البضاعة</span><span class="v">' + money2(amt) + ' ر</span></div>' +
      '<div class="lzc-row c"><span class="k">عمولة لوزي</span><span class="v">− ' + money2(comm) + ' ر</span></div>' +
      '<div class="lzc-row n"><span class="k">صافي لك</span><span class="v">' + money2(net) + " ر</span></div></div>" + save +
      '<div class="lzc-save" style="border-style:solid;border-color:#ecd9b8;background:#f7f9f7;color:#6c7d73;margin-top:10px;">العمولة تُحسب تصاعدياً على شرائح مبيعاتك التراكمية — كل شريحة بنسبتها، تماماً كشرائح الضريبة. لذلك النسبة الفعلية قد تقل عن نسبة مستواك الحالي.</div>';
  }
  function wireCalc(ov) {
    var inp = ov.querySelector("#lzc-amt");
    if (inp) inp.addEventListener("input", function () {
      var raw = inp.value.replace(/[^0-9]/g, "");
      STATE.calcAmt = raw === "" ? 0 : Number(raw);
      var bd = ov.querySelector(".lzc-bd"); bd.innerHTML = viewCalc(); wireCalc(ov);
      var ni = ov.querySelector("#lzc-amt"); if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
    });
    ov.querySelectorAll(".lzc-seg button").forEach(function (b) {
      b.addEventListener("click", function () { STATE.calcSeg = b.getAttribute("data-seg"); var bd = ov.querySelector(".lzc-bd"); bd.innerHTML = viewCalc(); wireCalc(ov); });
    });
  }

  function segTable(seg) {
    var rows = (STATE.tiers || []).filter(function (t) { return t.segment === seg; }).sort(function (a, b) { return a.level - b.level; });
    var body = rows.map(function (r) {
      var rng = r.max_sales == null ? grp(r.min_sales) + " فأكثر" : grp(r.min_sales) + " - " + grp(r.max_sales);
      return "<tr><td>مستوى " + AR(r.level) + "</td><td>" + pct(r.rate, seg) + '</td><td class="rng">' + rng + "</td></tr>";
    }).join("");
    return '<div class="lzc-secttl">' + (seg === "retail" ? "مستويات التجزئة" : "مستويات الجملة") + "</div>" +
      '<table class="lzc-tbl"><thead><tr><th>المستوى</th><th>العمولة</th><th>نطاق المبيعات (ر)</th></tr></thead><tbody>' + body + "</tbody></table>";
  }
  function viewSystem() {
    return '<div class="lzc-save" style="border-style:solid;border-color:#cfe2d6;background:#eef5f0;color:#234a30;margin-bottom:14px;">' +
      "كل ما زادت مبيعاتك التراكمية انخفضت عمولتك. لكل بائع عدّادان مستقلان تماماً: تجزئة وجملة. النسبة تُحسب من العدّاد قبل إضافة العملية، ولا يُحتسب إلا الطلبات المكتملة.</div>" +
      segTable("retail") + segTable("wholesale");
  }

  function loadMine(ov) {
    if (!STATE.uid) { ov.querySelector(".lzc-bd").innerHTML = '<div class="lzc-empty">سجّل الدخول لعرض عمولاتك.</div>'; return; }
    SB.from("orders").select("order_no,segment,commission_rate_applied,commission_amount,commission_state,goods_subtotal,reversed_amount,created_at")
      .eq("seller_vendor_id", STATE.uid).not("commission_amount", "is", null)
      .order("created_at", { ascending: false }).then(function (r) {
        if (STATE.tab !== "mine") return;
        var bd = ov.querySelector(".lzc-bd");
        var rows = r.data || [];
        if (!rows.length) { bd.innerHTML = '<div class="lzc-empty">لا توجد عمولات محتسبة بعد.</div>'; return; }
        bd.innerHTML = rows.map(function (o) {
          var rev = o.commission_state === "reversed" || o.commission_state === "partially_reversed";
          return '<div class="lzc-ord"><div class="top"><span>طلب #' + o.order_no + '</span><span class="amt">− ' + money2(o.commission_amount) + ' ر</span></div>' +
            '<div class="chips"><span>' + (SEG_AR[o.segment] || o.segment || "—") + "</span><span>النسبة " + pct(o.commission_rate_applied, o.segment) +
            "</span><span>الأساس " + money2(o.goods_subtotal) + " ر</span></div>" +
            (rev ? '<div class="rev">' + (o.commission_state === "reversed" ? "أُعيدت كاملة" : "أُعيد جزء") + " (" + money2(o.reversed_amount) + " ر)</div>" : "") +
            "</div>";
        }).join("");
      });
  }

  // ---------- boot ----------
  function boot() {
    SB = window.LOZI_SB;
    if (!SB) return;
    injectCss();
    // Warm the cache, then fill any anchors already on screen.
    ensureLoaded(injectMounts);
    // Fill React-owned anchors as they mount (RFQ header / account tab).
    var obs = new MutationObserver(function () {
      if (obs._t) return;
      obs._t = setTimeout(function () { obs._t = null; injectMounts(); }, 60);
    });
    obs.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
    if (SB.auth && SB.auth.onAuthStateChange) {
      SB.auth.onAuthStateChange(function () {
        STATE.loaded = false; STATE.profile = null;
        Promise.all([loadProfile(), loadTiers()]).then(function () { STATE.loaded = true; refresh(); });
      });
    }
  }
  function waitSB(n) {
    if (window.LOZI_SB) { boot(); return; }
    if (n > 100) return;
    setTimeout(function () { waitSB(n + 1); }, 100);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { waitSB(0); });
  else waitSB(0);
})();

