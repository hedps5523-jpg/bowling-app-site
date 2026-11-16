/* =====================================================================
   클럽관리 (PC 볼링클럽 → 웹)
   - 자료: 모바일 볼링클럽 Supabase 서버 (PC·모바일과 같은 서버)
   - 로그인 ① 홈페이지 관리자·운영진: 홈페이지 인증 → 연결 함수(site-club-bridge)
           ② 모바일 볼링클럽 ID/비밀번호: 서버 계정 권한(RLS) 그대로
   - 저장: PC와 같은 bowlingclub_atomic_upload (전역 버전 + 행 버전 충돌 검사)
   ===================================================================== */
const VH_URL = "https://vhnqzjzqmtpibdhemihc.supabase.co";
const VH_KEY = "sb_publishable_nV6zhjRw7_YEn3ddsfXfow_55v3NP_s"; // 볼링클럽 서버 공개용 키
const VH_FN = (n) => `${VH_URL}/functions/v1/${n}`;
const MOBILE_KEY = "bcMobileSession";

/* ---------- 작은 도우미 ---------- */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e[k] = v;
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return e;
}
const view = $("view");
let toastT;
function toast(t, ms = 2600) { const e = $("toastc"); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => e.hidden = true, ms); }
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
const pad2 = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const normDate = (v) => { const s = String(v ?? "").trim(); if (isDate(s)) return s; const m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/); return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : null; };
const yearOf = (s) => +s.slice(0, 4), monthOf = (s) => +s.slice(5, 7);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const mmdd = (s) => s ? `${s.slice(5, 7)}/${s.slice(8, 10)}` : "";
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

/* =====================================================================
   1) 연결 (홈페이지 연결 / 모바일 계정)
   ===================================================================== */
const Conn = {
  mode: null, me: null,
  siteToken() { try { return localStorage.getItem("authToken") || ""; } catch { return ""; } },
  mobile() { try { return JSON.parse(localStorage.getItem(MOBILE_KEY) || "null"); } catch { return null; } },
  saveMobile(s) { try { s ? localStorage.setItem(MOBILE_KEY, JSON.stringify(s)) : localStorage.removeItem(MOBILE_KEY); } catch {} },

  async bridge(action, data = {}) {
    const r = await fetch(VH_FN("site-club-bridge"), { method: "POST", headers: { "Content-Type": "application/json", apikey: VH_KEY }, body: JSON.stringify({ token: this.siteToken(), action, ...data }) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, d };
  },

  jwtExp(t) { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp || 0; } catch { return 0; } },
  async mobileToken() {
    const s = this.mobile(); if (!s) throw new Error("login");
    if (this.jwtExp(s.access_token) - 60 > Date.now() / 1000) return s.access_token;
    const r = await fetch(`${VH_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "Content-Type": "application/json", apikey: VH_KEY }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) { this.saveMobile(null); throw new Error("login"); }
    s.access_token = d.access_token; s.refresh_token = d.refresh_token || s.refresh_token; this.saveMobile(s);
    return s.access_token;
  },
  async rest(path, opt = {}) {
    const tok = await this.mobileToken();
    const r = await fetch(`${VH_URL}/rest/v1/${path}`, { ...opt, headers: { apikey: VH_KEY, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(opt.headers || {}) } });
    const d = await r.json().catch(() => null);
    if (r.status === 401) { this.saveMobile(null); throw new Error("login"); }
    return { ok: r.ok, status: r.status, d };
  },
  async readAll(table, order) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await this.rest(`${table}?select=*&order=${order}`, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
      if (!r.ok) throw new Error(`${table}: ${(r.d && r.d.message) || r.status}`);
      out.push(...(r.d || []));
      if (!r.d || r.d.length < 1000) break;
    }
    return out;
  },

  async loginMobile(loginId, password) {
    const r = await fetch(VH_FN("bowlingclub-login-by-id"), { method: "POST", headers: { "Content-Type": "application/json", apikey: VH_KEY }, body: JSON.stringify({ login_id: loginId, password }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error(d.error === "rate_limited" ? "잠시 후 다시 시도해 주세요. (시도 횟수 초과)" : "아이디 또는 비밀번호가 맞지 않아요.");
    this.saveMobile({ access_token: d.access_token, refresh_token: d.refresh_token, profile: d.profile });
  },

  /* 시작: 저장된 모바일 로그인 → 홈페이지 관리자·운영진 순으로 확인 */
  async start() {
    const m = this.mobile();
    if (m && m.profile) {
      const p = m.profile;
      this.mode = "mobile";
      this.me = { name: p.requested_member_name || p.login_id, loginId: p.login_id, role: p.role, isAdmin: p.role === "admin", canRead: p.role === "admin" || p.approved === true, canWrite: p.role === "admin" || (p.approved === true && p.can_write === true), source: "mobile" };
      try { const r = await this.rest("rpc/bowlingclub_my_profile", { method: "POST", body: "{}" }); const q = r.ok && Array.isArray(r.d) && r.d[0]; if (q) { m.profile = q; this.saveMobile(m); this.me = { ...this.me, role: q.role, isAdmin: q.role === "admin", canRead: q.role === "admin" || q.approved === true, canWrite: q.role === "admin" || (q.approved === true && q.can_write === true) }; } } catch (e) { if (e.message === "login") return { need: "login", reason: "expired" }; }
      return this.me.canRead ? { ok: true } : { need: "login", reason: "not_approved" };
    }
    if (this.siteToken()) {
      const r = await this.bridge("whoami");
      if (r.ok) { this.mode = "site"; this.me = { ...r.d.me, canRead: true, canWrite: true }; return { ok: true }; }
      if (r.status === 403) return { need: "login", reason: "site_member" };
    }
    return { need: "login" };
  },
  async logout() { this.saveMobile(null); this.mode = null; this.me = null; },

  async snapshot() {
    if (this.mode === "site") {
      const r = await this.bridge("snapshot");
      if (!r.ok) throw new Error(r.d.error || "자료를 불러오지 못했어요.");
      return { dataVersion: r.d.dataVersion, tables: r.d.tables };
    }
    const order = { members: "member_id.asc", games: "record_id.asc", ledger_entries: "ledger_id.asc", fee_payments: "payment_id.asc", lockers: "locker_id.asc", quarter_base_averages: "member_id.asc,year.asc,quarter.asc", app_settings: "setting_key.asc" };
    const v1 = await this.rest("rpc/bowlingclub_data_version", { method: "POST", body: "{}" });
    const tables = {};
    for (const [t, o] of Object.entries(order)) tables[t] = await this.readAll(t, o);
    const v2 = await this.rest("rpc/bowlingclub_data_version", { method: "POST", body: "{}" });
    if (v1.d !== v2.d) return this.snapshot(); // 읽는 도중 다른 기기가 저장하면 다시 읽기 (PC와 같은 규칙)
    return { dataVersion: Number(v2.d) || 0, tables };
  },

  /* PC와 같은 원자적 업로드: 작업 UUID · 예상 전역 버전 · 예상 행 버전 */
  async upload(operations) {
    const batch = { batch_id: uuid(), expected_data_version: S.dataVersion, operations };
    let res;
    if (this.mode === "site") {
      const r = await this.bridge("upload", batch);
      if (!r.ok) throw uploadError(r.d.error || "", r.d.code || (r.status === 409 ? "40001" : ""));
      res = r.d.result;
    } else {
      const r = await this.rest("rpc/bowlingclub_atomic_upload", { method: "POST", body: JSON.stringify({ p_batch_id: batch.batch_id, p_expected_data_version: batch.expected_data_version, p_operations: operations }) });
      if (!r.ok) throw uploadError((r.d && r.d.message) || "", r.d && r.d.code);
      res = r.d;
    }
    return res;
  },
};
function uploadError(msg, code) {
  if (code === "40001" || /conflict|version/i.test(msg)) return new Error("다른 기기(PC·모바일)에서 먼저 바뀐 자료가 있어요. 최신 자료를 다시 불러온 뒤 다시 입력해 주세요.");
  if (code === "42501" || /permission/i.test(msg)) return new Error("입력 권한이 없어요. (조회 전용 계정)");
  if (code === "55P03" || /busy/i.test(msg)) return new Error("서버가 다른 저장을 처리 중이에요. 잠시 후 다시 시도해 주세요.");
  return new Error("서버에 저장하지 못했어요. " + msg);
}
const op = (entity, action, payload, expected) => { const o = { operation_id: uuid(), entity, action, payload }; if (expected != null) o.expected_row_version = expected; return o; };

/* =====================================================================
   2) 자료 (PC ClubService 와 같은 규칙)
   ===================================================================== */
const DEFAULT_GRADES = ["회장", "운영총무", "전산총무", "고문", "감사", "일반"];
const S = { year: new Date().getFullYear(), dataVersion: 0, members: [], games: [], ledger: [], fees: [], lockers: {}, lockerRows: [], quarterAdjustments: [], yearBaseSeeds: [], settings: {}, gradeTypes: [...DEFAULT_GRADES], meetingTypes: ["정모", "비모"], programTitle: "볼링클럽관리프로그램 v4", monthlyFee: 20000, rv: {} };

function buildSnapshot(snap) {
  const t = snap.tables;
  S.dataVersion = snap.dataVersion;
  S.settings = {}; for (const r of t.app_settings || []) S.settings[r.setting_key] = r.setting_value ?? "";
  S.rv = { members: {}, games: {}, ledger: {}, fees: {}, lockers: {}, quarters: {}, settings: {} };
  for (const r of t.app_settings || []) S.rv.settings[r.setting_key] = r.row_version;
  S.programTitle = S.settings.key_management_name || "볼링클럽관리프로그램 v4";
  const lines = (v) => String(v || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  S.gradeTypes = lines(S.settings.key_grade_list); if (!S.gradeTypes.length) S.gradeTypes = [...DEFAULT_GRADES];
  S.meetingTypes = lines(S.settings.key_meeting_types); if (!S.meetingTypes.length) S.meetingTypes = ["정모", "비모"];
  S.monthlyFee = int(S.settings.key_fee_amount) || 20000;
  S.members = (t.members || []).map((r) => {
    S.rv.members[r.member_id] = r.row_version;
    const g = String(r.gender || "").toUpperCase();
    return { memberId: r.member_id, name: r.name || "", phone: r.phone || "", grade: r.grade || "일반", gender: ["MALE", "M", "남"].includes(g) ? "MALE" : ["FEMALE", "F", "W", "여"].includes(g) ? "FEMALE" : null, joinDate: normDate(r.join_date), currentBaseAverage: int(r.current_base_average), feeExempt: !!r.fee_exempt, feeStartMonth: Math.min(12, Math.max(1, int(r.fee_start_month) || 1)), feeStartYear: int(r.fee_start_year), executiveThreeMonthExempt: !!r.executive_three_month_exempt, withdrawalDate: normDate(r.withdrawal_date), rejoinDate: normDate(r.rejoin_date), rejoinFeeStartMonth: int(r.rejoin_fee_start_month), rejoinFeeStartYear: int(r.rejoin_fee_start_year), deletedAt: r.deleted_at || null };
  });
  // PC/모바일/팀메이커 공통: 같은 회원+날짜+구분은 최신 record_id 1건만 사용
  const latest = new Map();
  for (const r of t.games || []) {
    S.rv.games[r.record_id] = r.row_version;
    const k = `${r.member_id}|${normDate(r.game_date)}|${(r.meeting_type || "정모").trim()}`;
    const ex = latest.get(k); if (!ex || r.record_id >= ex.record_id) latest.set(k, r);
  }
  S.games = [...latest.values()].filter((r) => normDate(r.game_date)).map((r) => ({ recordId: r.record_id, memberId: r.member_id, gameDate: normDate(r.game_date), s1: int(r.score1), s2: int(r.score2), s3: int(r.score3), s4: int(r.score4), note: r.note || "", meetingType: r.meeting_type || "정모" }));
  S.ledger = (t.ledger_entries || []).map((r) => { S.rv.ledger[r.ledger_id] = r.row_version; return { ledgerId: r.ledger_id, date: normDate(r.entry_date), type: r.type || "", category: r.category || "", amount: int(r.amount), note: r.note || "", fromFee: !!r.from_fee, memberId: int(r.member_id) }; });
  S.fees = (t.fee_payments || []).map((r) => { S.rv.fees[`${r.member_id}|${r.fee_year}|${r.fee_month}`] = r.row_version; return { feeId: r.payment_id, memberId: r.member_id, year: r.fee_year, month: r.fee_month, paidDate: normDate(r.paid_date), amount: int(r.amount), note: r.note || "" }; });
  S.lockers = {}; S.lockerRows = t.lockers || [];
  for (const r of S.lockerRows) { S.rv.lockers[r.locker_id] = r.row_version; const mid = int(r.member_id); if (mid > 0) S.lockers[mid] = { memberId: mid, lockerId: r.locker_id, mainLocker: r.locker_number || "", deposit: int(r.deposit), yearFee: int(r.yearly_fee), contractDate: r.contract_date || "", expireDate: r.expiry_date || "", status: r.status || "", note: r.note || "" }; }
  S.yearBaseSeeds = []; S.quarterAdjustments = [];
  for (const r of t.quarter_base_averages || []) {
    S.rv.quarters[`${r.member_id}|${r.year}|${r.quarter}`] = r.row_version;
    if (r.quarter === 1) S.yearBaseSeeds.push({ year: r.year, memberId: r.member_id, baseAverage: int(r.average), stored: true });
    else if (r.quarter >= 2 && r.quarter <= 4) S.quarterAdjustments.push({ year: r.year, quarter: r.quarter - 1, memberId: r.member_id, adjustedBaseAverage: int(r.average) });
  }
}

/* ----- 회원 상태 ----- */
const Svc = {
  getMembers: () => S.members.filter((m) => !m.deletedAt).sort((a, b) => a.memberId - b.memberId),
  findMember: (id) => S.members.find((m) => m.memberId === id) || null,
  isWithdrawn(m, ref = todayStr()) { if (!m || !m.withdrawalDate) return false; if (ref < m.withdrawalDate) return false; return !m.rejoinDate || ref < m.rejoinDate; },
  isShownInYear(m, y) { if (!m || m.deletedAt) return false; if (!m.withdrawalDate || yearOf(m.withdrawalDate) >= y) return true; return !!m.rejoinDate && yearOf(m.rejoinDate) <= y; },
  statusText(m) { if (m.deletedAt) return "삭제"; if (this.isWithdrawn(m)) return `탈퇴(${mmdd(m.withdrawalDate)})`; return "정상"; },
  activeInputMembers() { const r = todayStr(); return this.getMembers().filter((m) => !this.isWithdrawn(m, r)); },
  suggestNextMemberJoinDate() {
    const list = S.members.filter((m) => m.joinDate && yearOf(m.joinDate) === S.year).sort((a, b) => b.memberId - a.memberId);
    if (list.length) return addDays(list[0].joinDate, 1);
    return new Date().getFullYear() === S.year ? todayStr() : `${S.year}-01-01`;
  },
  canDeleteMember(m, ref = todayStr()) { if (!m || m.deletedAt || !this.isWithdrawn(m, ref) || !m.withdrawalDate) return false; return ref >= `${yearOf(m.withdrawalDate) + 1}-01-01`; },

  /* ----- 분기 기준에버 (PC와 같은 계산 순서) ----- */
  quarterFromDate: (d) => Math.floor((monthOf(d || todayStr()) - 1) / 3) + 1,
  findYearBaseSeed(y, id) { const s = S.yearBaseSeeds.find((x) => x.year === y && x.memberId === id); return s ? s.baseAverage : null; },
  rememberYearBaseSeed(y, id, v) { S.yearBaseSeeds = S.yearBaseSeeds.filter((x) => !(x.year === y && x.memberId === id)); S.yearBaseSeeds.push({ year: y, memberId: id, baseAverage: v }); },
  joinedInYear: (m, y) => !!m.joinDate && yearOf(m.joinDate) === y,
  existedBeforeYear: (m, y) => !!m.joinDate && yearOf(m.joinDate) < y,
  mostRecentPrevSeed(m, y) { const l = S.yearBaseSeeds.filter((s) => s.memberId === m.memberId && s.year < y && s.baseAverage > 0).sort((a, b) => b.year - a.year); return l.length ? l[0].baseAverage : null; },
  mostRecentPrevDecision(m, y) { const l = S.quarterAdjustments.filter((a) => a.memberId === m.memberId && a.year < y && a.adjustedBaseAverage > 0).sort((a, b) => b.year - a.year || b.quarter - a.quarter); return l.length ? l[0].adjustedBaseAverage : null; },
  prevYearDecision(m, y) { for (let q = 4; q >= 1; q--) { const a = S.quarterAdjustments.find((x) => x.year === y - 1 && x.quarter === q && x.memberId === m.memberId && x.adjustedBaseAverage > 0); if (a) return a.adjustedBaseAverage; } return null; },
  hasRefHistory(id, y) { return S.games.some((g) => g.memberId === id && yearOf(g.gameDate) === y) || S.quarterAdjustments.some((q) => q.memberId === id && q.year === y && q.adjustedBaseAverage > 0) || S.yearBaseSeeds.some((s) => s.memberId === id && s.year === y && s.baseAverage > 0); },
  inferSeed(m, y) { return this.prevYearDecision(m, y) || this.findYearBaseSeed(y - 1, m.memberId) || this.mostRecentPrevDecision(m, y) || this.mostRecentPrevSeed(m, y) || null; },
  normalizedSeed(m, y) {
    const st = this.findYearBaseSeed(y, m.memberId); if (st > 0) return st;
    const inf = this.inferSeed(m, y); if (inf > 0) return inf;
    if (this.joinedInYear(m, y) && m.currentBaseAverage > 0) return m.currentBaseAverage;
    const od = this.mostRecentPrevDecision(m, y); if (od > 0) return od;
    const os = this.mostRecentPrevSeed(m, y); if (os > 0) return os;
    if (!this.existedBeforeYear(m, y) && !this.hasRefHistory(m.memberId, y) && m.currentBaseAverage > 0) return m.currentBaseAverage;
    return null;
  },
  _seeded: new Set(),
  ensureYearBaseSeeds(y) {
    if (this._seeded.has(y)) return; this._seeded.add(y);
    for (const m of this.getMembers()) {
      const st = this.findYearBaseSeed(y, m.memberId); if (st > 0) continue;
      const ns = this.normalizedSeed(m, y); if (ns > 0) { this.rememberYearBaseSeed(y, m.memberId, ns); continue; }
      const inf = this.inferSeed(m, y);
      if (inf > 0) this.rememberYearBaseSeed(y, m.memberId, inf);
      else if (this.joinedInYear(m, y) && m.currentBaseAverage > 0) this.rememberYearBaseSeed(y, m.memberId, m.currentBaseAverage);
      else if (!this.existedBeforeYear(m, y) && !this.hasRefHistory(m.memberId, y)) this.rememberYearBaseSeed(y, m.memberId, m.currentBaseAverage > 0 ? m.currentBaseAverage : 0);
    }
  },
  quarterOneBase(m, y) {
    const st = this.findYearBaseSeed(y, m.memberId); if (st > 0) return st;
    const inf = this.inferSeed(m, y); if (inf > 0) return inf;
    if (this.joinedInYear(m, y) && m.currentBaseAverage > 0) return m.currentBaseAverage;
    const od = this.mostRecentPrevDecision(m, y); if (od > 0) return od;
    const os = this.mostRecentPrevSeed(m, y); if (os > 0) return os;
    if (!this.existedBeforeYear(m, y) && !this.hasRefHistory(m.memberId, y) && m.currentBaseAverage > 0) return m.currentBaseAverage;
    return null;
  },
  quarterBaseAverage(m, y, q) {
    if (!m) return 0; q = Math.max(1, Math.min(4, q));
    this.ensureYearBaseSeeds(y);
    if (q === 1) { const v = this.quarterOneBase(m, y); return v > 0 ? v : 0; }
    const prev = S.quarterAdjustments.find((a) => a.year === y && a.quarter === q - 1 && a.memberId === m.memberId && a.adjustedBaseAverage > 0);
    if (prev) return prev.adjustedBaseAverage;
    return this.quarterBaseAverage(m, y, q - 1);
  },
  decisionAverage(m, ref = todayStr()) { return m ? this.quarterBaseAverage(m, yearOf(ref), this.quarterFromDate(ref)) : null; },
  effectiveBaseAverage(m, ref = todayStr()) { return m ? this.quarterBaseAverage(m, yearOf(ref), this.quarterFromDate(ref)) : 0; },
};

async function reload(msg) {
  const snap = await Conn.snapshot();
  Svc._seeded = new Set(); Svc._weeks = {};
  buildSnapshot(snap);
  if (msg) toast(msg);
}

/* =====================================================================
   3) 화면 틀 (PC 상단 메뉴)
   ===================================================================== */
const TABS = {};       // key → { title, render }
let current = "members";
const HEADER_TABS = ["games", "ledger", "fees", "ranking", "quarter"];
const TITLES = { members: "회원관리", games: "게임기록", ledger: "회계장부", fees: "회비관리", ranking: "랭킹/현황", quarter: "분기 기준에버", lockers: "락카 사용현황", basic: "기초 자료", settings: "환경설정", contacts: "연락처(뷰)" };

function drawHeader() {
  const nav = $("pcnav"); nav.textContent = "";
  nav.append(h("button", { class: "pcbtn file", type: "button", onclick: (e) => openFileMenu(e.currentTarget) }, "FILE"));
  for (const k of HEADER_TABS) nav.append(h("button", { class: "pcbtn" + (current === k ? " on" : ""), type: "button", onclick: () => go(k) }, TITLES[k]));
  const me = Conn.me;
  $("authStatus").textContent = me ? `${me.source === "site" ? "홈페이지 " + (me.role === "admin" ? "관리자" : "운영진") : (me.isAdmin ? "관리자" : me.canWrite ? "조회+입력" : "조회 전용")}: ${me.name} · 서버 v${S.dataVersion}` : "";
  $("pchead").hidden = false;
  $("appName").textContent = TITLES[current] || "클럽관리";
}
function openFileMenu(btn) {
  const m = $("fileMenu"); m.textContent = "";
  const item = (t, fn) => h("button", { type: "button", onclick: () => { m.hidden = true; fn(); } }, t);
  m.append(item("회원관리", () => go("members")), item("락카 사용현황", () => go("lockers")), item("연락처(뷰)", () => go("contacts")), h("hr"),
    item("기초 자료", () => go("basic")), item("환경설정", () => go("settings")), item("서버 원본 동기화 (새로고침)", async () => { try { await reload("서버 최신 자료를 다시 불러왔어요."); render(); } catch (e) { toast(e.message); } }), h("hr"),
    item("로그아웃", logout));
  const r = btn.getBoundingClientRect(); m.style.left = r.left + "px"; m.style.top = r.bottom + 2 + "px"; m.hidden = false;
  setTimeout(() => document.addEventListener("click", function off(e) { if (!m.contains(e.target)) { m.hidden = true; document.removeEventListener("click", off); } }), 0);
}
function go(k) { current = k; try { history.replaceState(null, "", "#" + k); } catch {} render(); }
function render() {
  drawHeader();
  view.textContent = "";
  const t = TABS[current];
  if (!t) { view.append(h("section", { class: "pcbox" }, h("b", {}, TITLES[current] || current), h("p", { class: "pcnote" }, "이 화면은 순서대로 옮기는 중이에요. 곧 열려요."))); return; }
  try { t.render(); } catch (e) { console.error(e); view.append(h("section", { class: "pcbox" }, "화면을 그리지 못했어요: " + e.message)); }
}
const canWrite = () => !!(Conn.me && Conn.me.canWrite);
const roBadge = () => canWrite() ? null : h("span", { class: "pcro" }, "조회 전용");

/* ----- 대화상자 ----- */
function modal(title, body, buttons) {
  return new Promise((res) => {
    $("modalTitle").textContent = title; const b = $("modalBody"); b.textContent = ""; b.append(body);
    const f = $("modalFoot"); f.textContent = "";
    const close = (v) => { $("modal").hidden = true; res(v); };
    for (const [label, val, cls] of buttons) f.append(h("button", { type: "button", class: "pcbtn" + (cls ? " " + cls : ""), onclick: () => close(val) }, label));
    $("modal").hidden = false;
  });
}
const confirmBox = (msg) => modal("확인", h("p", { style: "white-space:pre-line;margin:0" }, msg), [["확인", true], ["취소", false]]);

/* ----- 표 ----- */
function pcTable(cols, rows, { onSelect, rowClass } = {}) {
  const tb = h("tbody");
  rows.forEach((r, i) => {
    const tr = h("tr", { class: rowClass ? rowClass(r, i) || "" : "" }, cols.map((c) => h("td", { class: c.cls || "" }, c.get(r, i))));
    tr.onclick = () => { tb.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel")); tr.classList.add("sel"); onSelect && onSelect(r, i); };
    if (onSelect) tr.ondblclick = () => onSelect(r, i, true);
    tb.append(tr);
  });
  return h("div", { class: "pctable-wrap" }, h("table", { class: "pct" }, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { style: c.w ? `width:${c.w}` : "" }, c.t)))), tb));
}
const selectEl = (options, value, cls = "pcsel") => { const s = h("select", { class: cls }, options.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v }, t); })); if (value != null) s.value = value; return s; };
const monthOptions = () => Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]);

/* =====================================================================
   4) 회원관리 (PC createMemberPanel / addMember / editMemberDialog)
   ===================================================================== */
const GENDER_LABEL = { MALE: "남", FEMALE: "여" };
function memberPayload(m) {
  return { member_id: m.memberId || 0, name: m.name, phone: m.phone, grade: m.grade, gender: m.gender || null, join_date: m.joinDate || "", current_base_average: m.currentBaseAverage, locker_number: "", fee_exempt: m.feeExempt, fee_start_month: m.feeStartMonth, fee_start_year: m.feeStartYear, executive_three_month_exempt: m.executiveThreeMonthExempt, withdrawal_date: m.withdrawalDate || "", rejoin_date: m.rejoinDate || "", rejoin_fee_start_month: m.rejoinFeeStartMonth, rejoin_fee_start_year: m.rejoinFeeStartYear };
}
async function save(ops, okMsg) {
  try { await Conn.upload(ops); await reload(); render(); toast(okMsg); return true; }
  catch (e) { if (/다른 기기/.test(e.message)) { try { await reload(); render(); } catch {} } toast(e.message, 4200); return false; }
}

TABS.members = {
  render() {
    const name = h("input", { class: "pcin w10", maxlength: "30" }), phone = h("input", { class: "pcin w12", maxlength: "20", inputmode: "tel" });
    const grade = selectEl(S.gradeTypes, S.gradeTypes[0]), gender = selectEl([["", "미선택"], ["MALE", "남"], ["FEMALE", "여"]], "");
    const join = h("input", { class: "pcin", type: "date", value: Svc.suggestNextMemberJoinDate() }), avg = h("input", { class: "pcin w5", inputmode: "numeric", maxlength: "3" });
    let selected = null;
    const add = h("button", { class: "pcbtn", type: "button", disabled: !canWrite() }, "회원등록");
    const edit = h("button", { class: "pcbtn", type: "button" }, "선택회원수정");
    add.onclick = async () => {
      const nm = name.value.trim(); if (!nm) return toast("이름을 입력하세요.");
      if (!/^\d+$/.test(avg.value.trim())) return toast("기준에버를 숫자로 입력하세요.");
      const m = { memberId: 0, name: nm, phone: phone.value.trim(), grade: grade.value || "일반", gender: gender.value || null, joinDate: join.value || null, currentBaseAverage: int(avg.value), feeExempt: false, feeStartMonth: 1, feeStartYear: 0, executiveThreeMonthExempt: false, withdrawalDate: null, rejoinDate: null, rejoinFeeStartMonth: 0, rejoinFeeStartYear: 0 };
      add.disabled = true;
      if (await save([op("members", "insert", memberPayload(m))], "회원이 등록되었습니다.")) { /* 화면이 새로 그려짐 */ } else add.disabled = false;
    };
    edit.onclick = () => selected ? editMember(selected) : toast("수정할 회원을 선택하세요.");
    view.append(h("section", { class: "pcbox" }, h("div", { class: "pcform" },
      h("label", {}, "회원명"), name, h("label", {}, "연락처"), phone, h("label", {}, "등급"), grade, h("label", {}, "성별"), gender,
      h("label", {}, "가입일"), join, h("label", {}, "기준에버"), avg, add, edit, roBadge())));
    const rows = Svc.getMembers().filter((m) => Svc.isShownInYear(m, S.year))
      .sort((a, b) => (Svc.isWithdrawn(a) - Svc.isWithdrawn(b)) || a.memberId - b.memberId);
    view.append(pcTable([
      { t: "순번", get: (m, i) => i + 1, w: "8%" }, { t: "회원명", get: (m) => m.name }, { t: "연락처", get: (m) => m.phone }, { t: "등급", get: (m) => m.grade },
      { t: "가입일", get: (m) => m.joinDate || "" }, { t: "기준에버", get: (m) => { const d = Svc.decisionAverage(m); return d == null ? Svc.effectiveBaseAverage(m) : d; } }, { t: "상태", get: (m) => Svc.statusText(m) },
    ], rows, { onSelect: (m, i, dbl) => { selected = m; if (dbl) editMember(m); }, rowClass: (m) => Svc.isWithdrawn(m) ? "out" : "" }));
  },
};

async function editMember(m) {
  const f = {
    name: h("input", { class: "pcin", value: m.name, maxlength: "30" }), phone: h("input", { class: "pcin", value: m.phone, maxlength: "20" }),
    grade: selectEl(S.gradeTypes.includes(m.grade) ? S.gradeTypes : [...S.gradeTypes, m.grade], m.grade), gender: selectEl([["", "미선택"], ["MALE", "남"], ["FEMALE", "여"]], m.gender || ""),
    join: h("input", { class: "pcin", type: "date", value: m.joinDate || "" }), avg: h("input", { class: "pcin", value: String(m.currentBaseAverage), inputmode: "numeric" }),
    feeExempt: h("input", { type: "checkbox" }), feeStart: selectEl(monthOptions(), String(m.feeStartYear === S.year && m.feeStartMonth >= 1 ? m.feeStartMonth : 1)),
    exec: h("input", { type: "checkbox" }), wd: h("input", { class: "pcin", type: "date", value: m.withdrawalDate || "" }), rj: h("input", { class: "pcin", type: "date", value: m.rejoinDate || "" }),
    rjMonth: selectEl(monthOptions(), String(m.rejoinFeeStartMonth >= 1 ? m.rejoinFeeStartMonth : m.rejoinDate ? monthOf(m.rejoinDate) : 1)),
  };
  f.feeExempt.checked = m.feeExempt; f.exec.checked = m.executiveThreeMonthExempt;
  const ro = !canWrite();
  if (ro) Object.values(f).forEach((x) => x.disabled = true);
  const chk = (c, t) => h("span", { class: "chk" }, c, t);
  const body = h("div", { class: "pcgrid" },
    h("label", {}, "회원명"), f.name, h("label", {}, "연락처"), f.phone, h("label", {}, "등급"), f.grade, h("label", {}, "성별"), f.gender,
    h("label", {}, "가입일"), f.join, h("label", {}, "기준에버"), f.avg, h("label", {}, "회비면제"), chk(f.feeExempt, "회비 면제"),
    h("label", {}, "첫납부월"), f.feeStart, h("label", {}, "운영진"), chk(f.exec, "3개월 면제"),
    h("label", {}, "탈퇴일자"), f.wd, h("label", {}, "재가입"), f.rj, h("label", {}, "재가입 납부월"), f.rjMonth);
  const r = await modal("선택 회원 수정", body, ro ? [["닫기", "cancel"]] : [["수정", "save"], ["취소", "cancel"], ["삭제", "delete"]]);
  if (r === "save") {
    if (!/^\d+$/.test(f.avg.value.trim())) return toast("기준에버를 숫자로 입력하세요.");
    const wd = f.wd.value || null, rj = f.rj.value || null;
    if (wd && rj && !(rj > wd)) return toast("재가입일자는 탈퇴일자 이후로 선택하세요.");
    const n = { ...m, name: f.name.value.trim(), phone: f.phone.value.trim(), grade: f.grade.value || "일반", gender: f.gender.value || null, joinDate: f.join.value || null,
      currentBaseAverage: int(f.avg.value), feeExempt: f.feeExempt.checked, feeStartMonth: Math.min(12, Math.max(1, int(f.feeStart.value))), feeStartYear: S.year,
      executiveThreeMonthExempt: f.exec.checked, withdrawalDate: wd, rejoinDate: rj, rejoinFeeStartMonth: rj ? Math.min(12, Math.max(1, int(f.rjMonth.value))) : 0, rejoinFeeStartYear: rj ? yearOf(rj) : 0 };
    if (!n.name) return toast("이름을 입력하세요.");
    await save([op("members", "update", memberPayload(n), S.rv.members[m.memberId])], "회원 정보가 수정되었습니다.");
  } else if (r === "delete") {
    if (!Svc.canDeleteMember(m)) {
      const y = m.withdrawalDate ? yearOf(m.withdrawalDate) % 100 : (new Date().getFullYear()) % 100;
      return toast(m.withdrawalDate ? `${pad2(y)}년이 지나지 않아 삭제 불가합니다.` : "삭제할 수 없는 회원입니다.");
    }
    toast("서버 회원 자료는 삭제하지 않아요. (PC·모바일과 같은 규칙: 탈퇴일자로 관리)", 3600);
  }
}

/* =====================================================================
   5) 게임기록 (PC createGamePanel · addGame · editGameDialog · 보고서)
   ===================================================================== */
const gsum = (g) => [g.s1, g.s2, g.s3, g.s4].filter((x) => x > 0).reduce((a, b) => a + b, 0);
const gcnt = (g) => [g.s1, g.s2, g.s3, g.s4].filter((x) => x > 0).length;
const gavg = (g) => gcnt(g) ? gsum(g) / gcnt(g) : 0;
const gbest = (g) => Math.max(g.s1, g.s2, g.s3, g.s4);
const fmt1 = (d) => (Math.round(d * 10 + (d >= 0 ? 1e-9 : -1e-9)) / 10).toFixed(1);
const signed1 = (d) => (d >= 0 ? "+" : "") + fmt1(d);
const scoreDisplay = (n) => n > 0 ? String(n) : "";
const meetingOf = (g) => (g.meetingType || "").trim() || "정모";
const noteHas = (g, w) => (g.note || "").replace(/\s+/g, "").includes(w);
function noteForDisplay(g, base) {
  const note = g.note || ""; const m = note.match(/에버\s*하이(\s*:\s*[+-]?\d+)?/);
  if (!m) return note;
  const diff = gbest(g) - base;
  return note.slice(0, m.index) + "에버하이 : " + (diff >= 0 ? "+" : "-") + Math.abs(diff) + note.slice(m.index + m[0].length);
}
Object.assign(Svc, {
  _weeks: {},
  basicWeeks(y) {
    if (this._weeks[y]) return this._weeks[y];
    const out = [];
    for (let mo = 1; mo <= 12; mo++) {
      const d = new Date(y, mo - 1, 1); while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
      let n = 0; while (d.getMonth() === mo - 1) { n++; out.push({ date: `${y}-${pad2(mo)}-${pad2(d.getDate())}`, label: `${mo}월 ${n}주차` }); d.setDate(d.getDate() + 7); }
    }
    return (this._weeks[y] = out);
  },
  weekSortKey(l) { const m = String(l).match(/^(\d+)월\s*(\d+)주차$/); return m ? +m[1] * 10 + +m[2] : 1e9; },
  resolveWeekLabel(d) { const ws = this.basicWeeks(yearOf(d)).filter((w) => w.date <= d); if (ws.length) return ws[ws.length - 1].label; const all = this.basicWeeks(yearOf(d)); return all.length ? all[0].label : d; },
  displayGameDate(d) { return this.resolveWeekLabel(d); },
  findWeekDateByLabel(l) {
    if (!l) return null;
    const hit = (y) => (this.basicWeeks(y).find((w) => w.label === l) || {}).date || null;
    const cur = hit(S.year); if (cur) return cur;
    const ys = new Set([S.year, ...S.games.map((g) => yearOf(g.gameDate)), ...S.quarterAdjustments.map((q) => q.year)]);
    for (const y of ys) { const f = hit(y); if (f) return f; }
    return null;
  },
  resolveReferenceDateFromWeekLabel(l) {
    if (!l || l === "주차 없음") return `${S.year}-01-01`;
    const f = this.findWeekDateByLabel(l); if (f) return f;
    const m = String(l).match(/(\d{1,2})\s*월/); const mo = Math.max(1, Math.min(12, m ? +m[1] : 1));
    return `${S.year}-${pad2(mo)}-01`;
  },
  recordedWeekLabels() { return [...new Set(S.games.filter((g) => yearOf(g.gameDate) === S.year).map((g) => this.displayGameDate(g.gameDate)))].sort((a, b) => this.weekSortKey(a) - this.weekSortKey(b)); },
  suggestNextGameWeekLabel() {
    const weeks = this.basicWeeks(S.year); if (!weeks.length) return "";
    const ys = S.games.filter((g) => yearOf(g.gameDate) === S.year);
    if (ys.length) {
      const latest = ys.reduce((a, b) => b.recordId > a.recordId ? b : a).gameDate;
      const ref = this.findWeekDateByLabel(this.displayGameDate(latest)) || latest;
      const nx = weeks.find((w) => w.date > ref); if (nx) return nx.label;
    }
    return this.resolveWeekLabel(todayStr());
  },
  gameInputWeekLabels(work = todayStr()) {
    const avail = this.basicWeeks(yearOf(work)).filter((w) => w.date <= work).map((w) => w.label).sort((a, b) => this.weekSortKey(a) - this.weekSortKey(b));
    const out = []; const nx = this.suggestNextGameWeekLabel(); if (nx) out.push(nx);
    const cur = this.resolveWeekLabel(work); if (avail.includes(cur) && !out.includes(cur)) out.push(cur);
    for (let i = avail.length - 1; i >= 0; i--) if (!out.includes(avail[i])) out.push(avail[i]);
    return out;
  },
  displaySeq(id) { const l = this.getMembers(); const i = l.findIndex((m) => m.memberId === id); return i < 0 ? 0 : i + 1; },
  weeklyGames(label) {
    const rows = S.games.filter((g) => yearOf(g.gameDate) === S.year && this.displayGameDate(g.gameDate) === label && this.findMember(g.memberId));
    return rows.sort((a, b) => gavg(b) - gavg(a) || (this.displaySeq(a.memberId) || 1e9) - (this.displaySeq(b.memberId) || 1e9) || b.recordId - a.recordId);
  },
  allGamesInInputOrder() { return S.games.filter((g) => this.findMember(g.memberId)).sort((a, b) => a.recordId - b.recordId); },
  gamesByMember(id) { return this.findMember(id) ? S.games.filter((g) => g.memberId === id).sort((a, b) => a.recordId - b.recordId) : []; },
  recordedMemberIdsForMeeting(d, type) { const t = (type || "").trim() || "정모"; return new Set(S.games.filter((g) => g.gameDate === d && meetingOf(g) === t).map((g) => g.memberId)); },
  gamesForMeeting(d, type) { const t = (type || "").trim() || "정모"; return S.games.filter((g) => g.gameDate === d && meetingOf(g) === t).sort((a, b) => a.recordId - b.recordId); },
  canonicalRankingGames(y) {
    const map = new Map();
    for (const g of S.games) { if (yearOf(g.gameDate) !== y) continue; const t = meetingOf(g); if (t !== "정모" && t !== "비모") continue; const k = `${g.memberId}|${g.gameDate}|${t}`; const ex = map.get(k); if (!ex || g.recordId >= ex.recordId) map.set(k, g); }
    return [...map.values()];
  },
  aggregateAverage(rows) { let s = 0, c = 0; for (const g of rows) { s += gsum(g); c += gcnt(g); } return c ? s / c : 0; },
  cumulativeAverage(id, y, q) { const st = (Math.max(1, q) - 1) * 3 + 1, en = st + 2; if (!this.findMember(id)) return 0; return this.aggregateAverage(this.canonicalRankingGames(y).filter((g) => g.memberId === id && monthOf(g.gameDate) >= st && monthOf(g.gameDate) <= en)); },
  recent4WeekLabels() { const l = [...new Set(S.games.filter((g) => yearOf(g.gameDate) === S.year).map((g) => this.resolveWeekLabel(g.gameDate)))].sort((a, b) => this.weekSortKey(a) - this.weekSortKey(b)); return l.length <= 4 ? l : l.slice(l.length - 4); },
  cumulativeRows(target) {
    const labels = [...target]; while (labels.length < 4) labels.push("");
    const refs = labels.filter(Boolean).map((l) => this.resolveReferenceDateFromWeekLabel(l)).filter(Boolean).sort();
    const ref = refs.length ? refs[refs.length - 1] : `${S.year}-01-01`; const q = this.quarterFromDate(ref), ty = yearOf(ref);
    const rows = [];
    for (const m of this.getMembers()) {
      if (this.isWithdrawn(m)) continue;
      const mg = S.games.filter((g) => g.memberId === m.memberId && yearOf(g.gameDate) === S.year).sort((a, b) => a.gameDate < b.gameDate ? -1 : a.gameDate > b.gameDate ? 1 : 0);
      if (!mg.length) continue;
      const byWeek = new Map(); for (const g of mg) byWeek.set(this.resolveWeekLabel(g.gameDate), g);
      const cells = labels.map((l) => l ? byWeek.get(l) || null : null);
      rows.push({ seq: this.displaySeq(m.memberId), name: m.name, base: this.quarterBaseAverage(m, ty, q), qavg: this.cumulativeAverage(m.memberId, ty, q), att: mg.length, cells });
    }
    return rows;
  },
});
const weekCellText = (g) => { if (!g) return ""; const p = [g.s1, g.s2, g.s3, g.s4].filter((x) => x > 0); const a = gcnt(g) ? `(${gavg(g).toFixed(1)})` : ""; return [p.join(" / "), a].filter(Boolean).join(" "); };

/* 점수 칸 강조 (PC ScoreHighlightState 와 같은 규칙) */
function highlights(rows, mode, memberId) {
  const orange = new Set(), red = new Set(), rowColor = {}, strong = {};
  const key = (i, c) => i + ":" + c, cols = ["s1", "s2", "s3", "s4"];
  rows.forEach((g, i) => cols.forEach((c) => { if (g[c] >= 200) orange.add(key(i, c)); }));
  const markMax = (cand, filterRow) => { const mx = Math.max(0, ...cand.map(gbest)); if (mx <= 0) return; rows.forEach((g, i) => { if (filterRow && !filterRow(g)) return; cols.forEach((c) => { if (g[c] === mx) red.add(key(i, c)); }); }); };
  if (mode === "member" && memberId != null) {
    const lim = S.year < new Date().getFullYear() ? 12 : new Date().getMonth() + 1;
    const inRange = (g) => yearOf(g.gameDate) === S.year && monthOf(g.gameDate) <= lim;
    markMax(Svc.gamesByMember(memberId).filter(inRange), inRange);
  } else if (mode === "simple") markMax(rows);
  else if (mode === "weekly") {
    const nonReg = rows.every((g) => meetingOf(g).includes("비모"));
    const prim = nonReg ? rows : rows.filter((g) => (g.note || "").replace(/ /g, "").includes("최고하이"));
    const hasHigh = !nonReg && prim.length > 0;
    markMax(hasHigh ? prim : rows, hasHigh ? (g) => (g.note || "").replace(/ /g, "").includes("최고하이") : null);
    // 모임기록 표시룰: 최고하이(노랑) > 에버하이(파랑) > 올카(초록) — 정모만
    const reg = [], baseOf = {};
    rows.forEach((g, i) => { if (meetingOf(g) !== "정모") return; reg.push(i); const m = Svc.findMember(g.memberId); baseOf[i] = m ? Svc.effectiveBaseAverage(m, g.gameDate) : 0; });
    let hi = -1, ev = -1;
    if (reg.length) {
      const marked = reg.filter((i) => noteHas(rows[i], "최고하이")); const pool = marked.length ? marked : reg.filter((i) => gbest(rows[i]) > 0);
      for (const i of pool) { if (hi < 0) { hi = i; continue; } const bi = gbest(rows[i]), bh = gbest(rows[hi]); if (bi > bh || (bi === bh && baseOf[i] > baseOf[hi])) hi = i; }
      const hm = hi < 0 ? null : rows[hi].memberId;
      const me = reg.filter((i) => rows[i].memberId !== hm && noteHas(rows[i], "에버하이")); const ep = me.length ? me : reg.filter((i) => rows[i].memberId !== hm && gbest(rows[i]) > 0 && baseOf[i] > 0);
      for (const i of ep) { if (ev < 0) { ev = i; continue; } const di = gbest(rows[i]) - baseOf[i], de = gbest(rows[ev]) - baseOf[ev]; if (di > de || (di === de && baseOf[i] > baseOf[ev])) ev = i; }
    }
    const hm = hi < 0 ? null : rows[hi].memberId, em = ev < 0 ? null : rows[ev].memberId;
    for (const i of reg) {
      const g = rows[i], isH = i === hi, isA = i === ev, isAll = noteHas(g, "올카") && g.memberId !== hm && g.memberId !== em;
      if (isH) rowColor[i] = "hi"; else if (isA) rowColor[i] = "ev"; else if (isAll) rowColor[i] = "all";
      if (isH || isA) { const b = gbest(g); cols.forEach((c) => { if (b > 0 && g[c] === b) strong[key(i, c)] = isH ? "shi" : "sev"; }); }
    }
  }
  return { cell: (i, c) => strong[key(i, c)] || (red.has(key(i, c)) ? "red" : orange.has(key(i, c)) ? "orange" : ""), row: (i) => rowColor[i] ? "mk-" + rowColor[i] : "" };
}
function gameRowsTable(rows, mode, memberId, { includeMember = true, includeDate = true, seq = true, onSelect } = {}) {
  const hl = highlights(rows, mode, memberId);
  const base = (g) => { const m = Svc.findMember(g.memberId); return m ? Svc.effectiveBaseAverage(m, g.gameDate) : 0; };
  const cols = [];
  if (seq) cols.push({ t: "순번", get: (g, i) => i + 1 });
  if (includeMember) cols.push({ t: "회원명(에버)", get: (g) => `${(Svc.findMember(g.memberId) || {}).name || ""}(${base(g)})` });
  if (includeDate) cols.push({ t: "게임일", get: (g) => Svc.displayGameDate(g.gameDate) });
  ["s1", "s2", "s3", "s4"].forEach((c, k) => cols.push({ t: `${k + 1}G`, get: (g, i) => h("span", { class: "sc " + hl.cell(i, c) }, scoreDisplay(g[c])) }));
  cols.push({ t: "평균", get: (g) => fmt1(gavg(g)) }, { t: "에버편차", get: (g) => signed1(gavg(g) - base(g)) }, { t: "비고", get: (g) => noteForDisplay(g, base(g)), cls: "note" });
  return pcTable(cols, rows, { onSelect, rowClass: (g, i) => hl.row(i) });
}
function reportModal(title, subtitle, content) {
  const body = h("div", { class: "rpt" }, h("div", { class: "rpt-h" }, h("b", {}, title), subtitle ? h("span", {}, subtitle) : null), content);
  $("modal").classList.add("wide");
  return modal(title, body, [["인쇄", "print"], ["닫기", "close"]]).then((r) => { $("modal").classList.remove("wide"); if (r === "print") printNode(body); });
}
function printNode(node) {
  const w = window.open("", "_blank"); if (!w) return toast("팝업이 막혀 있어요.");
  w.document.write(`<html><head><title>인쇄</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/club.css"></head><body class="pc print">${node.outerHTML}</body></html>`);
  w.document.close(); setTimeout(() => w.print(), 400);
}

const GV = { mode: "all", memberId: null, week: "", inputWeek: null, meeting: null, inMember: null, searchMember: null, sel: null };
function gamePayload(g) { return { record_id: g.recordId || 0, member_id: g.memberId, game_date: g.gameDate, score1: g.s1, score2: g.s2, score3: g.s3, score4: g.s4, note: g.note || "", meeting_type: g.meetingType || "정모" }; }
function parseScore(v, label) { v = String(v || "").trim(); if (!v) return 0; if (!/^\d+$/.test(v)) { toast(`${label} 점수를 숫자로 입력하세요.`); return null; } const n = +v; if (n < 0 || n > 300) { toast(`${label} 점수는 0~300 사이여야 합니다.`); return null; } return n; }

TABS.games = {
  render() {
    const labels = Svc.gameInputWeekLabels();
    if (!GV.inputWeek || !labels.includes(GV.inputWeek)) GV.inputWeek = Svc.suggestNextGameWeekLabel() && labels.includes(Svc.suggestNextGameWeekLabel()) ? Svc.suggestNextGameWeekLabel() : labels[0] || "주차 없음";
    const defMeeting = (l) => /1주차|3주차/.test((l || "").replace(/ /g, "")) ? "정모" : "비모";
    if (!GV.meeting) GV.meeting = defMeeting(GV.inputWeek);
    const weekSel = selectEl(labels.length ? labels : ["주차 없음"], GV.inputWeek);
    const meetOpts = [...S.meetingTypes]; if (!meetOpts.includes(GV.meeting)) meetOpts.push(GV.meeting);
    const meet = h("input", { class: "pcin w8", list: "meetList", value: GV.meeting });
    const dl = h("datalist", { id: "meetList" }, meetOpts.map((x) => h("option", { value: x })));
    const memSel = h("select", { class: "pcsel" });
    const fillMembers = () => {
      const d = Svc.findWeekDateByLabel(weekSel.value) || (weekSel.value !== "주차 없음" ? Svc.resolveReferenceDateFromWeekLabel(weekSel.value) : null);
      const rec = d ? Svc.recordedMemberIdsForMeeting(d, meet.value) : new Set();
      const items = Svc.activeInputMembers().filter((m) => !rec.has(m.memberId));
      memSel.textContent = ""; items.forEach((m) => memSel.append(h("option", { value: m.memberId }, m.name)));
      if (GV.inMember && items.some((m) => m.memberId === GV.inMember)) memSel.value = GV.inMember;
    };
    weekSel.onchange = () => { GV.inputWeek = weekSel.value; meet.value = GV.meeting = defMeeting(weekSel.value); fillMembers(); };
    meet.onchange = () => { GV.meeting = meet.value.trim() || "정모"; fillMembers(); };
    memSel.onchange = () => GV.inMember = +memSel.value;
    fillMembers();
    const sc = [1, 2, 3, 4].map(() => h("input", { class: "pcin w5", inputmode: "numeric", maxlength: "3" }));
    sc.forEach((x, i) => x.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); (sc[i + 1] || note).focus(); } });
    const note = h("input", { class: "pcin w20", maxlength: "100" });
    note.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
    const addBtn = h("button", { class: "pcbtn", type: "button", disabled: !canWrite() }, "등록");
    addBtn.onclick = async () => {
      const mid = +memSel.value; if (!mid) return toast("회원명을 선택하세요.");
      const s = sc.map((x, i) => parseScore(x.value, `${i + 1}G`)); if (s.some((x) => x == null)) return;
      const d = weekSel.value === "주차 없음" ? null : (Svc.findWeekDateByLabel(weekSel.value) || Svc.resolveReferenceDateFromWeekLabel(weekSel.value));
      if (!d) return toast("게임일 주차를 선택하세요.");
      const mt = meet.value.trim() || "정모";
      const opts = [...memSel.options]; const idx = opts.findIndex((o) => +o.value === mid); const next = opts[idx + 1] || (opts.length > 1 ? opts[0] : null);
      addBtn.disabled = true;
      const g = { recordId: 0, memberId: mid, gameDate: d, s1: s[0], s2: s[1], s3: s[2], s4: s[3], note: note.value.trim(), meetingType: mt };
      if (await save([op("games", "insert", gamePayload(g))], "게임 기록이 저장되었습니다.")) {
        GV.inMember = next && +next.value !== mid ? +next.value : null; GV.mode = "weekly"; GV.week = weekSel.value; GV.meeting = mt;
        render(); setTimeout(() => { const f = view.querySelector("input.pcin.w5"); f && f.focus(); }, 50);
      } else addBtn.disabled = false;
    };
    const editBtn = h("button", { class: "pcbtn", type: "button" }, "수정");
    editBtn.onclick = () => GV.sel ? editGame(GV.sel) : toast("수정할 기록을 선택하세요.");

    const allMembers = Svc.getMembers();
    if (GV.searchMember == null && allMembers.length) GV.searchMember = allMembers[0].memberId;
    const searchSel = selectEl(allMembers.map((m) => [String(m.memberId), m.name]), String(GV.searchMember)); searchSel.onchange = () => GV.searchMember = +searchSel.value;
    const wl = [...Svc.recordedWeekLabels()].reverse();
    if (!GV.week || !wl.includes(GV.week)) { const cur = Svc.resolveWeekLabel(todayStr()); GV.week = wl.includes(GV.inputWeek) ? GV.inputWeek : wl.includes(cur) ? cur : wl[0] || "주차 없음"; }
    const weekly = selectEl(wl.length ? wl : ["주차 없음"], GV.week); weekly.onchange = () => { GV.week = weekly.value; if (wl.length) { GV.mode = "weekly"; render(); } };
    const b = (t, fn) => h("button", { class: "pcbtn", type: "button", onclick: fn }, t);
    view.append(h("section", { class: "pcbox" }, dl, h("div", { class: "pcform" },
      h("label", {}, "게임일"), weekSel, h("label", {}, "모임 구분"), meet, h("label", {}, "회원명"), memSel,
      ...sc.flatMap((x, i) => [h("label", {}, `${i + 1}G`), x]), h("label", {}, "비고"), note, addBtn, editBtn, roBadge())),
      h("section", { class: "pcbox" }, h("div", { class: "pcform" },
        h("label", {}, "회원명 조회"), searchSel, h("label", {}, "주차별"), weekly,
        b("회원별 조회", () => { GV.mode = "member"; GV.memberId = +searchSel.value; render(); }),
        b("주차별 조회", () => { if (!wl.length) return toast("조회할 주차를 선택하세요."); if (!Svc.weeklyGames(weekly.value).length) return toast("선택한 주차의 게임기록이 없습니다."); GV.mode = "weekly"; GV.week = weekly.value; render(); }),
        b("전체 조회", () => { GV.mode = "all"; render(); }),
        h("span", { style: "width:10px" }), h("label", {}, "보고서"),
        b("개인 기록", () => memberReport(+searchSel.value)), b("모임 기록", () => meetingReport(weekly.value)), b("누적 조회", cumulativeReport),
        b("모임구분 일괄변경", changeMeetingType))));
    let rows, mode = GV.mode;
    const byDateDesc = (a, b) => (a.gameDate < b.gameDate ? 1 : a.gameDate > b.gameDate ? -1 : 0) || b.recordId - a.recordId;
    if (mode === "member") rows = Svc.gamesByMember(GV.memberId).sort(byDateDesc);
    else if (mode === "weekly") { rows = Svc.weeklyGames(GV.week); if (!rows.length) { mode = "all"; } }
    if (mode === "all") rows = Svc.allGamesInInputOrder().sort(byDateDesc);
    GV.rows = rows; GV.sel = null;
    view.append(gameRowsTable(rows, mode, GV.memberId, { onSelect: (g, i, dbl) => { GV.sel = g; if (dbl) editGame(g); } }));
  },
};

async function editGame(rec) {
  const ms = Svc.getMembers();
  const f = { member: selectEl(ms.map((m) => [String(m.memberId), m.name]), String(rec.memberId)), date: h("input", { class: "pcin", type: "date", value: rec.gameDate }),
    meeting: selectEl([...new Set([...S.meetingTypes, meetingOf(rec)])], meetingOf(rec)), s: [rec.s1, rec.s2, rec.s3, rec.s4].map((v) => h("input", { class: "pcin", value: scoreDisplay(v), inputmode: "numeric" })), note: h("input", { class: "pcin", value: rec.note || "" }) };
  const ro = !canWrite(); if (ro) [f.member, f.date, f.meeting, f.note, ...f.s].forEach((x) => x.disabled = true);
  const body = h("div", { class: "pcgrid" }, h("label", {}, "회원명"), f.member, h("label", {}, "게임일"), f.date, h("label", {}, "모임구분"), f.meeting,
    ...f.s.flatMap((x, i) => [h("label", {}, `${i + 1}G`), x]), h("label", {}, "비고"), f.note);
  const r = await modal("기록 수정", body, ro ? [["닫기", "c"]] : [["수정", "save"], ["취소", "c"], ["삭제", "del"]]);
  const rv = S.rv.games[rec.recordId];
  if (r === "save") {
    const s = f.s.map((x, i) => parseScore(x.value, `${i + 1}G`)); if (s.some((x) => x == null)) return;
    if (!f.date.value) return toast("게임일을 입력하세요.");
    const n = { ...rec, memberId: +f.member.value, gameDate: f.date.value, s1: s[0], s2: s[1], s3: s[2], s4: s[3], note: f.note.value.trim(), meetingType: f.meeting.value || meetingOf(rec) };
    await save([op("games", "update", gamePayload(n), rv)], "기록이 수정되었습니다.");
  } else if (r === "del") {
    if (!(await confirmBox("선택한 게임 기록을 삭제하시겠습니까?"))) return;
    await save([op("games", "delete", gamePayload(rec), rv)], "게임 기록이 삭제되었습니다.");
  }
}
async function changeMeetingType() {
  if (!canWrite()) return toast("입력 권한이 없어요. (조회 전용 계정)");
  const sel = GV.sel, weekly = !sel && GV.mode === "weekly" && GV.rows && GV.rows.length;
  if (!sel && !weekly) return toast("모임구분을 바꿀 기록을 한 줄 선택하거나, 주차별 리스트에서 주차를 선택하세요.", 4000);
  const from = [], dates = [];
  if (sel) { from.push(meetingOf(sel)); dates.push(sel.gameDate); }
  else for (const g of GV.rows) { if (!from.includes(meetingOf(g))) from.push(meetingOf(g)); if (!dates.includes(g.gameDate)) dates.push(g.gameDate); }
  const opts = [...S.meetingTypes]; from.forEach((t) => { if (!opts.includes(t)) opts.push(t); });
  const fromSel = selectEl(from, from[0]), toSel = selectEl(opts);
  const sug = () => { toSel.value = opts.find((v) => v !== fromSel.value) || fromSel.value; }; sug(); fromSel.onchange = sug;
  const dateText = dates.length === 1 ? dates[0] : `${dates.length}개 게임일`;
  const body = h("div", { class: "pcgrid" }, h("label", {}, "게임일"), h("span", {}, dateText), h("label", {}, "대상 범위"), h("span", {}, sel ? "선택 기록과 같은 모임" : `${GV.week} 전체`),
    h("label", {}, "현재 모임구분"), from.length > 1 ? fromSel : h("span", {}, from[0]), h("label", {}, "바꿀 모임구분"), toSel);
  if ((await modal("모임구분 일괄변경", body, [["일괄 변경", "ok"], ["취소", "c"]])) !== "ok") return;
  const ft = from.length > 1 ? fromSel.value : from[0], tt = toSel.value;
  if (!tt || tt === ft) return toast("현재 모임구분과 같아 변경할 내용이 없습니다.");
  const ops = [];
  for (const d of dates) {
    const targets = Svc.gamesForMeeting(d, ft); if (!targets.length) continue;
    const already = new Set(Svc.gamesForMeeting(d, tt).map((g) => g.memberId));
    const dup = [...new Set(targets.filter((g) => already.has(g.memberId)).map((g) => (Svc.findMember(g.memberId) || {}).name || "ID " + g.memberId))];
    if (dup.length) return toast(`${d} '${tt}' 모임에 이미 기록이 있는 회원이 있어 변경할 수 없습니다: ${dup.join(", ")}`, 5000);
    for (const g of targets) ops.push(op("games", "update", gamePayload({ ...g, meetingType: tt }), S.rv.games[g.recordId]));
  }
  if (!ops.length) return toast("선택한 모임의 기록을 찾을 수 없습니다.");
  await save(ops, `${dateText} ${ft} 모임의 기록 ${ops.length}건을 '${tt}'(으)로 변경했습니다.`);
}
function memberReport(id) {
  const m = Svc.findMember(id); if (!m) return toast("조회할 회원을 선택하세요.");
  const rows = Svc.gamesByMember(id).sort((a, b) => (a.gameDate < b.gameDate ? 1 : a.gameDate > b.gameDate ? -1 : 0) || b.recordId - a.recordId);
  if (!rows.length) return toast("선택한 회원의 게임기록이 없습니다.");
  const cnt = rows.reduce((a, g) => a + gcnt(g), 0);
  reportModal("개인 기록", `${m.name}(${cnt}게임 / ${fmt1(Svc.aggregateAverage(rows))})`, gameRowsTable(rows, "simple", null, { includeMember: false, seq: false }));
}
function meetingReport(label) {
  if (!label || label === "주차 없음") return toast("조회할 주차를 선택하세요.");
  const rows = Svc.weeklyGames(label).filter((g) => { const m = Svc.findMember(g.memberId); return m && !Svc.isWithdrawn(m); }).sort((a, b) => gavg(b) - gavg(a) || b.recordId - a.recordId);
  if (!rows.length) return toast("선택한 주차의 게임기록이 없습니다.");
  reportModal("모임 기록", label, gameRowsTable(rows, "weekly", null, { includeDate: false, seq: false }));
}
function cumulativeReport() {
  const labels = Svc.recent4WeekLabels(); const rows = Svc.cumulativeRows(labels);
  if (!rows.length) return toast("누적 조회할 게임기록이 없습니다.");
  while (labels.length < 4) labels.push("");
  reportModal("모임 누적 현황", "", pcTable([{ t: "순번", get: (r) => r.seq }, { t: "회원명(에버)", get: (r) => `${r.name}(${r.base})` }, { t: "누적에버", get: (r) => fmt1(r.qavg) }, { t: "출석일수", get: (r) => r.att },
    ...labels.map((l, i) => ({ t: l || " ", cls: "r", get: (r) => { const t = weekCellText(r.cells[i]); const k = t.lastIndexOf("("); return k < 0 ? t : h("span", {}, t.slice(0, k), h("b", {}, t.slice(k))); } }))], rows));
}

/* =====================================================================
   5) 로그인 화면 · 시작
   ===================================================================== */
function loginView(reason) {
  $("pchead").hidden = true; $("appName").textContent = "클럽관리";
  view.textContent = "";
  const id = h("input", { class: "pcin", placeholder: "모바일 볼링클럽 아이디", autocomplete: "username", autocapitalize: "off", maxlength: "20" });
  const pw = h("input", { class: "pcin", type: "password", placeholder: "비밀번호", autocomplete: "current-password" });
  const msg = h("div", { class: "msg" + (reason ? " info" : "") }, reason === "site_member" ? "홈페이지 관리자·운영진만 홈페이지 계정으로 들어올 수 있어요. 모바일 볼링클럽 계정으로 로그인해 주세요."
    : reason === "not_approved" ? "아직 승인되지 않은 모바일 계정이에요. 관리자 승인 후 이용할 수 있어요." : reason === "expired" ? "로그인이 만료되었어요. 다시 로그인해 주세요." : "");
  const go2 = h("button", { class: "btn", type: "button" }, "로그인");
  go2.onclick = async () => {
    if (!id.value.trim() || !pw.value) { msg.className = "msg err"; msg.textContent = "아이디와 비밀번호를 입력해 주세요."; return; }
    go2.disabled = true;
    try { await Conn.loginMobile(id.value.trim(), pw.value); await boot(); }
    catch (e) { msg.className = "msg err"; msg.textContent = e.message; go2.disabled = false; }
  };
  pw.onkeydown = (e) => { if (e.key === "Enter") go2.click(); };
  const box = h("section", { class: "card pclogin" }, h("h2", {}, "🎳 클럽관리 로그인"),
    h("p", { class: "lead" }, "PC·모바일 볼링클럽과 같은 서버 자료를 사용해요. 계정 권한(관리자 / 조회+입력 / 조회 전용)이 그대로 적용돼요."),
    id, pw, msg, go2);
  if (!Conn.siteToken()) box.append(h("div", { class: "orline" }, "또는"), h("a", { class: "btn ghost", href: "/apps?next=%2Fhome" }, "홈페이지 관리자·운영진 인증하기"), h("small", { class: "mut", style: "display:block;margin-top:6px" }, "인증 후 다시 클럽관리를 열면 바로 들어와요."));
  view.append(box);
}
async function logout() {
  if (Conn.mode === "site") { if (!(await confirmBox("홈페이지 계정으로 들어와 있어요.\n클럽관리에서만 나가고, 모바일 계정으로 로그인 화면을 열까요?"))) return; }
  await Conn.logout(); sessionStorage.setItem("clubSkipSite", "1"); loginView();
}
async function boot() {
  view.textContent = ""; view.append(h("section", { class: "card" }, h("p", { class: "tag" }, "서버 자료를 불러오는 중…")));
  let st;
  if (sessionStorage.getItem("clubSkipSite") && !Conn.mobile()) st = { need: "login" };
  else st = await Conn.start();
  if (st.need) return loginView(st.reason);
  try { await reload(); } catch (e) { if (e.message === "login") return loginView("expired"); view.textContent = ""; view.append(h("section", { class: "card" }, "자료를 불러오지 못했어요: " + e.message)); return; }
  const k = location.hash.replace("#", ""); if (TITLES[k]) current = k;
  render();
}
boot();
