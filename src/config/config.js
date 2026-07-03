
  // Build marker — lets you confirm the freshest deploy is loaded (check the
  // browser console for "LOZI build:"). Bump this string whenever HTML changes.
  window.LOZI_BUILD = "2026-07-02-reset-cache-fix";
  try { console.log("LOZI build:", window.LOZI_BUILD); } catch (e) {}
  // Public config — the anon key is safe to expose in the browser by design.
  window.LOZI_SUPABASE_URL = "https://niloddwnllhsvrmuxfxw.supabase.co";
  window.LOZI_SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pbG9kZHdubGxoc3ZybXV4Znh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjk0MzcsImV4cCI6MjA5NjYwNTQzN30.JSI56mSLPxNK591fJY-vFFsgwjILfD6MU6-oobImGjc";
  try {
    // Detect a password-recovery deep-link SYNCHRONOUSLY, before the Supabase client is
    // created. createClient() asynchronously consumes and clears the URL hash/query, and
    // fires PASSWORD_RECOVERY on a deferred setTimeout — that fired too late to reliably beat
    // the app's getSession() promise, so the app raced the user off the reset screen and back
    // into "app". Setting the flag here (before React mounts and before getSession resolves)
    // makes the reset stage deterministic.
    var _loziAuthParams = String(window.location.hash || "") + "&" + String(window.location.search || "");
    if (/[#?&]type=recovery(?:&|$)/.test(_loziAuthParams)) window.LOZI_RECOVERY = true;
  } catch (e) {}
  try {
    if (window.supabase && window.supabase.createClient) {
      window.LOZI_SB = window.supabase.createClient(window.LOZI_SUPABASE_URL, window.LOZI_SUPABASE_ANON);
      window.LOZI_SB.auth.onAuthStateChange(function (event) { if (event === 'PASSWORD_RECOVERY') window.LOZI_RECOVERY = true; });
    }
  } catch (e) { console.warn('Supabase init failed:', e); }
