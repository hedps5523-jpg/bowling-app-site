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
  Svc._seeded = new Set();
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
