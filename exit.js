/* ---------- 종료 (☰ 메뉴): 작업을 마무리하고 창 닫기 ---------- */
function exitApp() {
  const ok = window.confirm("작업을 마무리하고 종료할까요?");
  if (!ok) return;
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  try { sessionStorage.removeItem("startDone"); } catch {}
  try { if (typeof window.onExitApp === "function") window.onExitApp(); } catch {}
  try { window.close(); } catch {}
  // 브라우저가 창 닫기를 막는 경우: 종료 안내 화면을 보여 줘요
  setTimeout(() => {
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:999;background:#12285A;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;font-family:inherit";
    const t = document.createElement("div"); t.textContent = "종료되었어요"; t.style.cssText = "font-size:24px;font-weight:800";
    const s = document.createElement("div"); s.textContent = "작업이 모두 마무리되었어요. 이 창(앱)을 닫아 주세요."; s.style.cssText = "font-size:15px;opacity:.85;line-height:1.5";
    const b = document.createElement("button"); b.type = "button"; b.textContent = "다시 시작"; b.style.cssText = "margin-top:10px;border:0;border-radius:12px;padding:12px 26px;font:inherit;font-weight:700;background:#fff;color:#12285A;cursor:pointer";
    b.onclick = () => { location.href = "/"; };
    ov.append(t, s, b); document.body.append(ov);
  }, 250);
}
document.addEventListener("DOMContentLoaded", () => {
  const dd = document.getElementById("dd");
  if (!dd || dd.querySelector(".exitit")) return;
  const a = document.createElement("a"); a.className = "it exitit"; a.href = "#";
  const sp = document.createElement("span"); sp.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#D93025" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;margin:0 auto"><path d="M12 3v8"/><path d="M6.4 6.8a8 8 0 1 0 11.2 0"/></svg>'; const d = document.createElement("div"), b = document.createElement("b"), sm = document.createElement("small"); b.textContent = "종료"; sm.textContent = "모든 작업을 마무리하고 닫기"; d.append(b, sm); a.append(sp, d);
  a.addEventListener("click", (e) => { e.preventDefault(); const dim = document.getElementById("dim"), bg = document.getElementById("burger"); dd.hidden = true; if (dim) dim.hidden = true; if (bg) { bg.textContent = "☰"; bg.setAttribute("aria-expanded", "false"); } exitApp(); });
  dd.append(a);
});
