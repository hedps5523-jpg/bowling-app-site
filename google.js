/* Google 로그인 → 이 사이트의 기기 인증 토큰(authToken)으로 바꿔요.
   Supabase 로그인 세션은 토큰을 받은 뒤 바로 지워요(관리자 로그인과 섞이지 않게 별도 저장 키 사용). */
const GOOGLE_SB_SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
let _gsb = null;
function _loadSb() {
  return new Promise((res, rej) => {
    if (window.supabase && window.supabase.createClient) return res();
    const s = document.createElement("script");
    s.src = GOOGLE_SB_SRC; s.onload = () => res(); s.onerror = () => rej(new Error("load"));
    document.head.append(s);
  });
}
async function _gClient() {
  await _loadSb();
  if (!_gsb) _gsb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: "pkce", storageKey: "bowl-google", detectSessionInUrl: true, persistSession: true, autoRefreshToken: false },
  });
  return _gsb;
}
/* 이 기기에서 마지막으로 로그인한 Google 계정(이메일)을 기억해 두었다가 다음 로그인 때 login_hint 로 전달한다.
   → Google 의 '계정을 선택하세요' 화면 없이 이 기기에 연결된 그 계정으로 바로 진행된다. (처음 로그인하는 기기는 Google 이 계정을 묻는다) */
const G_EMAIL_KEY = "gEmail";
function _gHint() { try { return localStorage.getItem(G_EMAIL_KEY) || ""; } catch { return ""; } }
function _gOptions(back) { const hint = _gHint(); return { redirectTo: back, queryParams: hint ? { login_hint: hint } : {} }; }
// Google 로그인 화면으로 이동 (돌아올 주소 = 지금 페이지). One Tap 을 쓸 수 없을 때의 대체 방법.
async function _googleRedirect() {
  const c = await _gClient();
  const q = new URLSearchParams(location.search);
  ["code", "error", "error_code", "error_description"].forEach((k) => q.delete(k));
  const back = location.origin + location.pathname + (q.toString() ? "?" + q : "");
  try { sessionStorage.setItem("gHash", location.hash || ""); } catch {}
  const { error } = await c.auth.signInWithOAuth({ provider: "google", options: _gOptions(back) });
  if (error) throw error;
}

/* ---------- Google One Tap (Google Identity Services) ----------
   이 기기(브라우저)에 로그인된 Google 계정을 사이트 안에서 바로 보여 주고 한 번 눌러 로그인한다.
   Google 의 '계정을 선택하세요 … supabase.co(으)로 이동' 화면을 거치지 않는다.
   받은 ID 토큰은 Supabase signInWithIdToken 으로 바꾼 뒤 기존과 같이 이 사이트의 기기 인증 토큰(authToken)으로 교환한다.
   One Tap 을 띄울 수 없으면(차단·재표시 대기 시간·미지원 브라우저·Google 미로그인) 기존 로그인 화면 이동 방식으로 넘어간다. */
const GOOGLE_CLIENT_ID = "202077464521-a764eglh4grsq9idoo4mejkt5cvjlnag.apps.googleusercontent.com"; // 공개용 값 (Google Cloud 'Bowling Site' 웹 클라이언트)
const GIS_SRC = "https://accounts.google.com/gsi/client";
let _otReady = null, _otRaw = "";
function _loadGis() {
  return new Promise((res, rej) => {
    if (window.google && window.google.accounts && window.google.accounts.id) return res();
    const s = document.createElement("script");
    s.src = GIS_SRC; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error("gis"));
    document.head.append(s);
  });
}
async function _sha256Hex(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Supabase 세션 → 이 사이트 기기 인증 토큰 (리디렉션 방식·One Tap 공통). 성공 {token,…} / 실패 {error}
async function _gExchange(c, s) {
  const gmail = (s.user && s.user.email) || "";
  const r = await fetch(fn("google-session"), { method: "POST", headers, body: JSON.stringify({ access_token: s.access_token }) });
  const d = await r.json().catch(() => ({}));
  await c.auth.signOut({ scope: "local" }).catch(() => {});
  if (!r.ok || !d.token) return { error: d.error || "google_failed" };
  try { localStorage.setItem("authToken", d.token); if (gmail) localStorage.setItem(G_EMAIL_KEY, gmail); if (d.name) sessionStorage.setItem("gName", d.name); } catch {}
  return d;
}
function _oneTapSetup() {
  if (_otReady) return _otReady;
  _otReady = (async () => {
    await _loadGis();
    _otRaw = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const hashed = await _sha256Hex(_otRaw);
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID, nonce: hashed, auto_select: false /* 로그아웃 직후 자동 재로그인 방지: 계정 카드를 한 번 눌러 로그인 */, cancel_on_tap_outside: false, itp_support: true, use_fedcm_for_prompt: true,
      callback: async (resp) => {
        try {
          const c = await _gClient();
          const { data, error } = await c.auth.signInWithIdToken({ provider: "google", token: resp.credential, nonce: _otRaw });
          if (error || !data || !data.session) throw error || new Error("session");
          const d = await _gExchange(c, data.session);
          if (d.error) { alert(googleErrorText(d.error)); return; }
          location.reload(); // authToken 이 저장되었으니 로그인된 화면으로 다시 시작 (내 앱 보기 화면은 자동 이동)
        } catch { alert(googleErrorText("google_failed")); }
      },
    });
  })().catch((e) => { _otReady = null; throw e; });
  return _otReady;
}
// One Tap 표시를 시도한다. 표시되었거나 사용자가 직접 닫은 경우 true, 표시할 수 없었던 경우 false
async function _oneTapPrompt() {
  await _oneTapSetup();
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      window.google.accounts.id.prompt((n) => {
        try {
          if (n.isNotDisplayed && n.isNotDisplayed()) return fin(false);
          if (n.isSkippedMoment && n.isSkippedMoment()) { const why = n.getSkippedReason && n.getSkippedReason(); return fin(why === "user_cancel" || why === "tap_outside"); } // 사용자가 직접 닫은 경우만 '표시됨', 그 외(알 수 없는 이유 포함)는 표시되지 않은 것으로 보고 기존 방식으로 넘어감
          if ((n.isDisplayed && n.isDisplayed()) || (n.isDismissedMoment && n.isDismissedMoment())) return fin(true);
        } catch {}
      });
    } catch { return fin(false); }
    setTimeout(() => fin(false), 2500); // 2.5초 안에 표시 알림이 없으면 표시되지 않은 것으로 보고 기존 방식으로 넘어감
  });
}
// 로그인 버튼: One Tap 우선, 안 되면 기존 방식
async function googleStart() {
  let shown = false;
  try { shown = await _oneTapPrompt(); } catch { shown = false; }
  if (!shown) await _googleRedirect();
}
// 로그인 화면이 열릴 때 자동으로 One Tap 을 띄움 (표시할 수 없으면 조용히 건너뜀)
function googleAutoPrompt() {
  if (window.__otAuto) return; window.__otAuto = true;
  setTimeout(() => { _oneTapSetup().then(() => window.google.accounts.id.prompt()).catch(() => {}); }, 700);
}
// 돌아온 직후 처리: 해당 없음 → null / 성공 → {token,email,name} / 실패 → {error}
async function googleFinish() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return null;
  let hash = ""; try { hash = sessionStorage.getItem("gHash") || ""; sessionStorage.removeItem("gHash"); } catch {}
  const errText = q.get("error_description") || q.get("error");
  const code = q.get("code");
  ["code", "error", "error_code", "error_description"].forEach((k) => q.delete(k));
  history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + (location.hash || hash));
  if (errText) return { error: "google_cancel" };
  try {
    const c = await _gClient();
    let { data } = await c.auth.getSession();
    let s = data && data.session;
    if (!s && code) { const r = await c.auth.exchangeCodeForSession(code); s = r.data && r.data.session; }
    if (!s) return { error: "google_failed" };
    return await _gExchange(c, s);
  } catch (e) { return { error: "google_failed" }; }
}
function googleErrorText(e) {
  if (e === "google_cancel") return "Google 로그인이 취소되었어요. 다시 시도해 주세요.";
  if (e === "google_only") return "Google 계정으로만 로그인할 수 있어요.";
  return "Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.";
}
function googleButton(label) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "gbtn";
  b.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg><span></span>';
  b.querySelector("span").textContent = label || "Google로 시작하기";
  b.onclick = async () => { b.disabled = true; try { await googleStart(); setTimeout(() => { b.disabled = false; }, 1500); } catch { b.disabled = false; alert("Google 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요."); } };
  googleAutoPrompt(); // 로그인 버튼이 보이는(=로그아웃) 화면이면 One Tap 을 자동으로 띄움
  return b;
}
