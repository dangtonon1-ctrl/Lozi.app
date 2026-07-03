
/* ============================================================================
   Lozi — Account guard (Section 14.1 + 14.3): in-app number-sharing WARNINGS
   and the THREE-STRIKES SUSPENSION screen. Self-contained vanilla module
   (same pattern as the chat module): uses window.LOZI_SB, listens to the
   server-created public.notifications via Supabase Realtime, and reuses the
   existing support_wa setting for the WhatsApp support button.
   Enforcement itself is server-side (RLS) — this is the user-facing surface.
   ========================================================================== */
(function () {
  "use strict";
  var SB = null, ME = null, channel = null, shown = false;

  function injectCss() {
    if (document.getElementById("lzguard-css")) return;
    if (!document.querySelector('link[href*="Tajawal"]')) {
      var l = document.createElement("link"); l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap";
      document.head.appendChild(l);
    }
    var s = document.createElement("style"); s.id = "lzguard-css";
    s.textContent = [
      ".lzg-warn{position:fixed;inset-block-start:0;inset-inline:0;z-index:99995;background:#FBE3E5;color:#8A1B23;border-bottom:2px solid #D62638;font-family:'Tajawal',sans-serif;direction:rtl;display:flex;align-items:flex-start;gap:10px;padding:14px 16px calc(14px + env(safe-area-inset-top));max-width:760px;margin:0 auto;box-shadow:0 4px 16px rgba(0,0,0,.12);}",
      ".lzg-warn .lzg-wic{font-size:20px;flex-shrink:0;}",
      ".lzg-warn .lzg-wbody{flex:1;min-width:0;font-size:13.5px;font-weight:700;line-height:1.6;}",
      ".lzg-warn .lzg-wsub{font-weight:800;color:#B02531;margin-top:3px;font-size:12.5px;}",
      ".lzg-warn .lzg-wx{background:none;border:none;color:#8A1B23;font-size:20px;font-weight:800;cursor:pointer;flex-shrink:0;line-height:1;}",
      ".lzg-susp{position:fixed;inset:0;z-index:99998;background:#FAF7F2;direction:rtl;font-family:'Tajawal',system-ui,sans-serif;color:#241F1A;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;max-width:760px;margin:0 auto;}",
      ".lzg-susp .lzg-badge{width:88px;height:88px;border-radius:26px;background:#FBE3E5;color:#D62638;display:flex;align-items:center;justify-content:center;margin-bottom:20px;}",
      ".lzg-susp h2{font-size:23px;font-weight:900;margin:0 0 12px;color:#D62638;}",
      ".lzg-susp p{font-size:15px;line-height:1.8;color:#5A4124;margin:0 0 8px;max-width:420px;}",
      ".lzg-susp .lzg-actions{display:flex;flex-direction:column;gap:12px;width:100%;max-width:340px;margin-top:22px;}",
      ".lzg-susp .lzg-wa{display:flex;align-items:center;justify-content:center;gap:10px;height:54px;border:none;border-radius:15px;background:#2F5E3E;color:#fff;font-size:16px;font-weight:800;font-family:inherit;cursor:pointer;text-decoration:none;}",
      ".lzg-susp .lzg-out{height:48px;border:1.5px solid #ECE4D7;border-radius:14px;background:#fff;color:#8A8276;font-size:14px;font-weight:800;font-family:inherit;cursor:pointer;}"
    ].join("");
    document.head.appendChild(s);
  }

  function waLink(num) {
    var d = String(num || "777184208").replace(/[^0-9]/g, "").replace(/^967/, "");
    return "https://wa.me/967" + d;
  }
  function loadSupportWa() {
    SB = SB || window.LOZI_SB;
    if (!SB) return Promise.resolve("777184208");
    return SB.from("settings").select("value").eq("key", "support_wa").maybeSingle()
      .then(function (r) { return (r.data && r.data.value) ? r.data.value : "777184208"; })
      .catch(function () { return "777184208"; });
  }

  // Section 14.1 — warning banner shown to the sender after a number-share match.
  function showWarning(body, count) {
    injectCss();
    var old = document.getElementById("lzg-warn"); if (old) old.remove();
    var b = document.createElement("div"); b.className = "lzg-warn"; b.id = "lzg-warn";
    var ic = document.createElement("div"); ic.className = "lzg-wic"; ic.textContent = "⚠️";
    var bd = document.createElement("div"); bd.className = "lzg-wbody";
    bd.textContent = body || "تحذير: مشاركة أرقام التواصل مخالفة لقواعد التطبيق";
    if (count) {
      var sub = document.createElement("div"); sub.className = "lzg-wsub";
      sub.textContent = "المخالفة " + count + " من 3 — عند المخالفة الثالثة يُوقف الحساب.";
      bd.appendChild(sub);
    }
    var x = document.createElement("button"); x.className = "lzg-wx"; x.textContent = "✕";
    x.onclick = function () { b.remove(); };
    b.appendChild(ic); b.appendChild(bd); b.appendChild(x);
    document.body.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.remove(); }, 9000);
  }

  // Section 14.3 — full-screen suspension screen with WhatsApp support.
  // Rendered immediately (never gated on a network call); the support number is
  // patched in once support_wa loads.
  function showSuspended() {
    if (shown) return; shown = true;
    SB = SB || window.LOZI_SB;
    injectCss();
    var ov = document.createElement("div"); ov.className = "lzg-susp"; ov.id = "lzg-susp";
    var badge = document.createElement("div"); badge.className = "lzg-badge";
    badge.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
    var h = document.createElement("h2"); h.textContent = "تم توقيف الحساب لكسر القواعد";
    var p1 = document.createElement("p");
    p1.textContent = "تم توقيف حسابك بسبب تكرار مشاركة أرقام التواصل، ولا يمكنه حالياً نشر المنتجات أو استقبال الطلبات.";
    var p2 = document.createElement("p"); p2.style.fontWeight = "800"; p2.style.color = "#241F1A";
    p2.textContent = "يرجى مراسلة الدعم الفني عبر الواتساب.";
    var acts = document.createElement("div"); acts.className = "lzg-actions";
    var waBtn = document.createElement("a"); waBtn.className = "lzg-wa"; waBtn.href = waLink("777184208");
    waBtn.target = "_blank"; waBtn.rel = "noopener";
    waBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15l-1.4 5 5.1-1.3A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20Zm4.4-5.6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4 0-.5.2-.7l.3-.4.2-.4v-.4l-.8-1.9c-.2-.5-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-1 2.2 5.3 5.3 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4 5.2 5.2 0 0 0 2.4.5 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg><span>مراسلة الدعم عبر الواتساب</span>';
    var out = document.createElement("button"); out.className = "lzg-out"; out.textContent = "تسجيل الخروج";
    out.onclick = function () { try { SB.auth.signOut().then(function () { location.reload(); }); } catch (e) { location.reload(); } };
    acts.appendChild(waBtn); acts.appendChild(out);
    ov.appendChild(badge); ov.appendChild(h); ov.appendChild(p1); ov.appendChild(p2); ov.appendChild(acts);
    var existing = document.getElementById("lzg-susp"); if (existing) existing.remove();
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    loadSupportWa().then(function (wa) { waBtn.href = waLink(wa); });
  }

  function checkStatus() {
    SB = SB || window.LOZI_SB;
    if (!SB || !ME) return;
    SB.from("profiles").select("status").eq("user_id", ME).maybeSingle()
      .then(function (r) { if (r.data && r.data.status === "suspended") showSuspended(); })
      .catch(function () {});
  }

  function subscribe() {
    if (channel) { try { SB.removeChannel(channel); } catch (e) {} channel = null; }
    if (!ME) return;
    channel = SB.channel("lzg-" + ME)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + ME }, function (p) {
        var n = p.new || {};
        if (n.type === "suspended") showSuspended();
        else if (n.type === "warning") showWarning(n.body, n.meta && n.meta.warning_count);
      }).subscribe();
  }

  function refreshMe() {
    SB = SB || window.LOZI_SB;
    if (!SB) return Promise.resolve(null);
    return SB.auth.getUser().then(function (r) {
      var id = r && r.data && r.data.user ? r.data.user.id : null;
      if (id !== ME) { ME = id; if (!ME) shown = false; subscribe(); checkStatus(); }
      return ME;
    }).catch(function () { ME = null; return null; });
  }

  window.LoziGuard = { showSuspended: showSuspended, showWarning: showWarning, check: checkStatus };

  function boot() {
    SB = window.LOZI_SB;
    if (!SB) return;
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
