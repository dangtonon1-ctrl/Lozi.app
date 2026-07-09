
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

  var SB = null, STATE = { uid: null, profile: null, tiers: [], orders: null, calcSeg: "retail", calcAmt: 4500, tab: "level" };

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
      ".lzc-chip{position:fixed;top:calc(env(safe-area-inset-top,0px) + 14px);inset-inline-end:14px;bottom:auto;inset-inline-start:auto;z-index:99990;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#2F5E3E,#234a30);color:#fff;border:none;border-radius:30px;padding:8px 14px 8px 12px;box-shadow:0 8px 22px rgba(35,74,48,.34);cursor:pointer;font-family:'Tajawal',sans-serif;}",
      ".lzc-chip .rg{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:900;color:#fff;background:conic-gradient(#C08A43 var(--p,30%),rgba(255,255,255,.28) 0);}",
      ".lzc-chip .rg i{width:16px;height:16px;border-radius:50%;background:#234a30;display:grid;place-items:center;font-style:normal;}",
      ".lzc-chip .ct{display:flex;flex-direction:column;line-height:1.15;text-align:start;}",
      ".lzc-chip .ct b{font-size:12.5px;font-weight:800;}",
      ".lzc-chip .ct s{font-size:10px;text-decoration:none;color:#d6e7db;font-weight:600;}",
      ".lzc-chip{max-width:92vw;}",
      ".lzc-chip .ct{min-width:0;}",
      ".lzc-chip .lzc-p5{display:flex;flex-direction:column;gap:3px;margin-top:5px;max-width:230px;}",
      ".lzc-chip .lzc-p5b{height:4px;border-radius:30px;background:rgba(255,255,255,.28);overflow:hidden;}",
      ".lzc-chip .lzc-p5b i{display:block;height:100%;border-radius:30px;background:linear-gradient(90deg,#e0b574,#C08A43);transition:width .3s ease;}",
      ".lzc-chip .lzc-p5t{font-size:9.5px;font-weight:700;line-height:1.3;color:#e7efe9;}",
      ".lzc-chip .lzc-p5t.ok{color:#f0d9a8;font-weight:800;}",
      ".lzc-chip .lzc-cd{font-size:9.5px;font-weight:800;line-height:1.3;font-variant-numeric:tabular-nums;}",
      ".lzc-chip .lzc-cd.live{color:#fff;}",
      ".lzc-chip .lzc-cd.open{color:#cfe2d6;font-weight:700;}",
      ".lzc-chip .lzc-cd.ended{color:#f3b0a0;font-weight:800;}",
      ".lzc-ov{position:fixed;inset:0;z-index:99991;background:rgba(20,30,24,.5);display:flex;align-items:flex-end;justify-content:center;}",
      ".lzc-sheet{background:#fff;width:100%;max-width:460px;max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.25);}",
      "@media(min-width:520px){.lzc-ov{align-items:center;}.lzc-sheet{border-radius:22px;}}",
      ".lzc-hd{background:linear-gradient(135deg,#2F5E3E,#234a30);color:#fff;padding:16px 18px;position:relative;display:flex;justify-content:space-between;align-items:center;}",
      ".lzc-hd::after{content:'';position:absolute;inset-inline:0;bottom:0;height:4px;background:linear-gradient(90deg,#C08A43,#e0b574,#C08A43);}",
      ".lzc-hd h3{font-size:18px;font-weight:900;margin:0;}",
      ".lzc-x{background:rgba(255,255,255,.16);border:none;color:#fff;width:32px;height:32px;border-radius:10px;font-size:18px;cursor:pointer;}",
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
      ".lzc-empty{text-align:center;color:var(--mut);font-weight:700;padding:26px 10px;}"
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
  // setting `rfq_launch_date` (public-readable). Empty = always open. One
  // setInterval drives the single floating chip; a re-render clears it first.
  var CD = { timer: null, el: null, end: 0 };
  function clearCountdown() {
    if (CD.timer) { clearInterval(CD.timer); CD.timer = null; }
    CD.el = null; CD.end = 0;
  }
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
  function cdTick() {
    if (!CD.el || !CD.el.isConnected) { clearCountdown(); return; }
    var ms = CD.end - Date.now();
    if (ms <= 0) {
      if (CD.timer) { clearInterval(CD.timer); CD.timer = null; }
      CD.el.className = "lzc-cd ended";
      CD.el.textContent = "انتهت مهلة الوصول · مقتصر على المستوى ٥";
      return;
    }
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), sec = s % 60;
    CD.el.className = "lzc-cd live";
    CD.el.textContent = (d > 0 ? d + " يوم " : "") + pad2(h) + " ساعة " + pad2(m) + " دقيقة " + pad2(sec) + " ثانية";
  }
  function startCountdown(chip) {
    var el = chip.querySelector(".lzc-cd");
    if (!el) return;
    loadLaunch().then(function (launch) {
      if (!el.isConnected) return;                  // chip replaced during fetch
      if (CD.timer) { clearInterval(CD.timer); CD.timer = null; } // guard duplicates
      if (!launch) { el.className = "lzc-cd open"; el.textContent = "مفتوح دائماً"; return; }
      var base = new Date(launch + "T00:00:00");
      if (isNaN(base.getTime())) { el.className = "lzc-cd open"; el.textContent = "مفتوح دائماً"; return; }
      // launch_date + 6 calendar months (mirrors `+ interval '6 months'`).
      var end = new Date(base.getFullYear(), base.getMonth() + 6, base.getDate(),
        base.getHours(), base.getMinutes(), base.getSeconds());
      CD.el = el; CD.end = end.getTime();
      cdTick();
      CD.timer = setInterval(cdTick, 1000);
    });
  }

  // ---------- chip ----------
  function renderChip() {
    clearCountdown();                                // guard: kill prior timer on re-render / nav away
    var old = document.querySelector(".lzc-chip"); if (old) old.remove();
    if (!STATE.profile || !isSeller(STATE.profile)) return;
    var seg = primarySeg(STATE.profile);
    var cum = Number(STATE.profile[seg + "_cumulative_sales"]) || 0;
    var tr = tierOf(STATE.tiers, seg, cum);
    if (!tr) return;
    var nx = nextTier(STATE.tiers, seg, tr.level);
    var prog = nx ? Math.max(0, Math.min(100, ((cum - tr.min_sales) / (nx.min_sales - tr.min_sales)) * 100)) : 100;

    // Progress toward Level 5 (permanent preorder access) + descending window countdown.
    var l5 = l5Status(STATE.profile);
    var p5 = l5.qualified
      ? '<span class="lzc-p5b"><i style="width:100%"></i></span>' +
        '<span class="lzc-p5t ok">وصلت للمستوى ٥ · وصول دائم</span>'
      : '<span class="lzc-p5b"><i style="width:' + l5.pct.toFixed(1) + '%"></i></span>' +
        '<span class="lzc-p5t">متبقٍ ' + grp(l5.remaining) + " للوصول للمستوى ٥ (" + l5.label + ")</span>" +
        '<span class="lzc-cd"></span>';

    var btn = document.createElement("button");
    btn.className = "lzc-chip lzc";
    btn.style.setProperty("--p", prog.toFixed(0) + "%");
    btn.innerHTML =
      '<span class="rg"><i>' + AR(tr.level) + "</i></span>" +
      '<span class="ct"><b>مستوى ' + AR(tr.level) + "</b><s>" + SEG_AR[seg] + " · " + pct(tr.rate, seg) + "</s>" +
      '<span class="lzc-p5">' + p5 + "</span></span>";
    document.body.appendChild(btn);
    try {
      var saved = JSON.parse(localStorage.getItem("lzc_chip_pos") || "null");
      if (saved && typeof saved.left === "number") applyPos(btn, saved.left, saved.top);
    } catch (e) {}
    makeDraggable(btn, openSheet);
    if (!l5.qualified) startCountdown(btn);          // qualified => no countdown
  }

  // Drag the chip anywhere; a tap (no real movement) opens the sheet. Position persists.
  function applyPos(el, left, top) {
    var w = el.offsetWidth || 150, h = el.offsetHeight || 46;
    left = Math.max(6, Math.min(window.innerWidth - w - 6, left));
    top = Math.max(6, Math.min(window.innerHeight - h - 6, top));
    el.style.left = left + "px"; el.style.top = top + "px";
    el.style.right = "auto"; el.style.bottom = "auto"; el.style.insetInlineStart = "auto";
  }
  function makeDraggable(el, onTap) {
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false, pid = null;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", function (e) {
      dragging = true; moved = false; pid = e.pointerId;
      var r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      try { el.setPointerCapture(pid); } catch (_) {}
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (moved) applyPos(el, ox + dx, oy + dy);
    });
    function end() {
      if (!dragging) return; dragging = false;
      try { el.releasePointerCapture(pid); } catch (_) {}
      if (moved) {
        var r = el.getBoundingClientRect();
        try { localStorage.setItem("lzc_chip_pos", JSON.stringify({ left: r.left, top: r.top })); } catch (_) {}
      } else { onTap(); }
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  // ---------- sheet ----------
  function openSheet() {
    Promise.all([loadProfile(), loadTiers()]).then(function () {
      STATE.calcSeg = primarySeg(STATE.profile);
      var ov = document.createElement("div");
      ov.className = "lzc-ov lzc";
      ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
      ov.innerHTML = '<div class="lzc-sheet"><div class="lzc-hd"><h3>مركز العمولة</h3><button class="lzc-x">×</button></div>' +
        '<div class="lzc-tabs"></div><div class="lzc-bd"></div></div>';
      ov.querySelector(".lzc-x").addEventListener("click", function () { ov.remove(); });
      document.body.appendChild(ov);
      buildTabs(ov); renderTab(ov);
    });
  }
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
    Promise.all([loadProfile(), loadTiers()]).then(renderChip);
    if (SB.auth && SB.auth.onAuthStateChange) {
      SB.auth.onAuthStateChange(function () {
        Promise.all([loadProfile(), loadTiers()]).then(renderChip);
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

