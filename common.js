/* 공통 설정 · 도우미 (신청 화면, 내 앱 화면이 함께 사용) */
const SUPABASE_URL = "https://dzwsiragcbunekpdtjeo.supabase.co";
const SUPABASE_KEY = "sb_publishable_elQjeIp9DcG4_D9TrCR3hQ_-n1_tMJr"; // 공개용 키 (노출되어도 안전한 키)
const PLAY_PREFIX = "https://play.google.com/";

const $ = (id) => document.getElementById(id);
const fn = (name) => `${SUPABASE_URL}/functions/v1/${name}`;
const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// 장르별로 묶기 (처음 나온 순서 유지)
function groupByGenre(list) {
  const m = new Map();
  for (const a of list) { const g = a.genre || "기타"; if (!m.has(g)) m.set(g, []); m.get(g).push(a); }
  return m;
}

// ☰ 통합 메뉴 열고 닫기
function initMenu() {
  const b = document.getElementById("burger"), dd = document.getElementById("dd"), dim = document.getElementById("dim");
  if (!b || !dd || !dim) return;
  const tb = document.querySelector(".appbar .topbar"); if (tb) document.documentElement.style.setProperty("--tb", tb.offsetHeight + "px");
  const set = (open) => { dd.hidden = !open; dim.hidden = !open; b.setAttribute("aria-expanded", open ? "true" : "false"); b.textContent = open ? "✕" : "☰"; };
  b.addEventListener("click", () => set(dd.hidden));
  dim.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
  initAppItems(dd, set);
}
document.addEventListener("DOMContentLoaded", initMenu);

/* ---------- 앱으로 설치 · 전체화면 (PC·노트북) ---------- */
let deferredInstall = null, refreshAppItems = () => {};
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; refreshAppItems(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; refreshAppItems(); });
const dispMode = (m) => window.matchMedia && matchMedia(`(display-mode: ${m})`).matches;
function appNote(msg) { if (typeof toast === "function") toast(msg, 6000); else alert(msg); }
function initAppItems(dd, close) {
  const mk = (ic, title, sub, fn) => { const a = document.createElement("a"); a.className = "it"; a.href = "#"; a.hidden = true;
    const sp = document.createElement("span"); sp.textContent = ic; const d = document.createElement("div"), b = document.createElement("b"), sm = document.createElement("small"); b.textContent = title; sm.textContent = sub; d.append(b, sm); a.append(sp, d);
    a.addEventListener("click", (e) => { e.preventDefault(); close(false); fn(); }); dd.append(a); return { a, b, sm }; };
  const pcLike = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const inst = mk("💻", "PC 앱으로 설치", "바탕화면·시작메뉴 아이콘으로 전체화면 실행", async () => {
    if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch {} deferredInstall = null; refreshAppItems(); }
    else appNote("브라우저 주소창 오른쪽의 설치 아이콘(⊕) 또는 메뉴 › ‘앱 설치 / 이 사이트를 앱으로 설치’를 눌러 주세요.");
  });
  const full = mk("⛶", "전체화면", "화면 전체로 보기 (끄기: Esc 또는 다시 선택)", async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { appNote("이 브라우저에서는 전체화면을 켤 수 없어요. F11 키를 눌러 보세요."); }
  });
  refreshAppItems = () => {
    const app = dispMode("fullscreen") || dispMode("standalone") || navigator.standalone;
    inst.a.hidden = !pcLike || app;
    full.a.hidden = !pcLike || dispMode("fullscreen") || !document.documentElement.requestFullscreen;
    full.b.textContent = document.fullscreenElement ? "전체화면 끄기" : "전체화면";
  };
  document.addEventListener("fullscreenchange", refreshAppItems);
  refreshAppItems();
}
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

/* ---------- 하단 메뉴 (모든 화면) : 회원 · 내 앱 · 홈 · 강의 · 공지·투표 ---------- */
const BNAV = [["members", "/#/members", "👥", "회원"], ["myapps", "/myapps", "📲", "내 앱"], ["home", "/#/", "🏠", "홈"], ["records", "/records", "📊", "기록 조회"], ["notices", "/#/notices", "📣", "공지·투표"]];
function setBnav(active) {
  let nav = document.getElementById("bnav");
  if (!nav) {
    nav = document.createElement("nav"); nav.className = "bnav"; nav.id = "bnav"; nav.setAttribute("aria-label", "메뉴");
    for (const [r, href, ic, label] of BNAV) {
      const a = document.createElement("a"); a.href = href; a.dataset.r = r;
      const sp = document.createElement("span"); sp.textContent = ic; a.append(sp, label); nav.append(a);
    }
    document.body.append(nav);
  }
  nav.hidden = false;
  nav.querySelectorAll("a").forEach((a) => { const on = a.dataset.r === active; a.classList.toggle("on", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
}
document.addEventListener("DOMContentLoaded", () => {
  const p = location.pathname.replace(/\.html$/, "");
  if (p === "/" || p === "/index" || p === "/home") return; // 홈은 자체 라우터가 표시
  setBnav(p === "/myapps" || p === "/apps" ? "myapps" : p === "/records" ? "records" : "");
});

/* ---------- 기기 판별: PC·노트북(마우스, 넓은 창)만 가로 2단 화면, 나머지는 한 열 ---------- */
(function () {
  const root = document.documentElement;
  const fine = window.matchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)") : null;
  const set = () => root.setAttribute("data-dev", fine && fine.matches && window.innerWidth >= 900 ? "desktop" : "mobile");
  set();
  window.addEventListener("resize", set);
  window.addEventListener("orientationchange", set);
})();
