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
}
document.addEventListener("DOMContentLoaded", initMenu);
