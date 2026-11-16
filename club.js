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
      if (r.ok) {
        if (!r.d.linked) return { need: "link", site: r.d.site };
        if (!r.d.me) return { need: "link", site: r.d.site, reason: "not_approved", club: r.d.club };
        this.mode = "site"; this.me = r.d.me; return { ok: true };
      }
      if (r.status === 403) return { need: "login", reason: "site_member" };
    }
    return { need: "login" };
  },
  async linkClub(loginId, password) {
    const r = await this.bridge("link", { login_id: loginId, password });
    if (!r.ok) {
      const e = r.d.error;
      throw new Error(e === "locked" ? "시도 횟수를 넘었어요. 15분 뒤에 다시 시도해 주세요." : e === "already_linked" ? "이 클럽 계정은 이미 다른 홈페이지 계정에 연결되어 있어요." : e === "not_approved" ? "아직 승인되지 않은 클럽 계정이에요. 관리자 승인 후 연결할 수 있어요." : e === "expired" ? "홈페이지 인증이 만료되었어요. 다시 인증해 주세요." : "클럽 아이디 또는 비밀번호가 맞지 않아요.");
    }
  },
  async unlinkClub() { const r = await this.bridge("unlink"); if (!r.ok) throw new Error("연결을 해제하지 못했어요."); },
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
  S.yearBaseSeeds = []; S.quarterAdjustments = []; S.sq = {};
  for (const r of t.quarter_base_averages || []) {
    S.sq[`${r.member_id}|${r.year}|${r.quarter}`] = int(r.average);
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
const TITLES = { members: "회원관리", games: "게임기록", ledger: "회계장부", fees: "회비관리", ranking: "랭킹/현황", quarter: "분기 기준에버", lockers: "락카 사용현황", settings: "환경설정", contacts: "연락처(뷰)" };

function drawHeader() {
  const nav = $("pcnav"); nav.textContent = "";
  nav.append(h("button", { class: "pcbtn file", type: "button", onclick: (e) => openFileMenu(e.currentTarget) }, "FILE"));
  for (const k of HEADER_TABS) nav.append(h("button", { class: "pcbtn" + (current === k ? " on" : ""), type: "button", onclick: () => go(k) }, TITLES[k]));
  const me = Conn.me;
  const permTxt = (m) => m.isAdmin ? "관리자" : m.canWrite ? "조회+입력" : "조회 전용";
  $("authStatus").textContent = me ? (me.source === "site" ? `홈페이지 ${me.siteRole === "admin" ? "관리자" : "운영진"} ${me.siteName} · 클럽계정 ${me.loginId}(${permTxt(me)}) · 서버 v${S.dataVersion}` : `${permTxt(me)}: ${me.name} · 서버 v${S.dataVersion}`) : "";
  $("pchead").hidden = false;
  $("appName").textContent = TITLES[current] || "클럽관리";
}
function openFileMenu(btn) {
  const m = $("fileMenu"); m.textContent = "";
  const item = (t, fn) => h("button", { type: "button", onclick: () => { m.hidden = true; fn(); } }, t);
  m.append(item("회원관리", () => go("members")), item("락카 사용현황", () => go("lockers")), item("연락처(뷰)", () => go("contacts")), h("hr"),
    item("환경설정", () => go("settings")), item("서버 원본 동기화 (새로고침)", async () => { try { await reload("서버 최신 자료를 다시 불러왔어요."); render(); } catch (e) { toast(e.message); } }), h("hr"),
    ...(Conn.mode === "site" ? [item("클럽 계정 연결 해제", unlinkClub)] : []), item("로그아웃", logout));
  const r = btn.getBoundingClientRect(); m.style.left = r.left + "px"; m.style.top = r.bottom + 2 + "px"; m.hidden = false;
  setTimeout(() => document.addEventListener("click", function off(e) { if (!m.contains(e.target)) { m.hidden = true; document.removeEventListener("click", off); } }), 0);
}
function go(k) { if (k === "settings" && current !== "settings") { ST.back = current; ST.sub = "basic"; } current = k; try { history.replaceState(null, "", "#" + k); } catch {} render(); }
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
    const tr = h("tr", { class: rowClass ? rowClass(r, i) || "" : "" }, cols.map((c) => h("td", { class: (typeof c.cls === "function" ? c.cls(r, i) : c.cls) || "" }, c.get(r, i))));
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
// Java String.format("%.1f") 와 같은 반올림: 가장 짧은 십진 표기에서 HALF_UP
const fmt1 = (d) => {
  const neg = d < 0 || Object.is(d, -0), a = Math.abs(d); let t = String(a);
  if (/e/i.test(t)) t = a.toFixed(20);
  let [ip, fp = ""] = t.split("."); fp = (fp + "0").slice(0, Math.max(2, fp.length));
  let tenth = +fp[0] + (+fp[1] >= 5 ? 1 : 0), whole = +ip;
  if (tenth === 10) { tenth = 0; whole += 1; }
  const r = `${whole}.${tenth}`; return neg && +r !== 0 ? "-" + r : r;
};
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
   4-3) 회계장부 (PC createLedgerPanel / addLedger / editLedgerDialog / 보고서 / 1년결산)
   ===================================================================== */
const LC = {
  IN_GROUPS: ["회원수입", "기초/금융수입", "행사/운영수입", "대회/기타수입", "기타수입"],
  EX_GROUPS: ["행사/운영지출", "시설/운영지출", "대회/행사지출", "환급/정산지출", "기타지출"],
  defaults() {
    const a = (type, name, group, link) => ({ type, name, group, link, use: true });
    return [a("수입", "회비", "회원수입", "회비관리"), a("수입", "입회비", "회원수입", "회원관리"), a("수입", "이자", "기초/금융수입", "외부·금융"), a("수입", "이월금", "기초/금융수입", "외부·금융"),
      a("수입", "정산금", "행사/운영수입", "게임기록"), a("수입", "불참벌금", "행사/운영수입", "게임기록"), a("수입", "이벤트 수입", "행사/운영수입", "이벤트·상주전"), a("수입", "시상금", "대회/기타수입", "외부·금융"),
      a("수입", "협찬금", "기타수입", "외부·금융"), a("수입", "락카비", "기타수입", "락카관리"), a("수입", "보증금", "기타수입", "락카관리"), a("수입", "기타 수입", "기타수입", "일반"),
      a("지출", "회식비", "행사/운영지출", "일반"), a("지출", "유니폼", "행사/운영지출", "일반"), a("지출", "야유회", "행사/운영지출", "이벤트·상주전"), a("지출", "이벤트", "행사/운영지출", "이벤트·상주전"), a("지출", "지원금", "행사/운영지출", "일반"),
      a("지출", "락카관리", "시설/운영지출", "락카관리"), a("지출", "수수료", "시설/운영지출", "외부·금융"), a("지출", "비품·소모품", "시설/운영지출", "일반"), a("지출", "시상금", "대회/행사지출", "게임기록"),
      a("지출", "참가비", "대회/행사지출", "이벤트·상주전"), a("지출", "상주전", "대회/행사지출", "이벤트·상주전"), a("지출", "보증금 반환", "환급/정산지출", "락카관리"), a("지출", "탈퇴 반환", "환급/정산지출", "회원관리"), a("지출", "기타 지출", "기타지출", "일반")];
  },
  parse(raw) {
    if (!raw || !String(raw).trim()) return this.defaults();
    const list = [];
    for (const line of String(raw).replace(/\r/g, "").split("\n")) {
      if (!line.trim()) continue;
      const f = line.split("\t"); if (f.length < 2) continue;
      const type = f[0].trim(), name = f[1].trim();
      if (!(type === "수입" || type === "지출") || !name) continue;
      list.push({ type, name, group: (f[2] || "").trim(), link: ((f[3] || "일반").trim() || "일반"), use: f.length <= 4 || f[4].trim() !== "0" });
    }
    return list.length ? list : this.defaults();
  },
  items() { return this.parse(S.settings.key_ledger_categories); },
  names(type) { const out = []; for (const i of this.items()) if (i.type === type && i.use && !out.includes(i.name)) out.push(i.name); return out; },
  annualMatch(type, category) {
    const t = String(category || "").trim().replace(/ /g, ""); if (!t) return null;
    for (const i of this.items()) if (i.type === type && i.name.replace(/ /g, "") === t) return [i.group, i.name];
    return null;
  },
};
const money = (n) => Number(n || 0).toLocaleString("ko-KR");
const won = (n) => money(n) + "원";
const yymmdd = (s) => s ? s.slice(2, 4) + "/" + s.slice(5, 7) + "/" + s.slice(8, 10) : "";
const cleanTitle = (t) => { let x = (t || "").trim(); if (!x) return "볼링클럽관리프로그램 v4"; const k = x.indexOf("[저장:"); if (k >= 0) x = x.slice(0, k).trim(); return x || "볼링클럽관리프로그램 v4"; };
Object.assign(Svc, {
  ledgerSorted(rows) { return [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.ledgerId - b.ledgerId); },
  getLedgerEntries(prefix) { return this.ledgerSorted(S.ledger.filter((l) => l.date && (prefix == null || l.date.startsWith(prefix)))); },
  income(rows) { return rows.filter((r) => r.type === "수입").reduce((a, r) => a + r.amount, 0); },
  expense(rows) { return rows.filter((r) => r.type === "지출").reduce((a, r) => a + r.amount, 0); },
  balance(rows) { return this.income(rows) - this.expense(rows); },
  latestLedgerDate() { const d = S.ledger.map((l) => l.date).filter(Boolean).sort(); return d.length ? d[d.length - 1] : null; },
  suggestNextLedgerDate() { const l = this.latestLedgerDate(); return l ? addDays(l, 1) : todayStr(); },
  rangeRows(from, to) { return this.getLedgerEntries(null).filter((e) => yearOf(e.date) === S.year && monthOf(e.date) >= from && monthOf(e.date) <= to); },
});
function ledgerPayload(e) { return { ledger_id: e.ledgerId || 0, entry_date: e.date, type: e.type, category: e.category, amount: e.amount, note: e.note || "", from_fee: !!e.fromFee, member_id: e.memberId || 0 }; }
function parseAmount(v) { const s = String(v || "").trim().replace(/,/g, ""); if (!/^-?\d+$/.test(s)) { toast("금액을 숫자로 입력하세요."); return null; } const n = parseInt(s, 10); if (n < 0) { toast("금액은 0 이상이어야 합니다."); return null; } return n; }
function smartDate(v) {
  const t = String(v || "").trim().replace(/[./]/g, "-"); if (!t) return todayStr();
  if (isDate(t)) return t;
  const a = t.split("-").map((x) => parseInt(x, 10));
  if (a.length === 3 && a.every(Number.isFinite)) { const y = a[0] < 100 ? a[0] + 2000 : a[0]; return `${y}-${pad2(a[1])}-${pad2(a[2])}`; }
  if (a.length === 2 && a.every(Number.isFinite)) return `${S.year}-${pad2(a[0])}-${pad2(a[1])}`;
  toast("날짜 형식이 올바르지 않아 오늘 날짜를 사용합니다."); return todayStr();
}
const LV = { mode: "all", from: 1, to: 1, month: null, sel: null, hi: null, bottom: null, date: null, type: "수입" };
function catInput(typeSel, value, cls = "pcin w12") {
  const id = "cat" + Math.random().toString(36).slice(2, 7);
  const inp = h("input", { class: cls, list: id, value: value || "", maxlength: "40", autocomplete: "off" });
  const dl = h("datalist", { id });
  const fill = () => { dl.textContent = ""; LC.names(typeSel.value).forEach((n) => dl.append(h("option", { value: n }))); };
  typeSel.addEventListener("change", fill); fill();
  return [inp, dl];
}

TABS.ledger = {
  render() {
    if (!LV.month) LV.month = String(Math.min(12, Math.max(1, new Date().getMonth() + 1)));
    if (!LV.date) LV.date = Svc.suggestNextLedgerDate();
    const date = h("input", { class: "pcin", type: "date", value: LV.date });
    const type = selectEl(["수입", "지출"], LV.type); type.onchange = () => LV.type = type.value;
    const [cat, catDl] = catInput(type, "");
    const amt = h("input", { class: "pcin w8", inputmode: "numeric", maxlength: "12" });
    const note = h("input", { class: "pcin w20", maxlength: "100" });
    [date, type, cat, amt].forEach((x, i, a) => x.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); (a[i + 1] || note).focus(); } });
    note.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
    const addBtn = h("button", { class: "pcbtn", type: "button", disabled: !canWrite() }, "장부 저장");
    addBtn.onclick = async () => {
      const a = parseAmount(amt.value); if (a == null) return;
      if (!cat.value.trim()) return toast("내역을 입력하세요.");
      const d = smartDate(date.value);
      addBtn.disabled = true;
      const e = { ledgerId: 0, date: d, type: type.value, category: cat.value.trim(), amount: a, note: note.value.trim(), fromFee: false, memberId: 0 };
      const before = new Set(S.ledger.map((x) => x.ledgerId));
      if (await save([op("ledger_entries", "insert", ledgerPayload(e))], "장부가 저장되었습니다.")) {
        const added = S.ledger.filter((x) => !before.has(x.ledgerId)).sort((x, y) => y.ledgerId - x.ledgerId)[0];
        LV.date = d; LV.hi = null; LV.bottom = added ? added.ledgerId : null; LV.sel = added || null;
        LV.mode = "all"; render();
        setTimeout(() => { const t = view.querySelector("tr.sel"); t && t.scrollIntoView({ block: "nearest" }); const s = view.querySelector("select.pcsel"); s && s.focus(); }, 50);
      } else addBtn.disabled = false;
    };
    const editBtn = h("button", { class: "pcbtn", type: "button" }, "장부수정");
    editBtn.onclick = () => LV.sel ? editLedger(LV.sel) : toast("수정할 장부를 선택하세요.");
    const annBtn = h("button", { class: "pcbtn", type: "button" }, "1년결산"); annBtn.onclick = annualSettlement;

    const monthSel = selectEl(monthOptions(), LV.month); monthSel.onchange = () => LV.month = monthSel.value;
    const q = (label, fn) => h("button", { class: "pcbtn", type: "button", onclick: fn }, label);
    const summary = h("span", { class: "pctitle", style: "font-size:15px;margin:0 0 0 8px;white-space:pre-wrap" });

    let rows;
    if (LV.mode === "all") rows = Svc.getLedgerEntries(null);
    else if (LV.mode === "month") rows = Svc.getLedgerEntries(`${S.year}-${pad2(LV.month)}`);
    else rows = Svc.rangeRows(LV.from, LV.to);
    if (LV.bottom != null) { const t = rows.find((r) => r.ledgerId === LV.bottom); if (t) rows = [...rows.filter((r) => r !== t), t]; }
    const all = Svc.getLedgerEntries(null);
    if (LV.mode === "all") summary.textContent = `전체 수입: ${money(Svc.income(rows))}원   전체 지출: ${money(Svc.expense(rows))}원   총 잔액: ${money(Svc.balance(rows))}원`;
    else { const rl = LV.from === LV.to ? `${LV.from}월` : `${LV.from}-${LV.to}월`; summary.textContent = `${rl} 수입: ${money(Svc.income(rows))}원   ${rl} 지출: ${money(Svc.expense(rows))}원   ${rl} 잔액: ${money(Svc.balance(rows))}원   총 잔액: ${money(Svc.balance(all))}원`; }

    const table = pcTable([
      { t: "번호", get: (r, i) => i + 1, w: "56px" }, { t: "일자", get: (r) => r.date }, { t: "구분", get: (r) => r.type },
      { t: "내역", get: (r) => r.category }, { t: "금액", cls: "r", get: (r) => money(r.amount) }, { t: "비고", cls: "l", get: (r) => r.note },
    ], rows, { onSelect: (r, i, dbl) => { LV.sel = r; if (LV.hi != null && LV.hi !== r.ledgerId) LV.hi = null; if (dbl) editLedger(r); }, rowClass: (r) => (LV.hi === r.ledgerId ? "hi" : "") + (r.fromFee ? " fee" : "") });
    if (LV.sel) { const k = rows.findIndex((r) => r.ledgerId === LV.sel.ledgerId); if (k >= 0) table.querySelectorAll("tbody tr")[k].classList.add("sel"); }
    LV.bottom = null;

    view.append(
      h("section", { class: "pcbox" }, h("div", { class: "pcform" }, h("label", {}, "일자"), date, h("label", {}, "구분"), type, h("label", {}, "내역"), cat, catDl, h("label", {}, "금액"), amt, h("label", {}, "비고"), note, addBtn, editBtn, annBtn, roBadge())),
      h("section", { class: "pcbox", style: "margin-top:4px" }, h("div", { class: "pcform" }, h("label", {}, "조회월"), monthSel,
        q("월별 조회", () => { LV.mode = "month"; LV.sel = null; render(); }), q("전체 조회", () => { LV.mode = "all"; LV.sel = null; render(); }),
        q("월별 보고서", () => { LV.from = LV.to = +monthSel.value; ledgerReport(); }), q("기간 보고서", rangeReport), summary)),
      table);
    setTimeout(() => { const t = view.querySelector("tr.sel"); t && t.scrollIntoView({ block: "nearest" }); }, 30);
  },
};

async function editLedger(entry) {
  if (entry.fromFee) return toast("회비에서 생성된 장부는 회비관리 화면에서 수정하거나 삭제하세요.");
  const date = h("input", { class: "pcin", type: "date", value: entry.date });
  const type = selectEl(["수입", "지출"], entry.type);
  const [cat, catDl] = catInput(type, entry.category, "pcin");
  const amt = h("input", { class: "pcin", inputmode: "numeric", value: String(entry.amount) });
  const note = h("input", { class: "pcin", value: entry.note, maxlength: "100" });
  const g = h("div", { class: "pcgrid" }, h("label", {}, "일자"), date, h("label", {}, "구분"), type, h("label", {}, "내역"), h("div", {}, cat, catDl), h("label", {}, "금액"), amt, h("label", {}, "비고"), note);
  const r = await modal("장부 수정", g, canWrite() ? [["수정", "ok"], ["취소", "cancel"], ["삭제", "del", "danger"]] : [["닫기", "cancel"]]);
  if (r === "ok") {
    const a = parseAmount(amt.value); if (a == null) return;
    if (!cat.value.trim()) return toast("내역을 입력하세요.");
    const e = { ...entry, date: smartDate(date.value), type: type.value, category: cat.value.trim(), amount: a, note: note.value.trim() };
    if (await save([op("ledger_entries", "update", ledgerPayload(e), S.rv.ledger[entry.ledgerId])], "장부가 수정되었습니다.")) { LV.hi = entry.ledgerId; LV.sel = S.ledger.find((x) => x.ledgerId === entry.ledgerId) || null; render(); }
  } else if (r === "del") {
    if (!(await confirmBox("선택한 장부를 삭제하시겠습니까?"))) return;
    if (await save([op("ledger_entries", "delete", ledgerPayload(entry), S.rv.ledger[entry.ledgerId])], "장부가 삭제되었습니다.")) { LV.sel = null; render(); }
  }
}

/* 월별/기간 보고서 */
function ledgerReport() {
  const from = LV.from, to = LV.to, rows = Svc.rangeRows(from, to), all = Svc.getLedgerEntries(null);
  const rl = from === to ? `${from}월` : `${from}-${to}월`;
  const box = (items) => h("div", { class: "rbox" }, items.map(([k, v]) => h("div", {}, h("small", {}, k), h("b", {}, v))));
  const sub = `${S.year}년 ${from}월${from === to ? "" : " ~ " + to + "월"} / 생성일 ${todayStr()}`;
  const body = h("div", {}, h("div", { class: "rsum" }, box([[`${rl} 수입`, won(Svc.income(rows))], [`${rl} 지출`, won(Svc.expense(rows))], [`${rl} 잔액`, won(Svc.balance(rows))]]), box([["총 잔액", won(Svc.balance(all))]])),
    h("div", { class: "rsec" }, "장부 내역"),
    pcTable([{ t: "일자", get: (r) => yymmdd(r.date) }, { t: "구분", get: (r) => r.type }, { t: "내역", get: (r) => r.category }, { t: "금액", cls: "r", get: (r) => money(r.amount) }, { t: "비고", cls: "l", get: (r) => r.note }], rows));
  reportModal(`${cleanTitle(S.programTitle)} | 회계 보고서`, sub, body);
}
async function rangeReport() {
  const mk = (v) => h("input", { class: "pcin w5", inputmode: "numeric", value: v, maxlength: "2" });
  const a = mk(String(LV.from)), b = mk(String(LV.to));
  const r = await modal("기간 보고서", h("div", { class: "pcgrid" }, h("label", {}, "기간 시작 월(1~12)"), a, h("label", {}, "기간 종료 월(1~12)"), b), [["확인", "ok"], ["취소", "cancel"]]);
  if (r !== "ok") return;
  const fm = parseInt(a.value, 10), tm = parseInt(b.value, 10);
  if (!Number.isFinite(fm) || !Number.isFinite(tm)) return toast("월은 숫자로 입력하세요.");
  LV.from = Math.min(fm, tm); LV.to = Math.max(fm, tm); LV.mode = "range"; LV.sel = null;
  render(); ledgerReport();
}

/* 1년결산 */
const AN = {
  note: (s) => String(s || "").trim().replace(/ /g, ""),
  fallback(c) { if (!c || !c.trim()) return "기타"; let t = c.trim(); const p = t.indexOf("("); if (p > 0) t = t.slice(0, p).trim(); return t || "기타"; },
  income(r) {
    const c = this.note(r.category), t = (c + " " + this.note(r.note)).trim();
    if (t.includes("입회비")) return ["회원수입", "입회비"]; if (t.includes("회비")) return ["회원수입", "월 회비"];
    if (t.includes("이월")) return ["기초/금융수입", "이월금"]; if (t.includes("이자")) return ["기초/금융수입", "이자"];
    if (t.includes("정산")) return ["행사/운영수입", "정산금"]; if (t.includes("팀벌금") || t.includes("에버벌금")) return ["행사/운영수입", "정산금"];
    if (t.includes("벌금")) return ["행사/운영수입", "벌금"]; if (t.includes("시상금")) return ["대회/기타수입", "대회 시상금"]; if (t.includes("보증금")) return ["기타수입", "보증금"];
    return LC.annualMatch("수입", r.category) || ["기타수입", this.fallback(c)];
  },
  expense(r) {
    const c = this.note(r.category), t = (c + " " + this.note(r.note)).trim();
    if (t.includes("회식")) return ["행사/운영지출", "회식비"]; if (t.includes("유니폼")) return ["행사/운영지출", "유니폼"]; if (t.includes("야유회")) return ["행사/운영지출", "야유회"]; if (t.includes("지원금")) return ["행사/운영지출", "지원금"];
    if (t.includes("락카")) return ["시설/운영지출", "락카비"]; if (t.includes("참가")) return ["대회/행사지출", "참가비"]; if (t.includes("시상")) return ["대회/행사지출", "시상금"];
    if (t.includes("탈퇴") || t.includes("반환") || t.includes("환급")) return ["환급/정산지출", "탈퇴 반환"];
    return LC.annualMatch("지출", r.category) || ["기타지출", this.fallback(c)];
  },
  summarize(rows, income) {
    const map = new Map(); for (const g of income ? LC.IN_GROUPS : LC.EX_GROUPS) map.set(g, { major: g, total: 0, mid: new Map() });
    for (const r of rows) {
      if (r.type !== (income ? "수입" : "지출")) continue;
      const [maj, mid] = income ? this.income(r) : this.expense(r);
      if (!map.has(maj)) map.set(maj, { major: maj, total: 0, mid: new Map() });
      const s = map.get(maj), k = mid || "기타"; s.mid.set(k, (s.mid.get(k) || 0) + r.amount); s.total += r.amount;
    }
    return map;
  },
};
function annualSettlement() {
  const rows = Svc.getLedgerEntries(null).filter((e) => yearOf(e.date) === S.year);
  const mi = Array(13).fill(0), me = Array(13).fill(0), has = Array(13).fill(false);
  for (const r of rows) { const m = monthOf(r.date); if (m < 1 || m > 12) continue; has[m] = true; if (r.type === "수입") mi[m] += r.amount; else if (r.type === "지출") me[m] += r.amount; }
  let ti = 0, te = 0; for (let m = 1; m <= 12; m++) { ti += mi[m]; te += me[m]; }
  const tb = ti - te;
  const card = (t, v, cls, mk) => h("div", { class: "acard " + cls }, h("span", { class: "amk" }, "₩" + mk), h("div", {}, h("div", { class: "a-t" }, t), h("div", { class: "a-v" }, won(v))));
  const sec = (t, body) => h("section", { class: "asec" }, h("div", { class: "ash" }, t), h("div", { class: "asb" }, body));
  const mon = h("table", { class: "pct amon" }, h("thead", {}, h("tr", {}, ["구분", ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`)].map((x) => h("th", {}, x)))),
    h("tbody", {}, [["수입", "in", (m) => mi[m]], ["지출", "ex", (m) => me[m]], ["잔액", "ba", (m) => mi[m] - me[m]]].map(([lab, cl, f]) =>
      h("tr", {}, h("td", { class: "k " + cl }, lab), ...Array.from({ length: 12 }, (_, i) => { const m = i + 1; return h("td", { class: has[m] ? (cl === "ba" && f(m) < 0 ? "neg" : "") : "none" }, has[m] ? won(f(m)) : "-"); })))));
  const cat = (map, total, color, label) => {
    const trs = [];
    for (const s of map.values()) { if (s.total <= 0) continue; let first = true; for (const [k, v] of s.mid) { if (!(v > 0)) continue; trs.push(h("tr", {}, h("td", { class: "b" }, first ? s.major : ""), h("td", {}, k), h("td", { class: "r" }, won(v)), h("td", { class: "r b", style: `color:${color}` }, first ? won(s.total) : ""))); first = false; } }
    if (!trs.length) trs.push(h("tr", {}, h("td", {}, "-"), h("td", {}, "입력 데이터 없음"), h("td", { class: "r" }, "-"), h("td", { class: "r" }, "-")));
    const ratio = h("div", { class: "aratio" }, h("b", { style: `color:${color}` }, "대분류 비중"), [...map.values()].filter((s) => s.total > 0).map((s) => { const p = total <= 0 ? 0 : s.total * 100 / total; return h("div", { class: "arow" }, h("span", {}, s.major), h("i", {}, h("u", { style: `width:${Math.max(2, Math.min(100, p))}%;background:${color}` })), h("em", {}, p.toFixed(1) + "%")); }));
    return h("div", { class: "acat" }, h("div", {}, h("table", { class: "pct" }, h("thead", {}, h("tr", {}, ["대분류", "중분류", "금액", "소계"].map((x) => h("th", {}, x)))), h("tbody", {}, trs)),
      h("div", { class: "atot", style: `background:${color}` }, h("span", {}, label), h("b", {}, won(total)))), ratio);
  };
  const body = h("div", { class: "annual" },
    h("div", { class: "acards" }, card("총수입", ti, "in", "↗"), card("총지출", te, "ex", "↘"), card("수지차액", tb, tb < 0 ? "neg" : "ba", "=")),
    sec("1. 월별 수입·지출 현황 (1~12월)", h("div", { class: "pctable-wrap", style: "max-height:none" }, mon)),
    h("div", { class: "acols" }, sec("2. 수입 분류표", cat(AN.summarize(rows, true), ti, "#008080", "수입 총합계")), sec("3. 지출 분류표", cat(AN.summarize(rows, false), te, "#2058a3", "지출 총합계"))),
    h("div", { class: "anotes" }, ["• 회비(개인명)는 회원수입 > 월 회비로 통합", "• 정산금 / 정산 금액 / 정모 정산금 / 팀벌금 / 에버벌금은 행사·운영수입 > 정산금으로 통합", "• 불참 벌금 / 정모 벌금은 행사·운영수입 > 벌금으로 통합", "• 회계장부의 현재 입력 데이터를 기준으로 1~12월을 자동 집계"].map((t) => h("div", {}, t))));
  reportModal(`${S.year}년 ${cleanTitle(S.programTitle)} 회계 현황`, "회계장부 입력 데이터 기준 / 1~12월 자동 집계", body);
}

/* =====================================================================
   4-4) 회비관리 (PC createFeePanel / registerFeeRange / editFeeDialog / getFeeStatusRows)
   ===================================================================== */
const plusMonth1 = (d) => { const y = yearOf(d), m = monthOf(d); return m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`; };
Object.assign(Svc, {
  feeStartMonth(m, y) { if (!m) return 1; if (m.feeStartYear > 0 && y < m.feeStartYear) return 13; if (m.feeStartYear === y) return Math.min(12, Math.max(1, m.feeStartMonth)); return 1; },
  execExempt: (m, mo) => !!m && !!m.executiveThreeMonthExempt && mo >= 10 && mo <= 12,
  rejoinChargeStart(m) { if (!m || !m.rejoinDate || m.rejoinFeeStartMonth <= 0 || m.rejoinFeeStartYear <= 0) return null; return `${m.rejoinFeeStartYear}-${pad2(Math.min(12, Math.max(1, m.rejoinFeeStartMonth)))}-01`; },
  lastPaidBeforeWithdrawal(m) {
    if (!m || !m.withdrawalDate) return null; const wm = m.withdrawalDate.slice(0, 7) + "-01"; let best = null;
    for (const f of S.fees) { if (f.memberId !== m.memberId) continue; const d = `${f.year}-${pad2(f.month)}-01`; if (d <= wm && (!best || d > best)) best = d; }
    return best;
  },
  withdrawalMarker(m) { if (!m || !m.withdrawalDate) return null; const l = this.lastPaidBeforeWithdrawal(m); return l ? plusMonth1(l) : m.withdrawalDate.slice(0, 7) + "-01"; },
  activeForFee(m, y, mo) {
    if (!m || mo < 1 || mo > 12) return false;
    const sm = this.feeStartMonth(m, y); if (sm > 12 || mo < sm) return false;
    const md = `${y}-${pad2(mo)}-01`, rj = this.rejoinChargeStart(m);
    if (rj && md >= rj) return true;
    const wm = this.withdrawalMarker(m); if (!wm) return true;
    return md < wm;
  },
  withdrawalMarkerMonth(m, y, mo) {
    if (!m || mo < 1 || mo > 12) return false; const mk = this.withdrawalMarker(m); if (!mk) return false;
    const md = `${y}-${pad2(mo)}-01`; if (md !== mk) return false;
    const rj = this.rejoinChargeStart(m); return !rj || md < rj;
  },
  inactiveFeeMonth(m, y, mo) { return !this.activeForFee(m, y, mo) && !this.withdrawalMarkerMonth(m, y, mo) && mo >= this.feeStartMonth(m, y); },
  chargeable(m, y, mo) { return this.activeForFee(m, y, mo) && !this.execExempt(m, mo); },
  findFee: (y, id, mo) => S.fees.find((f) => f.year === y && f.memberId === id && f.month === mo) || null,
  feeEligible() { return this.getMembers().filter((m) => !m.feeExempt); },
  feeStatusRows(target) {
    const rows = [], now = todayStr(), ny = yearOf(now), nm = monthOf(now);
    const due = S.year < ny ? 12 : S.year === ny ? nm : 0, dispMonth = Math.max(target, due);
    for (const m of this.feeEligible()) {
      if (this.isWithdrawn(m)) continue;
      const disp = []; let count = 0, total = 0, hasUnpaid = false, curUnpaid = false, allPaid = true, req = 0;
      const sm = this.feeStartMonth(m, S.year);
      for (let mo = 1; mo <= 12; mo++) {
        if (mo < sm) { disp.push(""); continue; }
        const fp = this.findFee(S.year, m.memberId, mo), active = this.activeForFee(m, S.year, mo), ex = active && this.execExempt(m, mo);
        const isDue = mo <= due, curMonth = S.year === ny && mo === nm;
        if (active && !ex) { req++; if (!fp) allPaid = false; }
        if (fp) { count++; total += fp.amount; disp.push(`${monthOf(fp.paidDate)}/${+fp.paidDate.slice(8, 10)}`); }
        else if (!active) disp.push("");
        else if (ex) disp.push("면제");
        else if (mo <= dispMonth && isDue) { if (curMonth) { disp.push("예정"); curUnpaid = true; } else { disp.push("미납"); hasUnpaid = true; } }
        else disp.push("");
      }
      const status = req > 0 && allPaid ? "완납" : hasUnpaid ? "미납" : curUnpaid ? "예정" : "정상";
      rows.push({ memberId: m.memberId, name: m.name, grade: m.grade, status, disp, count, total });
    }
    return rows;
  },
  suggestFeeStart(m, id) {
    const first = Math.max(1, this.feeStartMonth(m, S.year));
    for (let mo = first; mo <= 12; mo++) { if (!this.chargeable(m, S.year, mo)) continue; if (!this.findFee(S.year, id, mo)) return mo; }
    for (let mo = 12; mo >= first; mo--) if (this.chargeable(m, S.year, mo)) return mo;
    return first;
  },
  suggestFeeEnd(m, start) { for (let mo = Math.max(1, start + 1); mo <= 12; mo++) if (this.chargeable(m, S.year, mo)) return mo; return Math.max(1, Math.min(12, start)); },
  feeMonthsNote(name, months) {
    const parts = []; let i = 0;
    while (i < months.length) { let j = i; while (j + 1 < months.length && months[j + 1] === months[j] + 1) j++; parts.push(i === j ? String(months[i]) : `${months[i]}~${months[j]}`); i = j + 1; }
    return `${name}(${parts.join(",")}월)`;
  },
});
const feeKey = (d, n) => d + "\u001f" + String(n || "").trim();
/* 회원의 해당 연도 회비(desired)로부터 서버 업로드 작업(회비 + 회비 연동 장부)을 만든다 (PC PcFeeOutboxStore 와 같은 차이 계산) */
function feeOps(memberId, year, desired) {
  const ops = [], want = new Map(desired.map((f) => [f.month, f]));
  for (let mo = 1; mo <= 12; mo++) {
    const local = want.get(mo), remote = Svc.findFee(year, memberId, mo);
    if (!local && !remote) continue;
    const src = local || remote;
    const payload = { member_id: memberId, fee_year: year, fee_month: mo, amount: src.amount, paid_date: src.paidDate, note: src.note || "" };
    if (!local) ops.push(op("fee_payments", "delete", payload, S.rv.fees[`${memberId}|${year}|${mo}`]));
    else if (!remote) ops.push(op("fee_payments", "insert", payload));
    else if (remote.amount === local.amount && remote.paidDate === local.paidDate && String(remote.note || "").trim() === String(local.note || "").trim()) continue;
    else ops.push(op("fee_payments", "update", payload, S.rv.fees[`${memberId}|${year}|${mo}`]));
  }
  // 장부: 회비 연동 줄 다시 만들기
  const m = Svc.findMember(memberId), groups = new Map();
  for (const f of desired.filter((f) => Svc.chargeable(m, year, f.month)).sort((a, b) => a.month - b.month)) { const k = feeKey(f.paidDate, f.note); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
  const des = new Map();
  [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).forEach(([k, list]) => des.set(k, { date: list[0].paidDate, amount: list.reduce((a, f) => a + f.amount, 0), note: String(list[0].note || "").trim() }));
  const ex = new Map();
  S.ledger.filter((l) => l.fromFee && l.memberId === memberId && l.date.startsWith(year + "-")).sort((a, b) => a.ledgerId - b.ledgerId).forEach((l) => { const k = feeKey(l.date, l.note); if (!ex.has(k)) ex.set(k, []); ex.get(k).push(l); });
  const lp = (e, r) => { const p = { member_id: memberId, entry_date: e ? e.date : r.date, type: e ? "수입" : r.type, category: e ? "회비" : r.category, amount: e ? e.amount : r.amount, note: e ? e.note : r.note, from_fee: true }; if (r) p.ledger_id = r.ledgerId; return p; };
  for (const k of new Set([...des.keys(), ...ex.keys()])) {
    const e = des.get(k), rs = ex.get(k) || [], r0 = rs[0];
    if (e && !r0) ops.push(op("ledger_entries", "insert", lp(e, null)));
    else if (!e && r0) rs.forEach((r) => ops.push(op("ledger_entries", "delete", lp(null, r), S.rv.ledger[r.ledgerId])));
    else if (e) {
      if (!(r0.date === e.date && r0.type === "수입" && r0.category === "회비" && r0.amount === e.amount && String(r0.note).trim() === e.note && r0.fromFee)) ops.push(op("ledger_entries", "update", lp(e, r0), S.rv.ledger[r0.ledgerId]));
      rs.slice(1).forEach((r) => ops.push(op("ledger_entries", "delete", lp(null, r), S.rv.ledger[r.ledgerId])));
    }
  }
  return ops;
}
const feeCopy = (id, y) => S.fees.filter((f) => f.memberId === id && f.year === y).map((f) => ({ ...f }));
const shortMD = (d) => d ? `${monthOf(d)}/${+d.slice(8, 10)}` : "";
const FV = { memberId: null, prepay: false, start: 1, end: 1, date: null, month: null };

TABS.fees = {
  render() {
    if (!FV.month) FV.month = String(Math.min(12, new Date().getMonth() + 1));
    if (!FV.date) FV.date = todayStr();
    const members = Svc.activeInputMembers();
    if (!members.some((m) => m.memberId === FV.memberId)) { FV.memberId = members.length ? members[0].memberId : null; applyDefaults(); }
    const memSel = h("select", { class: "pcsel" }, members.map((m) => h("option", { value: m.memberId }, m.name))); if (FV.memberId) memSel.value = FV.memberId;
    const pre = h("input", { type: "checkbox", checked: FV.prepay });
    const mo = () => Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]);
    const sSel = selectEl(mo(), String(FV.start)), eSel = selectEl(mo(), String(FV.end)); eSel.disabled = !FV.prepay;
    const date = h("input", { class: "pcin", type: "date", value: FV.date });
    const note = h("input", { class: "pcin w20", readonly: true });
    const mem = () => Svc.findMember(FV.memberId);
    function applyDefaults() {
      const m = Svc.findMember(FV.memberId); if (!m) return;
      FV.start = Svc.suggestFeeStart(m, FV.memberId); FV.end = FV.prepay ? Svc.suggestFeeEnd(m, FV.start) : FV.start;
    }
    const sync = () => {
      if (!FV.prepay) FV.end = FV.start;
      if (FV.start > FV.end) [FV.start, FV.end] = [FV.end, FV.start];
      sSel.value = String(FV.start); eSel.value = String(FV.end); eSel.disabled = !FV.prepay;
      const m = mem(), lab = FV.start === FV.end ? `${FV.start}월` : `${FV.start}~${FV.end}월`;
      note.value = m ? `${m.name.trim()}(${lab})` : lab;
    };
    memSel.onchange = () => { FV.memberId = +memSel.value; applyDefaults(); sync(); markRow(); };
    pre.onchange = () => { FV.prepay = pre.checked; if (!FV.prepay) FV.end = FV.start; else { const m = mem(); FV.end = Svc.suggestFeeEnd(m, FV.start); } sync(); };
    sSel.onchange = () => { FV.start = +sSel.value; if (FV.prepay && FV.end <= FV.start) FV.end = Svc.suggestFeeEnd(mem(), FV.start); sync(); };
    eSel.onchange = () => { FV.end = +eSel.value; sync(); };
    date.onchange = () => FV.date = date.value;

    const addBtn = h("button", { class: "pcbtn", type: "button", disabled: !canWrite() }, "회비 등록");
    addBtn.onclick = async () => {
      const m = mem(); if (!m) return toast("회원명을 선택하세요.");
      let s = FV.start, e = FV.prepay ? FV.end : FV.start; if (s > e) [s, e] = [e, s];
      const lab = s === e ? `${s}월` : `${s}~${e}월`, nt = `${m.name.trim()}(${lab})`;
      if (m.feeExempt) return toast("회비 면제 회원은 회비관리 대상에서 제외됩니다.");
      if (Svc.isWithdrawn(m)) return toast("탈퇴 회원은 회비를 저장할 수 없습니다.");
      const paid = smartDate(date.value), fee = S.monthlyFee, list = feeCopy(m.memberId, S.year);
      for (let k = s; k <= e; k++) { if (!Svc.chargeable(m, S.year, k)) continue; const i = list.findIndex((f) => f.month === k); const nf = { feeId: 0, memberId: m.memberId, year: S.year, month: k, paidDate: paid, amount: fee, note: nt }; if (i >= 0) list[i] = nf; else list.push(nf); }
      const ops = feeOps(m.memberId, S.year, list);
      addBtn.disabled = true;
      if (!ops.length) { toast("회비가 등록되었습니다."); addBtn.disabled = false; return; }
      if (await save(ops, "회비가 등록되었습니다.")) { FV.date = todayStr(); FV.prepay = false; applyDefaults(); render(); } else addBtn.disabled = false;
    };
    const editBtn = h("button", { class: "pcbtn", type: "button" }, "수정");
    editBtn.onclick = () => FV.sel ? editFee(FV.sel) : toast("수정할 회원을 선택하세요.");

    const monthSel = selectEl(mo(), FV.month); monthSel.onchange = () => FV.month = monthSel.value;
    const summary = h("span", { class: "pctitle", style: "font-size:15px;margin:0 0 0 8px;white-space:pre-wrap" });
    const rows = Svc.feeStatusRows(+FV.month);
    const cnt = (s) => rows.filter((r) => r.status === s).length;
    const paidCnt = rows.reduce((a, r) => a + r.count, 0), totalAmt = rows.reduce((a, r) => a + r.total, 0);
    summary.textContent = `조회월 ${FV.month}월 / 월회비 ${money(S.monthlyFee)}원 / 완납 ${cnt("완납")}명 / 정상 ${cnt("정상")}명 / 예정 ${cnt("예정")}명 / 미납 ${cnt("미납")}명 / 총납부건수 ${paidCnt}건 / 총합계 ${money(totalAmt)}원`;
    const cellCls = (v) => v.includes("미납") ? "f-bad" : v === "예정" ? "f-soon" : "";
    const cols = [{ t: "순번", get: (r, i) => i + 1 }, { t: "회원명", get: (r) => r.name }, { t: "등급", get: (r) => r.grade },
      { t: "납부여부", cls: (r) => r.status === "미납" ? "f-bad" : r.status === "예정" ? "f-soon" : "f-ok", get: (r) => r.status },
      ...Array.from({ length: 12 }, (_, k) => ({ t: `${k + 1}월`, cls: (r) => cellCls(r.disp[k]), get: (r) => r.disp[k] })),
      { t: "합계금액", cls: "r", get: (r) => r.total <= 0 ? "" : money(r.total) }];
    let syncing = false;
    const table = pcTable(cols, rows, { onSelect: (r, i, dbl) => { FV.sel = r; if (syncing) return; FV.memberId = r.memberId; if (members.some((m) => m.memberId === r.memberId)) { memSel.value = r.memberId; applyDefaults(); sync(); } if (dbl) editFee(r); } });
    table.firstChild.classList.add("feet");
    function markRow() {
      const k = rows.findIndex((r) => r.memberId === FV.memberId), trs = table.querySelectorAll("tbody tr");
      trs.forEach((t) => t.classList.remove("sel")); if (k >= 0) { trs[k].classList.add("sel"); trs[k].scrollIntoView({ block: "nearest" }); FV.sel = rows[k]; } else FV.sel = null;
    }
    const repBtn = h("button", { class: "pcbtn", type: "button" }, "보고서");
    repBtn.onclick = () => { const c = cols.filter((x) => x.t !== "등급"); reportModal("회비관리", "", pcTable(c, rows)); };
    sync();
    view.append(
      h("section", { class: "pcbox" }, h("div", { class: "pcform" }, h("label", {}, "회원명"), memSel, h("label", {}, "선납"), pre, h("label", {}, "시작월"), sSel, h("label", {}, "종료월"), eSel, h("label", {}, "납부일"), date, h("label", {}, "비고"), note, addBtn, editBtn, repBtn, roBadge())),
      h("section", { class: "pcbox", style: "margin-top:4px" }, h("div", { class: "pcform" }, h("label", {}, "조회월"), monthSel, h("button", { class: "pcbtn", type: "button", onclick: () => render() }, "회비 현황 조회"), summary)),
      table);
    setTimeout(markRow, 30);
  },
};

async function editFee(row) {
  const m = Svc.findMember(row.memberId);
  if (Svc.isWithdrawn(m)) return toast("탈퇴 회원은 회비를 수정할 수 없습니다.");
  const sm = Svc.feeStartMonth(m, S.year), trs = [], chk = [], dts = [];
  for (let i = 1; i <= 12; i++) {
    const fp = Svc.findFee(S.year, m.memberId, i), ok = Svc.chargeable(m, S.year, i);
    const cb = h("input", { type: "checkbox", checked: !!fp && ok, disabled: !ok }), dt = h("input", { class: "pcin w8", value: fp && ok ? shortMD(fp.paidDate) : "", disabled: !ok });
    let st = fp ? "등록" : "";
    if (!ok) st = Svc.inactiveFeeMonth(m, S.year, i) ? "공란" : i < sm ? "제외" : Svc.execExempt(m, i) ? "면제" : "제외";
    chk.push(cb); dts.push(dt);
    trs.push(h("tr", {}, h("td", {}, h("label", {}, cb, ` ${i}월`)), h("td", {}, st), h("td", {}, dt)));
  }
  const note = h("input", { class: "pcin w20" });
  const body = h("div", {}, h("div", { class: "pcnote", style: "margin:0 0 6px" }, `${m.name} · ${S.year}년`),
    h("table", { class: "pct feeedit" }, h("thead", {}, h("tr", {}, ["월", "납부", "납부일(M/D 또는 YYYY-MM-DD)"].map((x) => h("th", {}, x)))), h("tbody", {}, trs)),
    h("div", { class: "pcform", style: "margin-top:8px" }, h("label", {}, "비고(비우면 자동)"), note));
  const r = await modal("회비 수정", body, canWrite() ? [["확인", "ok"], ["취소", "cancel"]] : [["닫기", "cancel"]]);
  if (r !== "ok") return;
  const sel = new Map(); for (let i = 1; i <= 12; i++) if (chk[i - 1].checked) sel.set(i, smartDate(dts[i - 1].value));
  const noteText = sel.size ? note.value.trim() : "", auto = !noteText, byDate = new Map();
  for (const [k, d] of [...sel.entries()].sort((a, b) => a[0] - b[0])) { if (!Svc.chargeable(m, S.year, k)) continue; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(k); }
  const list = [];
  for (const [k, d] of [...sel.entries()].sort((a, b) => a[0] - b[0])) { if (!Svc.chargeable(m, S.year, k)) continue; list.push({ feeId: 0, memberId: m.memberId, year: S.year, month: k, paidDate: d, amount: S.monthlyFee, note: auto ? Svc.feeMonthsNote(m.name, byDate.get(d)) : noteText }); }
  const ops = feeOps(m.memberId, S.year, list);
  if (!ops.length) return toast("회비가 수정되었습니다.");
  if (await save(ops, "회비가 수정되었습니다.")) { FV.memberId = m.memberId; render(); }
}

/* =====================================================================
   4-5) 랭킹/현황 (PC createRankingPanel / getRankingRows)
   ===================================================================== */
Object.assign(Svc, {
  rankingRows() {
    const rows = [], games = this.canonicalRankingGames(S.year);
    for (const m of this.getMembers()) {
      if (this.isWithdrawn(m)) continue;
      const gs = games.filter((g) => g.memberId === m.memberId); if (!gs.length) continue;
      const base = this.effectiveBaseAverage(m);
      rows.push({ memberId: m.memberId, nameWithBase: `${m.name}(${base})`, grade: m.grade, base, count: gs.reduce((a, g) => a + gcnt(g), 0), avg: this.aggregateAverage(gs), max: Math.max(...gs.map(gbest)) });
    }
    return rows.sort((a, b) => b.avg - a.avg || (a.nameWithBase < b.nameWithBase ? -1 : a.nameWithBase > b.nameWithBase ? 1 : 0));
  },
  clubAverage() { return this.aggregateAverage(this.canonicalRankingGames(S.year).filter((g) => { const m = this.findMember(g.memberId); return m && !this.isWithdrawn(m); })); },
  visibleGameCount() { return S.games.filter((g) => yearOf(g.gameDate) === S.year && (() => { const m = this.findMember(g.memberId); return m && !this.isWithdrawn(m); })()).length; },
});
TABS.ranking = {
  render() {
    const rows = Svc.rankingRows();
    const cols = [{ t: "순위", get: (r, i) => i + 1 }, { t: "회원명(기준에버)", get: (r) => r.nameWithBase }, { t: "등급", get: (r) => r.grade }, { t: "게임수", get: (r) => r.count },
      { t: "평균점수", get: (r) => fmt1(r.avg) }, { t: "최고점수", get: (r) => r.max }, { t: "에버편차", get: (r) => signed1(r.avg - r.base) }];
    const active = Svc.getMembers().filter((m) => !Svc.isWithdrawn(m)).length;
    const summary = h("span", { class: "pctitle", style: "font-size:15px;margin:0 0 0 8px;white-space:pre-wrap" }, `총 회원 ${active}명   총 게임기록 ${Svc.visibleGameCount()}건   전체 평균 ${fmt1(Svc.clubAverage())}`);
    const refresh = h("button", { class: "pcbtn", type: "button" }, "새로고침");
    refresh.onclick = async () => { try { await reload("서버 최신 자료를 다시 불러왔어요."); render(); } catch (e) { toast(e.message); } };
    const rep = h("button", { class: "pcbtn", type: "button" }, "보고서");
    rep.onclick = () => reportModal("랭킹 현황", "", pcTable([{ t: "순위", get: (r, i) => i + 1 }, { t: "회원명(에버)", get: (r) => r.nameWithBase }, ...cols.slice(3)], rows));
    view.append(h("section", { class: "pcbox" }, h("div", { class: "pcform" }, refresh, rep, summary)), pcTable(cols, rows));
  },
};

/* =====================================================================
   4-6) 분기 기준에버 (PC createQuarterPanel / getQuarterRows / saveQuarterAdjustments)
   ===================================================================== */
const lastWednesday = (y, month) => { const d = new Date(y, month, 0); while (d.getDay() !== 3) d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
Object.assign(Svc, {
  quarterEntryOpen(q) { if (q < 1 || q > 4) return false; return !(todayStr() < addDays(lastWednesday(S.year, q * 3), -2)); },
  displayedAdjustment(m, y, q) {
    if (!m) return null;
    if (q === 4) { const s = this.findYearBaseSeed(y + 1, m.memberId); return s > 0 ? s : null; }
    const a = S.quarterAdjustments.find((x) => x.year === y && x.quarter === q && x.memberId === m.memberId && x.adjustedBaseAverage > 0);
    return a ? a.adjustedBaseAverage : null;
  },
  quarterRows(q) {
    const years = new Set([S.year, S.year + 1]);
    S.games.forEach((g) => years.add(yearOf(g.gameDate))); S.fees.forEach((f) => years.add(f.year)); S.quarterAdjustments.forEach((a) => years.add(a.year));
    years.forEach((y) => this.ensureYearBaseSeeds(y));
    const rows = [];
    for (const m of this.getMembers()) {
      if (this.isWithdrawn(m)) continue;
      rows.push({ memberId: m.memberId, name: m.name, grade: m.grade, base: this.quarterBaseAverage(m, S.year, q), cum: this.cumulativeAverage(m.memberId, S.year, q), adj: this.displayedAdjustment(m, S.year, q) });
    }
    return rows;
  },
});
const QV = { q: null, edits: new Map() };
TABS.quarter = {
  render() {
    if (!QV.q) QV.q = Math.floor(new Date().getMonth() / 3) + 1;
    const q = QV.q, open = Svc.quarterEntryOpen(q), rows = Svc.quarterRows(q);
    const cell = (r) => QV.edits.has(r.memberId) ? QV.edits.get(r.memberId) : (r.adj != null ? String(r.adj) : (open && r.base > 0 ? String(r.base) : ""));
    const qSel = selectEl([["1", "1분기"], ["2", "2분기"], ["3", "3분기"], ["4", "4분기"]], String(q)); qSel.onchange = () => { QV.q = +qSel.value; QV.edits = new Map(); render(); };
    const cols = [{ t: "순번", get: (r, i) => i + 1 }, { t: "회원명", get: (r) => r.name }, { t: "등급", get: (r) => r.grade }, { t: "기준에버", get: (r) => r.base }, { t: "누적에버", get: (r) => fmt1(r.cum) }, { t: "조정에버", cls: "qadj", get: (r) => cell(r) }];
    const edit = async (r) => {
      if (!open) return toast("선택한 분기의 다음 분기 책정에버는 해당 분기 마지막 달의 마지막 주부터 입력할 수 있습니다.", 4200);
      const inp = h("input", { class: "pcin", inputmode: "numeric", value: cell(r) });
      const res = await modal("조정에버", h("div", { class: "pcgrid" }, h("label", {}, `${r.name} 조정에버`), inp), canWrite() ? [["확인", "ok"], ["취소", "cancel"]] : [["닫기", "cancel"]]);
      if (res !== "ok") return;
      const v = inp.value.trim().replace(/,/g, "");
      if (v && !/^-?\d+$/.test(v)) return toast("숫자로 입력하세요.");
      QV.edits.set(r.memberId, v); render();
    };
    const saveBtn = h("button", { class: "pcbtn", type: "button", disabled: !canWrite() }, "조정에버 저장");
    saveBtn.onclick = async () => {
      if (!open) return toast("선택한 분기의 다음 분기 책정에버는 해당 분기 마지막 달의 마지막 주부터 저장할 수 있습니다.", 4200);
      const ty = q === 4 ? S.year + 1 : S.year, tq = q === 4 ? 1 : q + 1, serverQ = q === 4 ? 1 : q + 1, ops = [];
      for (const r of rows) {
        const val = cell(r).trim().replace(/,/g, "");
        let adj = val === "" ? null : (/^-?\d+$/.test(val) ? parseInt(val, 10) : NaN);
        if (Number.isNaN(adj)) return toast("조정에버는 숫자로 입력하세요.");
        if (adj != null && adj < 0) return toast("조정에버는 0 이상이어야 합니다.");
        if ((adj == null || adj === 0) && r.base > 0) adj = r.base;
        const key = `${r.memberId}|${ty}|${serverQ}`, exists = key in S.sq, remove = adj == null || adj <= 0;
        const payload = { member_id: r.memberId, year: ty, quarter: serverQ };
        if (remove) { if (exists) ops.push(op("quarter_base_averages", "delete", payload, S.rv.quarters[key])); }
        else { payload.average = adj; if (!exists) ops.push(op("quarter_base_averages", "insert", payload)); else if (S.sq[key] !== adj) ops.push(op("quarter_base_averages", "update", payload, S.rv.quarters[key])); }
      }
      const msg = `${q}분기 조정에버가 ${ty}년 ${tq}분기에 저장되었습니다.`;
      if (!ops.length) { toast(msg); return; }
      saveBtn.disabled = true;
      if (await save(ops, msg)) { QV.edits = new Map(); render(); } else saveBtn.disabled = false;
    };
    const rep = h("button", { class: "pcbtn", type: "button" }, "보고서"); rep.onclick = () => reportModal("분기 기준에버", "", pcTable(cols, rows));
    view.append(h("section", { class: "pcbox" }, h("div", { class: "pcform" }, h("label", {}, "분기"), qSel, h("button", { class: "pcbtn", type: "button", onclick: () => { QV.edits = new Map(); render(); } }, "조회"), saveBtn, rep, roBadge())),
      h("div", { class: "pcnote" }, open ? "조정에버 칸을 두 번 누르면 값을 고칠 수 있어요." : "다음 분기 책정에버는 해당 분기 마지막 달의 마지막 주부터 입력할 수 있어요."),
      pcTable(cols, rows, { onSelect: (r, i, dbl) => { if (dbl) edit(r); } }));
  },
};

/* =====================================================================
   4-7) 락카 사용현황 (PC createLockerPanel / getLockerRows / editLockerDialog)
   ===================================================================== */
const sharedAmount = (k) => { const n = parseInt(String(S.settings[k] ?? "0").replace(/,/g, "").trim(), 10); return Number.isFinite(n) ? Math.max(0, n) : 0; };
const sharedMD = (k, def) => { const v = String(S.settings[k] ?? def ?? "").trim(); const m = v.match(/^(\d{1,2})-(\d{1,2})$/); return m ? `${S.year}-${pad2(m[1])}-${pad2(m[2])}` : null; };
Object.assign(Svc, {
  lockerRows() {
    const dep = sharedAmount("key_locker_deposit"), fee = sharedAmount("key_locker_yearly_fee"), cd = sharedMD("key_locker_contract_date", "01-01"), ed = sharedMD("key_locker_expiry_date", "12-31");
    const all = this.getMembers(), rows = [];
    all.forEach((m, idx) => {
      if (this.isWithdrawn(m)) return;
      const l = S.lockers[m.memberId] || { mainLocker: "", deposit: 0, yearFee: 0, contractDate: "", expireDate: "" };
      rows.push({ memberId: m.memberId, seq: idx + 1, name: m.name, base: this.effectiveBaseAverage(m), phone: m.phone, main: l.mainLocker || "", deposit: l.deposit > 0 ? l.deposit : dep, yearFee: l.yearFee > 0 ? l.yearFee : fee,
        contract: normDate(l.contractDate) || cd, expire: normDate(l.expireDate) || ed, join: m.rejoinDate && todayStr() >= m.rejoinDate ? m.rejoinDate : m.joinDate });
    });
    return rows.sort((a, b) => b.base - a.base || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.memberId - b.memberId);
  },
});
const blank0 = (n) => n ? money(n) : "";
function lockerOps(memberId, number, deposit, yearFee, contract, expire) {
  const ex = S.lockerRows.find((r) => int(r.member_id) === memberId);
  if (number) { const dup = S.lockerRows.find((r) => int(r.member_id) !== memberId && String(r.locker_number || "").trim().toLowerCase() === number.toLowerCase()); if (dup) throw new Error(`락카번호 ${number}은(는) 이미 사용 중입니다.`); }
  const payload = { locker_number: number, member_id: memberId, deposit, yearly_fee: yearFee, contract_date: contract || "", expiry_date: expire || "", status: number ? "사용중" : "사용 가능", note: "" };
  if (!number) return ex ? [op("lockers", "delete", { ...payload, locker_id: ex.locker_id }, ex.row_version)] : [];
  if (!ex) return [op("lockers", "insert", payload)];
  const same = String(ex.locker_number || "").trim() === number && int(ex.deposit) === deposit && int(ex.yearly_fee) === yearFee && String(ex.contract_date || "") === (contract || "") && String(ex.expiry_date || "") === (expire || "") && String(ex.status || "").trim() === payload.status && String(ex.note || "").trim() === "";
  return same ? [] : [op("lockers", "update", { ...payload, locker_id: ex.locker_id }, ex.row_version)];
}
const LK = { sel: null };
TABS.lockers = {
  render() {
    const rows = Svc.lockerRows();
    const cols = [{ t: "순번", get: (r, i) => i + 1 }, { t: "회원명", get: (r) => r.name }, { t: "에버", get: (r) => r.base }, { t: "연락처", get: (r) => r.phone }, { t: "메인락커", get: (r) => r.main },
      { t: "보증금", cls: "r", get: (r) => blank0(r.deposit) }, { t: "1년사용료", cls: "r", get: (r) => blank0(r.yearFee) }, { t: "계약일", get: (r) => yymmdd(r.contract) }, { t: "만료일", get: (r) => yymmdd(r.expire) }, { t: "가입일", get: (r) => yymmdd(r.join) }];
    const table = pcTable(cols, rows, { onSelect: (r, i, dbl) => { LK.sel = r; if (dbl) editLocker(r); } });
    if (LK.sel) { const k = rows.findIndex((r) => r.memberId === LK.sel.memberId); if (k >= 0) table.querySelectorAll("tbody tr")[k].classList.add("sel"); }
    const rep = h("button", { class: "pcbtn", type: "button" }, "보고서"); rep.onclick = () => reportModal("락카 사용 현황", "", pcTable(cols, rows));
    const edit = h("button", { class: "pcbtn", type: "button" }, "수정"); edit.onclick = () => LK.sel ? editLocker(LK.sel) : toast("수정할 회원을 선택하세요.");
    view.append(h("section", { class: "pcbox" }, h("div", { class: "pcform", style: "justify-content:space-between" }, h("span", { class: "pctitle", style: "margin:0" }, `${S.year}년 한가람 B.C 락카 사용현황`), h("span", {}, rep, " ", edit, " ", roBadge()))), table);
  },
};
async function editLocker(r) {
  const mk = (v, cls = "pcin") => h("input", { class: cls, value: v ?? "" });
  const main = mk(r.main), dep = mk(r.deposit ? String(r.deposit) : ""), fee = mk(r.yearFee ? String(r.yearFee) : ""), con = mk(r.contract || ""), exp = mk(r.expire || "");
  const g = h("div", { class: "pcgrid" }, h("label", {}, "메인락커"), main, h("label", {}, "보증금"), dep, h("label", {}, "1년사용료"), fee, h("label", {}, "계약일"), con, h("label", {}, "만료일"), exp);
  const res = await modal(`락카 정보 수정 · ${r.name}`, g, canWrite() ? [["확인", "ok"], ["취소", "cancel"]] : [["닫기", "cancel"]]);
  if (res !== "ok") return;
  const num = (v, label) => { const s = v.trim().replace(/,/g, ""); if (!s) return 0; if (!/^-?\d+$/.test(s)) { toast(`${label}을 숫자로 입력하세요.`); return null; } return parseInt(s, 10); };
  const deposit = num(dep.value, "보증금"), yearFee = num(fee.value, "1년사용료"); if (deposit == null || yearFee == null) return;
  if (deposit < 0 || yearFee < 0) return toast("보증금과 1년사용료는 0 이상이어야 합니다.");
  const number = main.value.trim(), cd = con.value.trim() ? smartDate(con.value) : null, ed = exp.value.trim() ? smartDate(exp.value) : null;
  if (!number && (deposit || yearFee || cd || ed)) return toast("보증금·사용료·계약일을 입력하려면 메인락커 번호도 입력하세요.");
  let ops; try { ops = lockerOps(r.memberId, number, deposit, yearFee, cd, ed); } catch (e) { return toast(e.message, 4200); }
  if (!ops.length) return toast("락카 정보가 수정되었습니다.");
  if (await save(ops, "락카 정보가 수정되었습니다.")) { LK.sel = Svc.lockerRows().find((x) => x.memberId === r.memberId) || null; render(); }
}

/* =====================================================================
   4-8) 설정 저장 도우미 · 전분기 에버 수정
   ===================================================================== */
const settingOp = (key, value) => {
  const exists = Object.prototype.hasOwnProperty.call(S.settings, key);
  if (exists && String(S.settings[key]) === value) return null;
  const payload = { setting_key: key, setting_value: value };
  return exists ? op("app_settings", "update", payload, S.rv.settings[key]) : op("app_settings", "insert", payload);
};
function quarterOps(memberId, year, serverQ, value) {
  const key = `${memberId}|${year}|${serverQ}`, exists = key in S.sq, remove = !(value > 0), payload = { member_id: memberId, year, quarter: serverQ };
  if (remove) return exists ? [op("quarter_base_averages", "delete", payload, S.rv.quarters[key])] : [];
  payload.average = value;
  if (!exists) return [op("quarter_base_averages", "insert", payload)];
  return S.sq[key] === value ? [] : [op("quarter_base_averages", "update", payload, S.rv.quarters[key])];
}
Object.assign(Svc, {
  basicWeeksUntilNextFebruary() { return [...this.basicWeeks(S.year), ...this.basicWeeks(S.year + 1).filter((w) => monthOf(w.date) <= 2)]; },
  quarterStored(m, q) {
    if (!m || q < 2 || q > 4) return null; const now = todayStr();
    if (S.year > yearOf(now)) return null;
    if (S.year === yearOf(now) && q > this.quarterFromDate(now)) return null;
    return this.quarterBaseAverage(m, S.year, q);
  },
});
const nz = (n) => n != null && n > 0 ? String(n) : "";
/* ---- 환경설정 도우미 (PC PcSettingsOutboxStore.validateAndNormalize / LedgerCategorySettings) ---- */
Object.assign(LC, {
  LINKS: ["일반", "게임기록", "회비관리", "락카관리", "정모/비모", "이벤트·상주전", "회원관리", "외부·금융"],
  groupsOf(type) { return type === "지출" ? this.EX_GROUPS : this.IN_GROUPS; },
  serialize(items) { return items.map((i) => `${i.type}\t${i.name}\t${i.group}\t${i.link}\t${i.use ? "1" : "0"}`).join("\n"); },
  isLocked: (i) => i.type === "수입" && i.name === "회비",
  validate(raw) {
    const clean = [], seen = new Set(); let hasFee = false;
    for (const it of this.parse(raw)) {
      const k = it.type + "|" + it.name; if (seen.has(k)) throw new Error("같은 대분류에 중복된 항목이 있습니다: " + it.name); seen.add(k);
      if (/[\t\n]/.test(it.name)) throw new Error("항목 이름에 사용할 수 없는 문자가 있습니다.");
      const gs = this.groupsOf(it.type), locked = this.isLocked(it); if (locked) hasFee = true;
      clean.push({ ...it, group: gs.includes(it.group) ? it.group : gs[gs.length - 1], use: locked || it.use });
    }
    if (!hasFee) clean.unshift({ type: "수입", name: "회비", group: "회원수입", link: "회비관리", use: true });
    return this.serialize(clean);
  },
});
const uniqLines = (v) => [...new Set(String(v || "").replace(/\r/g, "").split("\n").map((x) => x.trim()).filter(Boolean))];
function validateSetting(key, raw) {
  const v = String(raw ?? "").replace(/\r/g, "").trim();
  if (key === "key_management_name") { if (!v) throw new Error("관리 명칭을 입력하세요."); return v; }
  if (key === "key_grade_list") { const g = uniqLines(v); if (!g.length) throw new Error("등급을 한 개 이상 입력하세요."); return g.join("\n"); }
  if (["key_fee_amount", "key_locker_deposit", "key_locker_yearly_fee"].includes(key)) {
    const s = v.replace(/,/g, ""); const n = /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 2147483647) throw new Error("회비·락카 금액은 0 이상의 정수로 입력하세요.");
    return String(n);
  }
  if (key === "key_locker_contract_date" || key === "key_locker_expiry_date") {
    const m = v.match(/^(\d{2})-(\d{2})$/), dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > dim[+m[1] - 1]) throw new Error("락카 기본일은 MM-dd 형식으로 입력하세요.");
    return v;
  }
  if (key === "key_meeting_types") { const t = uniqLines(v); if (!t.length) t.push("정모", "비모"); if (t.length > 10) throw new Error("모임구분은 최대 10개까지 입력할 수 있습니다."); return t.join("\n"); }
  if (key === "key_ledger_categories") return LC.validate(v);
  throw new Error("지원하지 않는 공용 환경설정 키입니다: " + key);
}
const fmtThousands = (raw) => { if (raw == null) return ""; const d = String(raw).replace(/,/g, "").trim(); return /^\d{1,15}$/.test(d) ? Number(d).toLocaleString("en-US") : String(raw).trim(); };
const lockerDisp = (raw, year) => {
  if (raw == null || !String(raw).trim()) return ""; const p = (String(raw).match(/\d+/g) || []).slice(0, 3).map(Number);
  if (p.length === 2) return `${pad2(year % 100)}/${pad2(p[0])}/${pad2(p[1])}`;
  if (p.length === 3) return `${pad2(p[0] % 100)}/${pad2(p[1])}/${pad2(p[2])}`;
  return String(raw).trim();
};
const lockerParse = (text) => { const t = String(text || "").trim(); if (!t) return ""; const p = (t.match(/\d+/g) || []).slice(0, 4).map(Number); return p.length === 2 || p.length === 3 ? `${pad2(p[p.length - 2])}-${pad2(p[p.length - 1])}` : t; };
const envWeek = (l) => { const m = /^(\d+)월\s*(\d+)주차$/.exec(l || ""); return m ? `${pad2(+m[1])}월${pad2(+m[2])}주` : l; };
const effShared = (key) => {
  if (Object.prototype.hasOwnProperty.call(S.settings, key)) return String(S.settings[key]);
  return { key_management_name: S.programTitle, key_grade_list: S.gradeTypes.join("\n"), key_fee_amount: String(S.monthlyFee), key_locker_deposit: "0", key_locker_yearly_fee: "0", key_locker_contract_date: "01-01", key_locker_expiry_date: "12-31", key_meeting_types: S.meetingTypes.join("\n") }[key];
};

/* =====================================================================
   4-9) 환경설정 (PC openEnvironmentSettingsDialog: 기본 DATA / 서버관리 / 수입/지출)
        ※ PC '기초 자료' 탭의 모임구분·주차별·분기 에버 표·전분기 에버 수정은 환경설정 '기본 DATA'로 합쳤어요.
   ===================================================================== */
const ST = { sub: "basic", logs: [], sel: null };
const stLog = (t) => { ST.logs.unshift([new Date().toLocaleTimeString("ko-KR", { hour12: false }), t]); };
const secBox = (title, ...kids) => h("section", { class: "envsec" }, h("div", { class: "envsec-h" }, title), h("div", { class: "envsec-b" }, kids));
const numList = (title, fields) => secBox(title, h("div", { class: "envlist" }, fields.map((f, i) => h("div", { class: "envitem" }, h("span", {}, String(i + 1)), f))));
TABS.settings = {
  render() {
    const ro = !canWrite(), year = new Date().getFullYear();
    const inp = (v, o = {}) => h("input", { class: "pcin", style: "width:100%", value: v ?? "", disabled: ro, ...o });
    /* ---- 기본 DATA ---- */
    const nameF = inp(effShared("key_management_name"), { maxlength: "60", style: "width:100%;text-align:left" });
    const mFields = Array.from({ length: 10 }, (_, i) => inp(S.meetingTypes[i] || "", { maxlength: "20" }));
    const gFields = Array.from({ length: 10 }, (_, i) => inp(S.gradeTypes[i] || "", { maxlength: "20" }));
    const feeF = inp(fmtThousands(effShared("key_fee_amount")), { inputmode: "numeric" }), depF = inp(fmtThousands(effShared("key_locker_deposit")), { inputmode: "numeric" }), yfF = inp(fmtThousands(effShared("key_locker_yearly_fee")), { inputmode: "numeric" });
    const cdF = inp(lockerDisp(effShared("key_locker_contract_date"), year)), edF = inp(lockerDisp(effShared("key_locker_expiry_date"), year));
    const yearF = inp(`${year}년`, { readonly: true, disabled: false });
    [feeF, depF, yfF].forEach((f) => f.onblur = () => { f.value = fmtThousands(f.value); }); [cdF, edF].forEach((f) => f.onblur = () => { f.value = lockerDisp(f.value, year); });
    const pair = (l, f) => h("div", { class: "envitem env2" }, h("label", {}, l), f);
    const other = secBox("기타", h("div", { class: "envother" }, pair("해당년도", yearF), pair("월회비", feeF), pair("락카 보증금", depF), pair("락카 연사용료", yfF), pair("락카 계약일", cdF), pair("락카 만료일", edF)));
    const weeks = Svc.basicWeeksUntilNextFebruary(), members = Svc.getMembers();
    const weekT = pcTable([{ t: "게임일", get: (r) => shortMD(r.date) }, { t: "주차", get: (r) => envWeek(r.label) }], weeks.length ? weeks : [{ date: "", label: "" }]);
    const qrows = members.map((m) => ({ m, name: m.name, base: String(Svc.effectiveBaseAverage(m)), q: [1, 2, 3, 4].map((q) => nz(q === 1 ? Svc.quarterBaseAverage(m, S.year, 1) : Svc.quarterStored(m, q))), dec: nz(Svc.decisionAverage(m)) }));
    const qcols = [{ t: "회원명", get: (r) => r.name }, { t: "기준에버", get: (r) => r.base }, ...[0, 1, 2, 3].map((k) => ({ t: `${k + 1}분기에버`, get: (r) => r.q[k] })), { t: "결정에버", get: (r) => r.dec }];
    const qT = pcTable(qcols, qrows, { onSelect: (r) => { ST.sel = r.m; } });
    const dq = () => Math.max(1, Math.floor(new Date().getMonth() / 3) + 1 - 1);
    qT.querySelectorAll("tbody tr").forEach((tr, i) => tr.addEventListener("dblclick", (e) => { const td = e.target.closest("td"); if (!td) return; const c = [...tr.children].indexOf(td); if (c >= 2 && c <= 5) { ST.sel = qrows[i].m; editBasicQuarter(qrows[i].m, c - 1); } }));
    const editQ = h("button", { class: "pcbtn", type: "button", onclick: () => editBasicQuarter(ST.sel, dq()) }, "전분기 에버 수정");
    const basic = h("div", {}, h("div", { class: "pcform", style: "margin:6px 0" }, h("label", { style: "font-size:16px" }, "관리 명칭"), h("div", { style: "flex:1;min-width:220px;max-width:420px" }, nameF)),
      h("div", { class: "envband" }, numList("모임", mFields), numList("등급", gFields), other),
      h("div", { class: "envdata" }, secBox("주차별", weekT), secBox("분기 에버", h("div", { style: "text-align:right;margin-bottom:6px" }, editQ), qT)),
      h("p", { class: "pcnote" }, "관리 명칭·모임구분·등급·회비·락카 기본값·수입/지출 목록은 서버 공용입니다."));
    /* ---- 수입/지출 ---- */
    const E = { rows: { 수입: [], 지출: [] }, type: "수입", sel: -1 };
    const loadE = (items) => { E.rows = { 수입: [], 지출: [] }; items.forEach((i) => E.rows[i.type].push({ name: i.name, group: i.group, link: i.link, use: i.use, locked: LC.isLocked(i) })); };
    loadE(LC.items());
    const edBody = h("div"), typeBox = h("div", { class: "envtypes" });
    const drawE = () => {
      const rows = E.rows[E.type]; typeBox.textContent = "";
      for (const t of ["수입", "지출"]) typeBox.append(h("button", { type: "button", class: "envtype " + (t === "수입" ? "in" : "ex") + (E.type === t ? " on" : ""), onclick: () => { E.type = t; E.sel = -1; drawE(); } }, `${t}  (중분류 ${E.rows[t].length}개)`));
      const body = h("tbody");
      rows.forEach((r, i) => {
        const dis = ro || r.locked;
        const nm = h("input", { class: "pcin", style: "width:100%;text-align:left", value: r.name, disabled: dis, maxlength: "40", "data-n": String(i), oninput: (e) => { r.name = e.target.value; } });
        const gp = selectEl(LC.groupsOf(E.type), r.group); gp.disabled = dis; gp.onchange = () => { r.group = gp.value; };
        const lk = selectEl(LC.LINKS, LC.LINKS.includes(r.link) ? r.link : "일반"); lk.disabled = dis; lk.onchange = () => { r.link = lk.value; };
        const us = h("input", { type: "checkbox", disabled: dis }); us.checked = r.locked || r.use; us.onchange = () => { r.use = us.checked; };
        const tr = h("tr", { class: E.sel === i ? "sel" : "" }, h("td", {}, String(i + 1)), h("td", {}, nm), h("td", {}, gp), h("td", {}, lk), h("td", {}, us));
        tr.onclick = (e) => { if (E.sel === i) return; body.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel")); tr.classList.add("sel"); E.sel = i; };
        body.append(tr);
      });
      edBody.textContent = ""; edBody.append(h("div", { class: "rsec", style: `color:${E.type === "수입" ? "#1b64da" : "#c83237"};font-size:17px` }, `${E.type} 항목 (중분류)`),
        h("div", { class: "pctable-wrap", style: "max-height:420px" }, h("table", { class: "pct", style: "min-width:520px" }, h("thead", {}, h("tr", {}, ["번호", "중분류 항목", "연간집계 구분", "연동 위치", "사용"].map((t) => h("th", {}, t)))), body)));
    };
    const rowsNow = () => E.rows[E.type];
    const needSel = (msg) => { if (E.sel < 0 || E.sel >= rowsNow().length) { toast(msg); return false; } return true; };
    const edBtn = (t, fn) => h("button", { class: "pcbtn", type: "button", disabled: ro, onclick: fn }, t);
    const btns = h("div", { class: "envbtns" },
      edBtn("항목 추가", () => { const gs = LC.groupsOf(E.type); rowsNow().push({ name: "", group: gs[gs.length - 1], link: "일반", use: true, locked: false }); E.sel = rowsNow().length - 1; drawE(); const n = edBody.querySelector(`[data-n="${E.sel}"]`); n && n.focus(); }),
      edBtn("항목 수정", () => { if (!needSel("수정할 항목을 선택하세요.")) return; if (rowsNow()[E.sel].locked) return toast("'회비'는 회비관리와 연동되어 수정할 수 없습니다."); const n = edBody.querySelector(`[data-n="${E.sel}"]`); n && n.focus(); }),
      edBtn("항목 삭제", async () => { if (!needSel("삭제할 항목을 선택하세요.")) return; const r = rowsNow()[E.sel]; if (r.locked) return toast("'회비'는 회비관리와 연동되어 삭제할 수 없습니다."); if (!(await confirmBox(`'${r.name}' 항목을 목록에서 삭제하시겠습니까?\n(이미 입력된 장부 내역은 변경되지 않습니다.)`))) return; rowsNow().splice(E.sel, 1); E.sel = Math.min(E.sel, rowsNow().length - 1); drawE(); }),
      edBtn("▲ 위로", () => { const i = E.sel, rs = rowsNow(); if (i < 1) return; [rs[i - 1], rs[i]] = [rs[i], rs[i - 1]]; E.sel = i - 1; drawE(); }),
      edBtn("▼ 아래로", () => { const i = E.sel, rs = rowsNow(); if (i < 0 || i >= rs.length - 1) return; [rs[i + 1], rs[i]] = [rs[i], rs[i + 1]]; E.sel = i + 1; drawE(); }),
      edBtn("기본값 복원", async () => { if (!(await confirmBox("수입·지출 중분류 목록을 기본값으로 되돌립니다.\n(확인 버튼을 눌러 저장하기 전까지는 서버에 반영되지 않습니다.)"))) return; loadE(LC.defaults()); E.sel = -1; drawE(); }));
    const ledger = h("div", { class: "enved" }, h("div", {}, h("div", { class: "rsec", style: "font-size:17px" }, "대분류"), typeBox,
      h("p", { class: "pcnote" }, "대분류를 선택하면 해당 중분류 목록이 표시됩니다.", h("br"), "※ 대분류(수입/지출)는 고정이며 중분류만 추가·수정·삭제합니다.", h("br"), "※ 장부 입력의 '내역'은 구분(수입/지출) 선택에 따라 이 목록이 표시되고, 목록에 없는 내역도 직접 입력할 수 있습니다.", h("br"), "※ 이 목록은 서버 공용 설정으로 PC·모바일이 함께 사용합니다.")), edBody, btns);
    drawE();
    /* ---- 서버관리 ---- */
    const statusV = h("b", { style: "color:#566070" }, "●  상태 확인 전"), logBody = h("tbody");
    const drawLog = () => { logBody.textContent = ""; ST.logs.slice(0, 30).forEach(([t, w]) => logBody.append(h("tr", {}, h("td", {}, t), h("td", { class: "l" }, w)))); };
    const work = (t) => { stLog(t); drawLog(); };
    const checkBtn = h("button", { class: "pcbtn sm", type: "button" }, "상태 확인");
    const check = async () => {
      checkBtn.disabled = true; statusV.textContent = "●  확인 중..."; statusV.style.color = "#c98019";
      try { const snap = await Conn.snapshot(); statusV.textContent = `●  정상 (서버 v${snap.dataVersion})`; statusV.style.color = "#12a442"; work(`서버 상태 확인: 정상 (v${snap.dataVersion})`); }
      catch (e) { statusV.textContent = "●  확인 실패"; statusV.style.color = "#c83237"; work("서버 상태 확인 실패: " + e.message); }
      checkBtn.disabled = false;
    };
    checkBtn.onclick = check;
    const bigBtn = (t, fn, dis) => h("button", { class: "pcbtn envbig", type: "button", disabled: !!dis, onclick: fn }, t);
    const backup = () => {
      const snap = { exportedAt: new Date().toISOString(), dataVersion: S.dataVersion, settings: S.settings, members: S.members, games: S.games, ledger: S.ledger, fees: S.fees, lockers: S.lockers, quarterAdjustments: S.quarterAdjustments, yearBaseSeeds: S.yearBaseSeeds };
      const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(snap, null, 1)], { type: "application/json" })), download: `bowling-club-backup-${todayStr()}.json` }); document.body.append(a); a.click(); a.remove(); work("자료 백업 파일 저장");
    };
    const server = h("div", {}, h("div", { class: "envtwo" },
      secBox("자료 관리", h("div", { class: "envbtnrow" }, bigBtn("↥  자료 백업", backup), bigBtn("↧  자료 복원", () => toast("자료 복원·초기화는 PC 프로그램에서 사용해요."), true), bigBtn("⚙  초기화", () => toast("자료 복원·초기화는 PC 프로그램에서 사용해요."), true))),
      secBox("동기화 관리", h("div", { class: "envbtnrow" }, bigBtn("↻  서버 원본 동기화", async () => { try { await reload("서버 최신 자료를 다시 불러왔어요."); work("서버 원본 동기화"); render(); } catch (e) { toast(e.message); } }), bigBtn("↥  UpLoad", () => toast("웹에서는 저장하는 즉시 서버에 반영돼요."))))),
      secBox("서버 정보 및 관리", h("div", { class: "envinfo" }, h("span", {}, "Supabase 프로젝트 URL"), h("span", {}, "https://***********.supabase.co ", h("button", { class: "pcbtn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(VH_URL); work("Supabase 프로젝트 URL 복사"); toast("복사했어요."); } catch { toast("복사하지 못했어요."); } } }, "복사")),
        h("span", {}, "프로젝트 상태"), h("span", {}, statusV, " ", checkBtn), h("span", {}, "마지막 재시작 시간"), h("span", {}, "-"), h("span", {}, "앱 버전"), h("span", {}, "웹 클럽관리")),
        h("p", { class: "pcnote" }, "✓ 서버 상태를 확인하여 PC/모바일이 최신 자료로 동작합니다.", h("br"), "✓ 프로젝트 URL은 보안상 일부만 표시됩니다.", h("br"), "※ 승인관리·서버 재실행은 모바일 볼링클럽/서버 관리 화면에서 처리해요.")),
      secBox("최근 작업", h("div", { class: "pctable-wrap", style: "max-height:180px" }, h("table", { class: "pct", style: "min-width:0" }, h("thead", {}, h("tr", {}, h("th", { style: "width:110px" }, "시간"), h("th", {}, "작업 내용"))), logBody))));
    drawLog(); setTimeout(check, 0);
    /* ---- 하단 확인/취소 ---- */
    const panels = { basic, server, ledger }, tabsRow = h("div", { class: "envtabs" });
    const showSub = () => { tabsRow.textContent = ""; for (const [k, t] of [["basic", "기본 DATA"], ["server", "서버관리"], ["ledger", "수입/지출"]]) tabsRow.append(h("button", { type: "button", class: "pcbtn" + (ST.sub === k ? " on" : ""), onclick: () => { ST.sub = k; showSub(); } }, t)); for (const k in panels) panels[k].hidden = k !== ST.sub; };
    showSub();
    const okBtn = h("button", { class: "pcbtn", type: "button", style: "min-width:90px", disabled: ro }, "확인"), cancelBtn = h("button", { class: "pcbtn", type: "button", style: "min-width:90px", onclick: () => go(ST.back || "games") }, "취소");
    okBtn.onclick = async () => {
      const lines = (fs) => fs.map((f) => f.value.trim()).filter(Boolean);
      const meet = [...new Set(lines(mFields))]; if (!meet.length) meet.push("정모", "비모");
      const proposed = { key_management_name: nameF.value, key_fee_amount: feeF.value.replace(/[, ]/g, "").trim(), key_locker_deposit: depF.value.replace(/[, ]/g, "").trim(), key_locker_yearly_fee: yfF.value.replace(/[, ]/g, "").trim(), key_locker_contract_date: lockerParse(cdF.value), key_locker_expiry_date: lockerParse(edF.value), key_grade_list: lines(gFields).join("\n") };
      try {
        const catRaw = LC.validate(LC.serialize(["수입", "지출"].flatMap((t) => E.rows[t].filter((r) => r.name.trim()).map((r) => ({ type: t, name: r.name.trim(), group: r.group, link: r.link, use: r.locked || r.use })))));
        const curCat = Object.prototype.hasOwnProperty.call(S.settings, "key_ledger_categories") ? S.settings.key_ledger_categories : null;
        if (curCat != null || catRaw !== LC.validate(LC.serialize(LC.defaults()))) proposed.key_ledger_categories = catRaw;
        const meetRaw = meet.join("\n"), curMeet = Object.prototype.hasOwnProperty.call(S.settings, "key_meeting_types") ? S.settings.key_meeting_types : null;
        if (curMeet != null || meetRaw !== S.meetingTypes.join("\n")) proposed.key_meeting_types = meetRaw;
        const ops = [];
        for (const [k, v] of Object.entries(proposed)) {
          const n = validateSetting(k, v), exists = Object.prototype.hasOwnProperty.call(S.settings, k);
          const def = k === "key_ledger_categories" ? LC.serialize(LC.defaults()) : effShared(k);
          if (!exists && def != null && validateSetting(k, def) === n) continue;
          const o = settingOp(k, n); if (o) ops.push(o);
        }
        if (!ops.length) { toast("변경된 내용이 없어요."); return go(ST.back || "games"); }
        okBtn.disabled = true;
        if (await save(ops, `환경설정이 저장되었습니다. (서버 공용 변경 ${ops.length}건)`)) { work(`환경설정 저장 ${ops.length}건`); go(ST.back || "games"); } else okBtn.disabled = false;
      } catch (e) { toast("환경설정을 저장하지 못했습니다.\n" + e.message, 4200); }
    };
    view.append(h("section", { class: "pcbox" }, h("div", { class: "pcform", style: "justify-content:space-between" }, tabsRow, roBadge()), basic, server, ledger,
      h("div", { style: "text-align:center;margin-top:10px" }, okBtn, " ", cancelBtn)));
    showSub();
  },
};
async function editBasicQuarter(m, defQ) {
  if (!m) return toast("회원이 표시된 행을 선택하세요.");
  const ro = (v) => h("input", { class: "pcin", value: v, readonly: true });
  const sel = selectEl([["1", "1분기"], ["2", "2분기"], ["3", "3분기"], ["4", "4분기"]], String(Math.max(1, Math.min(4, defQ))));
  const val = h("input", { class: "pcin", inputmode: "numeric" });
  const sync = () => { val.value = nz(Svc.quarterBaseAverage(m, S.year, +sel.value)); val.select(); }; sel.onchange = sync; sync();
  const res = await modal("기초자료 전분기 에버 수정", h("div", { class: "pcgrid" }, h("label", {}, "회원명"), ro(m.name), h("label", {}, "연도"), ro(`${S.year}년`), h("label", {}, "분기"), sel, h("label", {}, "에버"), val), canWrite() ? [["확인", "ok"], ["취소", "cancel"]] : [["닫기", "cancel"]]);
  if (res !== "ok") return;
  const s = val.value.trim().replace(/,/g, ""); if (!/^-?\d+$/.test(s)) return toast("에버를 숫자로 입력하세요.");
  const avg = parseInt(s, 10); if (avg < 0) return toast("에버는 0 이상이어야 합니다.");
  const q = +sel.value, ops = quarterOps(m.memberId, S.year, q, avg);
  const msg = `${m.name} ${q}분기 에버가 수정되었습니다.`;
  if (!ops.length) return toast(msg);
  if (await save(ops, msg)) render();
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
function linkView(st) {
  $("pchead").hidden = true; $("appName").textContent = "클럽관리"; view.textContent = "";
  const id = h("input", { class: "pcin", placeholder: "클럽(모바일 볼링클럽) 아이디", autocomplete: "off", autocapitalize: "off", maxlength: "20" });
  const pw = h("input", { class: "pcin", type: "password", placeholder: "클럽 비밀번호", autocomplete: "off" });
  const msg = h("div", { class: "msg" + (st.reason ? " err" : "") }, st.reason === "not_approved" ? "연결된 클럽 계정이 아직 승인되지 않았어요. 관리자 승인 후 다시 열어 주세요." : "");
  const btn = h("button", { class: "btn", type: "button" }, "연결하기");
  btn.onclick = async () => {
    if (!id.value.trim() || !pw.value) { msg.className = "msg err"; msg.textContent = "클럽 아이디와 비밀번호를 입력해 주세요."; return; }
    btn.disabled = true;
    try { await Conn.linkClub(id.value.trim(), pw.value); pw.value = ""; await boot(); }
    catch (e) { msg.className = "msg err"; msg.textContent = e.message; btn.disabled = false; }
  };
  pw.onkeydown = (e) => { if (e.key === "Enter") btn.click(); };
  view.append(h("section", { class: "card pclogin" }, h("h2", {}, "🔗 클럽 계정 연결"),
    h("p", { class: "lead" }, `${st.site ? st.site.name + "님, " : ""}홈페이지 관리자·운영진 계정으로 확인되었어요. 클럽관리를 쓰려면 본인의 클럽(모바일 볼링클럽) 계정을 한 번 연결해 주세요.`),
    h("p", { class: "pcnote" }, "• 연결하면 다음부터는 홈페이지 로그인만으로 들어와요.", h("br"), "• 읽기·입력 권한은 연결한 클럽 계정의 권한(관리자 / 조회+입력 / 조회 전용)이 그대로 적용돼요.", h("br"), "• 비밀번호는 연결 확인에만 쓰이고 저장되지 않아요."),
    id, pw, msg, btn,
    h("div", { class: "orline" }, "또는"), h("button", { class: "btn ghost", type: "button", onclick: () => { sessionStorage.setItem("clubSkipSite", "1"); loginView(); } }, "클럽 계정으로만 로그인")));
}
async function unlinkClub() {
  if (!(await confirmBox("이 홈페이지 계정과 클럽 계정의 연결을 해제할까요?\n해제하면 다시 클럽 비밀번호로 연결해야 해요."))) return;
  try { await Conn.unlinkClub(); await Conn.logout(); sessionStorage.removeItem("clubSkipSite"); await boot(); } catch (e) { toast(e.message); }
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
  if (st.need === "link") return linkView(st);
  if (st.need) return loginView(st.reason);
  try { await reload(); } catch (e) { if (e.message === "login") return loginView("expired"); view.textContent = ""; view.append(h("section", { class: "card" }, "자료를 불러오지 못했어요: " + e.message)); return; }
  const k = location.hash.replace("#", ""); if (TITLES[k]) current = k;
  render();
}
boot();
