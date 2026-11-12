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
// Google 로그인 화면으로 이동 (돌아올 주소 = 지금 페이지)
async function googleStart() {
  const c = await _gClient();
  const q = new URLSearchParams(location.search);
  ["code", "error", "error_code", "error_description"].forEach((k) => q.delete(k));
  const back = location.origin + location.pathname + (q.toString() ? "?" + q : "");
  try { sessionStorage.setItem("gHash", location.hash || ""); } catch {}
  const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: back, queryParams: { prompt: "select_account" } } });
  if (error) throw error;
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
    const r = await fetch(fn("google-session"), { method: "POST", headers, body: JSON.stringify({ access_token: s.access_token }) });
    const d = await r.json().catch(() => ({}));
    await c.auth.signOut({ scope: "local" }).catch(() => {});
    if (!r.ok || !d.token) return { error: d.error || "google_failed" };
    try { localStorage.setItem("authToken", d.token); if (d.name) sessionStorage.setItem("gName", d.name); } catch {}
    return d;
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
  b.onclick = async () => { b.disabled = true; try { await googleStart(); } catch { b.disabled = false; alert("Google 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요."); } };
  return b;
}
