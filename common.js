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
