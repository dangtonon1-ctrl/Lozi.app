
/* ============================================================================
   Lozi — Internal realtime chat (customer-facing) — نظام الدردشة الداخلية اللحظية
   Self-contained vanilla module (same pattern as the seller-levels widget):
   it uses window.LOZI_SB for auth / data / Supabase Realtime, injects its own
   RTL + Tajawal + green (#2F5E3E) styles, mounts a floating launcher and a chat
   overlay, and exposes:
       window.LoziChat.open({ vendorId | otherId, orderId, storeName })
   used by the "مراسلة المتجر" button (store page) and the order card.

   Number / link / email DETECTION, flagging and admin oversight are enforced
   SERVER-SIDE (RLS + DB trigger). Messages always SEND; suspicious ones are
   flagged for the admin. This client only sends and reads. A light client-side
   hint pre-warns the user before they share contact numbers.
   Realtime is kept efficient: only the OPEN conversation is subscribed.
   ========================================================================== */
(function () {
  "use strict";
  var SB = null, ME = null;
  var els = {}, state = { view: null, conv: null, otherName: "", cameFrom: "direct", sub: null, seen: null, isAdminChat: false };

  /* ---------- helpers ---------- */
  function fmtTime(s) {
    try { return new Date(s).toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }); }
    catch (e) { return ""; }
  }
  function arDigits(t) {
    return String(t || "")
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  }
  // Mirrors the server rule (alert-only hint): Yemeni mobile + WhatsApp/Telegram/email.
  function looksLeaky(t) {
    if (!t) return false;
    var d = arDigits(t).replace(/[^0-9]/g, "");
    if (/7[7318][0-9]{7}/.test(d)) return true;
    var low = arDigits(t).toLowerCase();
    if (/(wa\.me|whatsapp|chat\.whatsapp|t\.me|telegram|tg:\/\/|واتساب|واتس|تلغرام|تليجرام|تيليجرام|تيليغرام)/.test(low.replace(/\s+/g, ""))) return true;
    if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(low)) return true;
    return false;
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "lzc-toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 10);
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 250); }, 2600);
  }

  /* ---------- styles ---------- */
  function injectCss() {
    if (document.getElementById("lzchat-css")) return;
    if (!document.querySelector('link[href*="Tajawal"]')) {
      var l = document.createElement("link"); l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap";
      document.head.appendChild(l);
    }
    var s = document.createElement("style"); s.id = "lzchat-css";
    s.textContent = [
      ".lzc-fab{position:fixed;inset-block-end:84px;inset-inline-start:16px;width:54px;height:54px;border-radius:50%;border:none;background:#2F5E3E;color:#fff;display:none;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.22);cursor:pointer;z-index:99990;}",
      ".lzc-fab.on{display:flex;}",
      ".lzc-fab svg{width:26px;height:26px;}",
      ".lzc-overlay{position:fixed;inset:0;background:#FAF7F2;z-index:99991;display:none;flex-direction:column;direction:rtl;font-family:'Tajawal',system-ui,sans-serif;color:#241F1A;max-width:760px;margin:0 auto;box-shadow:0 0 40px rgba(0,0,0,.12);}",
      ".lzc-overlay.on{display:flex;}",
      ".lzc-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:#264B32;color:#fff;flex-shrink:0;}",
      ".lzc-head .lzc-title{font-size:16px;font-weight:900;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".lzc-head button{background:rgba(255,255,255,.16);color:#fff;border:none;border-radius:10px;width:36px;height:36px;font-size:18px;font-weight:800;cursor:pointer;flex-shrink:0;}",
      ".lzc-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;}",
      ".lzc-empty{text-align:center;color:#8A8276;padding:48px 16px;font-size:14px;}",
      ".lzc-row{display:flex;align-items:center;gap:12px;width:100%;text-align:start;background:#fff;border:1px solid #ECE4D7;border-radius:14px;padding:12px;margin-bottom:10px;cursor:pointer;font-family:inherit;}",
      ".lzc-av{width:44px;height:44px;border-radius:12px;background:#E7F0EA;color:#264B32;display:flex;align-items:center;justify-content:center;font-weight:900;flex-shrink:0;overflow:hidden;}",
      ".lzc-av img{width:100%;height:100%;object-fit:cover;}",
      ".lzc-ci{flex:1;min-width:0;}",
      ".lzc-nm{font-weight:800;font-size:14.5px;display:flex;align-items:center;gap:6px;}",
      ".lzc-pv{font-size:12.5px;color:#8A8276;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".lzc-tm{font-size:11px;color:#B7AE9F;flex-shrink:0;}",
      ".lzc-otag{font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:7px;background:#F4ECDC;color:#5A4124;}",
      ".lzc-role{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:7px;background:#E7F0EA;color:#264B32;}",
      ".lzc-bub{max-width:80%;padding:9px 13px;border-radius:15px;font-size:14.5px;line-height:1.65;margin-bottom:8px;word-break:break-word;white-space:pre-wrap;}",
      ".lzc-bub.them{align-self:flex-start;background:#fff;border:1px solid #ECE4D7;border-bottom-inline-start-radius:5px;}",
      ".lzc-bub.me{align-self:flex-end;background:#E7F0EA;border-bottom-inline-end-radius:5px;}",
      ".lzc-bub .lzc-bt{font-size:10.5px;color:#B7AE9F;margin-top:4px;text-align:end;}",
      ".lzc-flagnote{font-size:10.5px;color:#C0392B;margin-top:4px;font-weight:700;}",
      ".lzc-hint{font-size:11.5px;color:#9A6B2E;background:#FBF1DE;border-radius:10px;padding:7px 10px;margin:0 14px 6px;display:none;}",
      ".lzc-hint.on{display:block;}",
      ".lzc-foot{display:none;align-items:flex-end;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #ECE4D7;flex-shrink:0;}",
      ".lzc-foot.on{display:flex;}",
      ".lzc-foot textarea{flex:1;border:1.5px solid #ECE4D7;border-radius:14px;padding:11px 14px;font-size:15px;font-family:inherit;resize:none;max-height:120px;background:#FAF7F2;color:#241F1A;}",
      ".lzc-foot textarea:focus{outline:none;border-color:#2F5E3E;}",
      ".lzc-send{width:46px;height:46px;border-radius:50%;border:none;background:#2F5E3E;color:#fff;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;}",
      ".lzc-send:disabled{opacity:.5;}",
      ".lzc-note{font-size:11px;color:#8A8276;text-align:center;padding:6px 14px 0;}",
      ".lzc-toast{position:fixed;inset-block-end:30px;inset-inline:0;margin:auto;width:max-content;max-width:86%;background:#241F1A;color:#fff;padding:11px 18px;border-radius:12px;font-family:'Tajawal',sans-serif;font-size:13.5px;font-weight:700;z-index:99999;opacity:0;transition:.25s;direction:rtl;}",
      ".lzc-toast.show{opacity:.96;}"
    ].join("");
    document.head.appendChild(s);
  }

  var SVG_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>';

  /* ---------- draggable fab ---------- */
  function makeFabDraggable(fab) {
    var LS = "lozi.fab.pos", M = 10, NAV = 84;
    fab.style.touchAction = "none";
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function bounds() {
      var w = fab.offsetWidth || 54, h = fab.offsetHeight || 54;
      return { maxX: Math.max(M, window.innerWidth - w - M), maxY: Math.max(M, window.innerHeight - h - NAV) };
    }
    function place(x, y, save) {
      var b = bounds();
      x = clamp(x, M, b.maxX); y = clamp(y, M, b.maxY);
      // Neutralize the stylesheet's logical insets FIRST (the CSS pins the fab with
      // inset-inline-start/inset-block-end), then set physical left/top LAST so they win —
      // in RTL the logical end/start insets map onto left/top, so order matters.
      fab.style.right = "auto"; fab.style.bottom = "auto";
      fab.style.insetInlineStart = "auto"; fab.style.insetInlineEnd = "auto";
      fab.style.insetBlockStart = "auto"; fab.style.insetBlockEnd = "auto";
      fab.style.left = x + "px"; fab.style.top = y + "px";
      if (save) { try { localStorage.setItem(LS, JSON.stringify({ x: x, y: y })); } catch (e) {} }
    }
    var saved = null; try { saved = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) {}
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") place(saved.x, saved.y, false);
    window.addEventListener("resize", function () {
      if (fab.style.left) place(parseFloat(fab.style.left) || M, parseFloat(fab.style.top) || M, false);
    });
    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;
    fab.addEventListener("pointerdown", function (e) {
      dragging = true; moved = false; pid = e.pointerId;
      var r = fab.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; sx = e.clientX; sy = e.clientY;
      try { fab.setPointerCapture(pid); } catch (_) {}
    });
    fab.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      if (!moved && (Math.abs(e.clientX - sx) > 4 || Math.abs(e.clientY - sy) > 4)) moved = true;
      if (moved) place(e.clientX - ox, e.clientY - oy, false);
    });
    function end() {
      if (!dragging) return; dragging = false;
      try { fab.releasePointerCapture(pid); } catch (_) {}
      if (moved) { var r = fab.getBoundingClientRect(); place(r.left, r.top, true); }
    }
    fab.addEventListener("pointerup", end);
    fab.addEventListener("pointercancel", end);
    // Re-route the tap: only open chat when the press wasn't a drag.
    fab.onclick = function () { if (moved) { moved = false; return; } window.LoziChat.openList(); };
  }

  /* ---------- mount ---------- */
  function mount() {
    injectCss();
    var fab = document.createElement("button");
    fab.className = "lzc-fab"; fab.id = "lzc-fab"; fab.setAttribute("aria-label", "الرسائل");
    fab.innerHTML = SVG_CHAT;
    fab.onclick = function () { window.LoziChat.openList(); };
    document.body.appendChild(fab); els.fab = fab;
    makeFabDraggable(fab);

    var ov = document.createElement("div");
    ov.className = "lzc-overlay"; ov.id = "lzc-overlay";
    ov.innerHTML =
      '<div class="lzc-head">' +
        '<button class="lzc-back" aria-label="رجوع">‹</button>' +
        '<div class="lzc-title">الرسائل</div>' +
        '<button class="lzc-close" aria-label="إغلاق">✕</button>' +
      '</div>' +
      '<div class="lzc-body"></div>' +
      '<div class="lzc-hint"></div>' +
      '<div class="lzc-foot">' +
        '<textarea rows="1" placeholder="اكتب رسالة…"></textarea>' +
        '<button class="lzc-send" aria-label="إرسال">➤</button>' +
      '</div>';
    document.body.appendChild(ov); els.ov = ov;
    els.title = ov.querySelector(".lzc-title");
    els.body = ov.querySelector(".lzc-body");
    els.foot = ov.querySelector(".lzc-foot");
    els.hint = ov.querySelector(".lzc-hint");
    els.input = ov.querySelector(".lzc-foot textarea");
    els.sendBtn = ov.querySelector(".lzc-send");
    ov.querySelector(".lzc-back").onclick = onBack;
    ov.querySelector(".lzc-close").onclick = closeOverlay;
    els.sendBtn.onclick = sendMessage;
    els.input.addEventListener("input", function () {
      els.input.style.height = "auto"; els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
      var leak = !state.isAdminChat && looksLeaky(els.input.value);
      els.hint.classList.toggle("on", leak);
      if (leak) els.hint.textContent = "تنبيه: مشاركة أرقام التواصل أو الروابط الخارجية مخالفة وتخضع لمراجعة الإدارة.";
    });
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  function showOverlay() { els.ov.classList.add("on"); document.body.style.overflow = "hidden"; }
  function closeOverlay() {
    els.ov.classList.remove("on"); document.body.style.overflow = "";
    teardownSub();
  }
  function teardownSub() {
    if (state.sub) { try { SB.removeChannel(state.sub); } catch (e) {} state.sub = null; }
  }
  function onBack() {
    if (state.view === "thread" && state.cameFrom === "list") { teardownSub(); openList(); }
    else closeOverlay();
  }

  /* ---------- data ---------- */
  function otherIdOf(c) { return c.participant_a === ME ? c.participant_b : c.participant_a; }
  // Section 14.2 — real identity shown to participants: first name + category.
  var CHAT_ROLE_AR = { customer: "عميل", farmer: "مزارع", farmer_almond: "مزارع لوز", farmer_raisin: "مزارع زبيب", retail: "تجزئة", wholesale: "جملة", admin: "إدارة" };
  function roleAr(r) { return CHAT_ROLE_AR[r] || ""; }
  function firstName(n) { n = String(n || "").trim(); return n ? n.split(/\s+/)[0] : "مستخدم"; }

  /* ---------- conversation list ---------- */
  function openList() {
    state.view = "list"; state.conv = null;
    els.title.textContent = "الرسائل";
    els.foot.classList.remove("on"); els.hint.classList.remove("on");
    showOverlay();
    els.body.innerHTML = '<div class="lzc-empty">جارٍ التحميل…</div>';
    SB.rpc("chat_my_conversations").then(function (r) {
      var rows = r.data || [];
      if (!rows.length) { els.body.innerHTML = '<div class="lzc-empty">لا توجد محادثات بعد.<br>ابدأ بمراسلة متجر من صفحته.</div>'; return; }
      renderList(rows);
    });
  }
  function renderList(rows) {
    els.body.innerHTML = "";
    rows.forEach(function (c) {
      var nm = firstName(c.other_name), role = roleAr(c.other_role);
      var row = document.createElement("button"); row.className = "lzc-row";
      var av = document.createElement("div"); av.className = "lzc-av"; av.textContent = (nm || "م").charAt(0);
      var ci = document.createElement("div"); ci.className = "lzc-ci";
      var nmEl = document.createElement("div"); nmEl.className = "lzc-nm";
      var nameSpan = document.createElement("span"); nameSpan.textContent = nm; nmEl.appendChild(nameSpan);
      if (role) { var rc = document.createElement("span"); rc.className = "lzc-role"; rc.textContent = role; nmEl.appendChild(rc); }
      if (c.order_id) { var tg = document.createElement("span"); tg.className = "lzc-otag"; tg.textContent = "بخصوص طلب"; nmEl.appendChild(tg); }
      var pv = document.createElement("div"); pv.className = "lzc-pv"; pv.textContent = c.last_message_preview || "—";
      ci.appendChild(nmEl); ci.appendChild(pv);
      var tm = document.createElement("div"); tm.className = "lzc-tm"; tm.textContent = fmtTime(c.last_message_at);
      row.appendChild(av); row.appendChild(ci); row.appendChild(tm);
      row.onclick = function () { state.cameFrom = "list"; openThread({ id: c.id, order_id: c.order_id }, nm, role, c.other_is_admin); };
      els.body.appendChild(row);
    });
  }

  /* ---------- thread ---------- */
  function openThread(conv, otherName, otherRole, isAdmin) {
    state.view = "thread"; state.conv = conv; state.otherName = otherName || "محادثة"; state.seen = {}; state.isAdminChat = !!isAdmin;
    els.title.textContent = state.otherName + (otherRole ? " · " + otherRole : "");
    els.foot.classList.add("on");
    showOverlay();
    els.body.innerHTML = '<div class="lzc-empty">جارٍ التحميل…</div>';
    SB.from("messages").select("*").eq("conversation_id", conv.id).order("created_at", { ascending: true })
      .then(function (r) {
        els.body.innerHTML = "";
        var note = document.createElement("div"); note.className = "lzc-note";
        note.textContent = "محادثة داخل تطبيق لوزي · تخضع لمراجعة الإدارة";
        els.body.appendChild(note);
        (r.data || []).forEach(appendMsg);
        scrollEnd();
      });
    subscribe(conv.id);
    setTimeout(function () { els.input.focus(); }, 120);
  }
  function subscribe(convId) {
    teardownSub();
    state.sub = SB.channel("lzc-" + convId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + convId }, function (p) { appendMsg(p.new); scrollEnd(); })
      .subscribe();
  }
  function appendMsg(m) {
    if (!m || (state.seen && state.seen[m.id])) return;
    if (state.seen) state.seen[m.id] = 1;
    var mine = m.sender_id === ME;
    var b = document.createElement("div"); b.className = "lzc-bub " + (mine ? "me" : "them");
    var body = document.createElement("div");
    body.textContent = m.body || (Array.isArray(m.attachments) && m.attachments.length ? "📎 مرفق" : "");
    b.appendChild(body);
    if (mine && m.flagged) {
      var fn = document.createElement("div"); fn.className = "lzc-flagnote";
      fn.textContent = "⚠ تم تمييز هذه الرسالة للمراجعة";
      b.appendChild(fn);
    }
    var t = document.createElement("div"); t.className = "lzc-bt"; t.textContent = fmtTime(m.created_at);
    b.appendChild(t);
    els.body.appendChild(b);
  }
  function scrollEnd() { els.body.scrollTop = els.body.scrollHeight; }

  function sendMessage() {
    if (!state.conv) return;
    var v = els.input.value.trim();
    if (!v) return;
    els.input.value = ""; els.input.style.height = "auto"; els.hint.classList.remove("on");
    els.sendBtn.disabled = true;
    SB.from("messages").insert({ conversation_id: state.conv.id, sender_id: ME, body: v }).select().single()
      .then(function (r) {
        els.sendBtn.disabled = false;
        if (r.error) { toast("تعذّر إرسال الرسالة"); return; }
        appendMsg(r.data); scrollEnd();
      })
      .catch(function () { els.sendBtn.disabled = false; toast("تعذّر إرسال الرسالة"); });
  }

  /* ---------- public API ---------- */
  function ensureReady() {
    return waitSB(0).then(function () { return refreshMe(); }).then(function () {
      if (!ME) { toast("الرجاء تسجيل الدخول لاستخدام المراسلة"); return false; }
      return true;
    });
  }
  function refreshMe() {
    return SB.auth.getUser().then(function (r) {
      ME = r && r.data && r.data.user ? r.data.user.id : null;
      if (els.fab) els.fab.classList.toggle("on", !!ME);
      return ME;
    }).catch(function () { ME = null; return null; });
  }
  function doOpen(opts) {
    var other = opts.vendorId || opts.otherId;
    if (!other) { toast("تعذّر تحديد الطرف الآخر"); return; }
    if (other === ME) { toast("لا يمكنك مراسلة نفسك"); return; }
    var _rpc = opts.rfqOfferId ? "find_or_create_rfq_conversation" : "find_or_create_conversation";
    var _args = opts.rfqOfferId ? { p_other: other, p_offer: opts.rfqOfferId } : { p_other: other, p_order: opts.orderId || null };
    SB.rpc(_rpc, _args)
      .then(function (r) {
        if (r.error || !r.data) { toast("تعذّر فتح المحادثة"); return; }
        var convId = r.data;
        SB.rpc("chat_party_name", { p_other: other }).then(function (pr) {
          var row = pr && pr.data && pr.data[0];
          var nm = row ? firstName(row.name) : firstName(opts.storeName);
          var role = row ? roleAr(row.role) : "";
          state.cameFrom = "direct";
          openThread({ id: convId, order_id: opts.orderId || null, rfq_offer_id: opts.rfqOfferId || null }, nm, role, row && row.is_admin);
        });
      });
  }

  window.LoziChat = {
    open: function (opts) { opts = opts || {}; ensureReady().then(function (ok) { if (ok) doOpen(opts); }); },
    openList: function () { ensureReady().then(function (ok) { if (ok) openList(); }); },
    openAdmin: function (opts) {
      opts = opts || {};
      ensureReady().then(function (ok) {
        if (!ok) return;
        SB.rpc("find_or_create_admin_conversation").then(function (r) {
          if (r.error || !r.data) { toast("تعذّر فتح المحادثة"); return; }
          state.cameFrom = "direct";
          openThread({ id: r.data, order_id: null }, opts.storeName || "إدارة لوزي", "الإدارة", true);
        });
      });
    }
  };

  /* ---------- boot ---------- */
  function waitSB(n) {
    if (window.LOZI_SB) { SB = window.LOZI_SB; return Promise.resolve(); }
    if (n > 100) return Promise.reject();
    return new Promise(function (res) { setTimeout(function () { res(waitSB(n + 1)); }, 100); });
  }
  function boot() {
    SB = window.LOZI_SB;
    if (!SB) return;
    mount();
    refreshMe();
    if (SB.auth && SB.auth.onAuthStateChange) {
      SB.auth.onAuthStateChange(function () { refreshMe(); });
    }
  }
  function bootWait(n) {
    if (window.LOZI_SB) { boot(); return; }
    if (n > 100) return;
    setTimeout(function () { bootWait(n + 1); }, 100);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bootWait(0); });
  else bootWait(0);
})();
