/* ---------- 화면별 표시 방식 ----------
   기록 조회·클럽관리·관리·내 앱: ☰ 메뉴의 종료 항목은 두지 않아요. (첫 터치 자동 전체화면은 2026-11-23 제거)
   홈·회원·공지·투표(홈 화면 안): 기기 하단 메뉴가 보이는 일반 앱 화면에 종료 항목을 둬요. */
const FULL_PATHS = ["/club", "/records", "/admin", "/myapps", "/apps"];
const IS_FULL_PAGE = FULL_PATHS.includes(location.pathname.replace(/\/+$/, "").replace(/\.html$/, ""));
/* 2026-11-23: 첫 터치 때 자동으로 전체화면(requestFullscreen)으로 바꾸던 동작을 없앴어요.
   전체화면에 들어갈 때 하단에 뜨는 안내 문구는 브라우저(Chrome·Android)가 직접 보여 주는 것이라 표시 시간을 사이트에서 바꿀 수 없어요.
   (PC ☰ 메뉴의 '전체화면' 항목은 사용자가 직접 선택할 때만 동작하므로 그대로 둬요.) */
/* ---------- 종료 (☰ 메뉴): 작업을 마무리하고 창 닫기 ---------- */
function exitApp() {
  let pend = 0; try { if (typeof Pend !== "undefined") pend = Pend.ops.length; } catch {}
  const ok = window.confirm(pend ? `UpLoad하지 않은 입력·수정이 ${pend}건 있어요.\n종료하면 서버에 저장되지 않아요. 그래도 종료할까요?` : "작업을 마무리하고 종료할까요?");
  if (!ok) return;
  if (pend) { try { Pend.drop(); } catch {} }
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  try { sessionStorage.removeItem("startDone"); } catch {}
  try { if (typeof window.onExitApp === "function") window.onExitApp(); } catch {}
  try { window.close(); } catch {}
  // 브라우저가 창 닫기를 막는 경우: 일반 탭은 홈 화면으로, 설치한 앱에서 닫히지 않으면 종료 안내 화면을 보여 줘요
  setTimeout(() => {
    const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    const p = location.pathname.replace(/\/+$/, "").replace(/\.html$/, "");
    const atHome = p === "" || p === "/index" || p === "/records"; // 홈·기록 조회에서는 홈으로 가도 종료처럼 안 보여서 종료 안내 화면을 보여 줘요
    if (!standalone && !atHome) { location.replace("/"); return; }
    // 설치한 앱: 웹페이지가 창을 직접 닫지 못하는 기기가 있어요. 열었던 화면 기록을 처음으로 되돌려 두면 뒤로 가기 한 번으로 앱이 닫혀요.
    if (standalone) { try { if (history.length > 1) history.go(-(history.length - 1)); } catch {} }
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:999;background:#12285A;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;font-family:inherit";
    const t = document.createElement("div"); t.textContent = "종료되었어요"; t.style.cssText = "font-size:24px;font-weight:800";
    const s = document.createElement("div"); s.textContent = standalone ? "작업이 모두 마무리되었어요.\n기기의 뒤로 가기를 한 번 더 누르면 앱이 닫혀요.\n(또는 최근 앱 화면에서 이 앱을 밀어서 닫아 주세요)" : "작업이 모두 마무리되었어요. 이 창(앱)을 닫아 주세요."; s.style.cssText = "font-size:15px;opacity:.85;line-height:1.6;white-space:pre-line";
    const b = document.createElement("button"); b.type = "button"; b.textContent = "다시 시작"; b.style.cssText = "margin-top:10px;border:0;border-radius:12px;padding:12px 26px;font:inherit;font-weight:700;background:#fff;color:#12285A;cursor:pointer";
    b.onclick = () => { location.href = "/"; };
    ov.append(t, s, b); document.body.append(ov);
  }, 250);
}
document.addEventListener("DOMContentLoaded", () => {
  const dd = document.getElementById("dd");
  if (!dd || dd.querySelector(".exitit") || IS_FULL_PAGE) return;
  const a = document.createElement("a"); a.className = "it exitit"; a.href = "#";
  const sp = document.createElement("span"); sp.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#D93025" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;margin:0 auto"><path d="M12 3v8"/><path d="M6.4 6.8a8 8 0 1 0 11.2 0"/></svg>'; const d = document.createElement("div"), b = document.createElement("b"), sm = document.createElement("small"); b.textContent = "종료"; sm.textContent = "모든 작업을 마무리하고 닫기"; d.append(b, sm); a.append(sp, d);
  a.addEventListener("click", (e) => { e.preventDefault(); const dim = document.getElementById("dim"), bg = document.getElementById("burger"); dd.hidden = true; if (dim) dim.hidden = true; if (bg) { bg.textContent = "☰"; bg.setAttribute("aria-expanded", "false"); } exitApp(); });
  dd.append(a);
});
