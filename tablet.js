/* =====================================================================
   12.4인치 태블릿 가로 화면 (모바일 볼링클럽 Large* 화면 이식) — PC·노트북 전용
   - 상단: FILE · 게임기록 · 회계장부 · 회비관리 · 분기에버 · [입력|조회] · 사용자 · 로그아웃
   - 각 화면: 1행 입력(입력 모드) / 2행 조회 조건(조회 모드) / 결과표(+오른쪽 상세)
   - 규칙: LargeGameFragment · LargeLedgerFragment · LargeFeeFragment · LargeMemberFragment · LargeLockerFragment,
           MeetingRoleRule(최고하이·에버하이·올카), QuarterAdjustRule(조정에버 입력 시작일), MemberLifecycleUtils
   - 저장: club.js 의 save()/op() (PC·모바일과 같은 서버 원자적 업로드)
   ===================================================================== */
(function () {
  const TB = { input: null, wasOn: null };
  const TB_ON = () => window.innerWidth >= 900 && document.documentElement.getAttribute("data-dev") === "desktop";
  const PHONE = () => !TB_ON(); // 휴대폰·일반 태블릿 세로(좁은 화면): 모바일 볼링클럽 세로화면 배치
  const MODE_KEY = () => (TB_ON() ? "tb" : "ph");
  const TB_KEYS = ["games", "ledger", "fees", "quarter", "album", "members", "lockers"];
  const TAB_LABEL = { games: "게임기록", ledger: "회계장부", fees: "회비관리", quarter: "분기에버", album: "기록앨범" };
  const canIn = () => !VIEWONLY && canWrite();
  // PC·노트북 클럽관리는 입력모드 전용 (입력/조회 전환 없음), 세로 화면은 앱처럼 전환
  const inputMode = () => { if (TB_ON() && !VIEWONLY) return canIn(); if (TB.input == null) TB.input = canIn(); return TB.input && canIn(); };
  const won = (v) => Number(v || 0).toLocaleString("ko-KR");
  const fmt1 = (d) => (d <= 0 ? "-" : d.toFixed(1));
  const sgn1 = (d) => (d >= 0 ? "+" : "") + d.toFixed(1);
  const today = () => todayStr();
  const dnum = (s) => +s.slice(8, 10), mnum = (s) => +s.slice(5, 7), ynum = (s) => +s.slice(0, 4);
  const dow = (s) => new Date(s + "T00:00:00").getDay();
  const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const monthEnd = (y, m) => ymd(y, m, new Date(y, m, 0).getDate());
  const ko = new Intl.Collator("ko", { sensitivity: "base" });

  /* ---------- 회원 상태 (MemberLifecycleUtils) ---------- */
  const withdrawn = (m, ref = today()) => !!m.withdrawalDate && ref >= m.withdrawalDate && (!m.rejoinDate || ref < m.rejoinDate);
  const isActive = (m, ref) => !m.deletedAt && !withdrawn(m, ref);
  const allMembers = () => S.members.filter((m) => !m.deletedAt).sort((a, b) => a.memberId - b.memberId);
  const activeMembers = () => allMembers().filter((m) => isActive(m));
  const byId = () => new Map(S.members.map((m) => [m.memberId, m]));
  const includedForRanking = (m, d) => !!m && isActive(m) && (!m.rejoinDate || d >= m.rejoinDate);

  /* 회원별 기준에버: 기준일 분기의 분기에버 → 없으면 직전 분기 → 회원 현재 기준에버 */
  function qBase(m, date = today()) {
    if (!m) return 0;
    const y = ynum(date), q = Math.floor((mnum(date) - 1) / 3) + 1;
    const ex = S.sq[`${m.memberId}|${y}|${q}`];
    if (ex != null) return ex;
    const [py, pq] = q === 1 ? [y - 1, 4] : [y, q - 1];
    const pv = S.sq[`${m.memberId}|${py}|${pq}`];
    return pv != null ? pv : m.currentBaseAverage;
  }

  /* ---------- 게임 기록 도우미 ---------- */
  const sc = (g) => [g.s1, g.s2, g.s3, g.s4];
  const cnt = (g) => sc(g).filter((v) => v > 0).length;
  const tot = (g) => sc(g).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const gavg = (g) => (cnt(g) ? tot(g) / cnt(g) : 0);
  const smax = (g) => Math.max(...sc(g));
  const recAvg = (list) => { const c = list.reduce((a, g) => a + cnt(g), 0); return c ? list.reduce((a, g) => a + tot(g), 0) / c : 0; };
  const weekLabel = (d) => `${mnum(d)}월${Math.floor((dnum(d) - 1) / 7) + 1}주`;
  const weekKey = (d) => `${ynum(d)}|${mnum(d)}|${Math.floor((dnum(d) - 1) / 7)}`;
  const gtype = (g) => (g.meetingType || "").trim() || "정모";
  /* 탈퇴 회원의 기록은 조회에서 제외 */
  const tbGames = () => { const act = new Set(activeMembers().map((m) => m.memberId)); return S.games.filter((g) => act.has(g.memberId)); };
  const statGames = () => { const mm = byId(); return tbGames().filter((g) => includedForRanking(mm.get(g.memberId), g.gameDate)); };
  function weekGroups(games) {
    const ds = [...new Set(games.map((g) => g.gameDate))].sort();
    const out = [], idx = new Map();
    for (const d of ds) { const k = weekKey(d); if (!idx.has(k)) { idx.set(k, out.length); out.push({ label: weekLabel(d), key: k, dates: [] }); } out[idx.get(k)].dates.push(d); }
    return out;
  }
  const deviation = (avg, base) => (base > 0 && avg > 0 ? sgn1(avg - base) : "-");
  const nameWithAvg = (m, d) => { if (!m) return "-"; const b = qBase(m, d); return b > 0 ? `${m.name}(${b})` : m.name; };
  const yearEndRef = (y) => (y === ynum(today()) ? today() : `${y}-12-31`);

  /* 최고하이 / 에버하이 / 올카 (MeetingRoleRule: 정모만 판정) */
  function roleMap(list) {
    const mm = byId(), base = (g) => qBase(mm.get(g.memberId), g.gameDate), noteKey = (g) => String(g.note || "").replace(/\s+/g, "");
    const out = new Map(), groups = new Map();
    for (const g of list) { const k = g.gameDate + "|" + gtype(g); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
    const maxBy = (arr, cmp) => arr.reduce((best, x) => (best == null || cmp(x, best) > 0 ? x : best), null);
    for (const grp of groups.values()) {
      if (gtype(grp[0]) !== "정모") continue;
      const topCmp = (a, b) => (smax(a) - smax(b)) || (base(a) - base(b));
      const marked = grp.filter((g) => noteKey(g).includes("최고하이"));
      const top = maxBy(marked.length ? marked : grp.filter((g) => smax(g) > 0), topCmp);
      if (top) out.set(top.recordId, { role: "HIGH", diff: smax(top) - base(top) });
      const devCmp = (a, b) => ((smax(a) - base(a)) - (smax(b) - base(b))) || (base(a) - base(b));
      const markedEver = grp.filter((g) => noteKey(g).includes("에버하이") && (!top || g.memberId !== top.memberId));
      const ever = maxBy(markedEver, devCmp) || maxBy(grp.filter((g) => (!top || g.memberId !== top.memberId) && smax(g) > 0 && base(g) > 0), devCmp);
      if (ever) out.set(ever.recordId, { role: "EVER", diff: smax(ever) - base(ever) });
      grp.filter((g) => noteKey(g).includes("올카") && (!top || g.memberId !== top.memberId) && (!ever || g.memberId !== ever.memberId))
        .forEach((g) => out.set(g.recordId, { role: "ALL", diff: smax(g) - base(g) }));
    }
    return out;
  }
  /* 점수 칸 강조 대상: 최고하이 기록의 최고 점수 칸 (recordId*10+게임번호) */
  function meetingHighRefs(list, roles) {
    const refs = new Set();
    list.filter((g) => roles.get(g.recordId)?.role === "HIGH").forEach((g) => { const mx = smax(g); sc(g).forEach((v, i) => { if (mx > 0 && v === mx) refs.add(g.recordId * 10 + i + 1); }); });
    return refs;
  }
  function highRefs(list) {
    let max = 0; const refs = new Set();
    list.forEach((g) => sc(g).forEach((v, i) => { if (v > 0) { if (v > max) { max = v; refs.clear(); refs.add(g.recordId * 10 + i + 1); } else if (v === max) refs.add(g.recordId * 10 + i + 1); } }));
    return max > 0 ? refs : new Set();
  }
  const ROW_BG = { HIGH: "#FFE08A", EVER: "#BBDEFB", ALL: "#C8E6C9" };
  function scoreCell(g, i, refs, roles) {
    const v = sc(g)[i - 1], role = roles && roles.get(g.recordId);
    if (role && (role.role === "HIGH" || role.role === "EVER") && v > 0 && v === smax(g))
      return h("span", { class: "tbstrong " + (role.role === "HIGH" ? "hi" : "ev") }, v);
    const high = v > 0 && refs.has(g.recordId * 10 + i), red = v >= 200;
    return h("span", { style: `color:${high ? "#8B0000" : red ? "#B42318" : "#12285A"};font-weight:${high || red ? 700 : 400}` }, v > 0 ? v : "");
  }
  const noteOf = (g, roles) => { const r = roles.get(g.recordId); return r && r.role === "EVER" ? `에버하이 : ${r.diff >= 0 ? "+" : ""}${r.diff}` : g.note; };

  /* 조정에버 입력 시작일 (QuarterAdjustRule) */
  const QA = {
    lastMeeting(dates, y, q) {
      const lm = q * 3; let d = monthEnd(y, lm);
      const counts = new Map(); dates.forEach((x) => counts.set(dow(x), (counts.get(x) || 0) + 1));
      let usual = null, best = -1; for (const [k, v] of counts) if (v > best) { best = v; usual = k; }
      if (usual != null) while (dow(d) !== usual) d = addDays(d, -1);
      const rec = dates.filter((x) => ynum(x) === y && mnum(x) === lm).sort().pop();
      return rec && rec > d ? rec : d;
    },
    prevWeek(dates, y, q) {
      const last = this.lastMeeting(dates, y, q), pw = Math.floor((dnum(last) - 1) / 7) - 1;
      const listed = dates.filter((x) => ynum(x) === ynum(last) && mnum(x) === mnum(last) && Math.floor((dnum(x) - 1) / 7) === pw).sort().pop();
      return listed || addDays(last, -7);
    },
    openFrom(dates, y, q) { return addDays(this.prevWeek(dates, y, q), 1); },
    isOpen(dates, y, q) { return today() >= this.openFrom(dates, y, q); },
  };

  /* ---------- 공통 UI ---------- */
  /* 목록에서 하나 고르기 (회비 수정: 납부일별 기록 선택) */
  function pickList(title, labels) {
    return new Promise((res) => {
      const close = (v) => { $("modal").hidden = true; res(v); };
      $("modalTitle").textContent = title;
      const b = $("modalBody"); b.textContent = "";
      b.append(h("div", { class: "tbpicklist" }, labels.map((t, i) => h("button", { type: "button", onclick: () => close(i) }, t))));
      const f = $("modalFoot"); f.textContent = ""; f.append(h("button", { type: "button", class: "pcbtn", onclick: () => close(null) }, "닫기"));
      $("modal").hidden = false;
    });
  }
  const lab = (t) => h("span", { class: "tblab" }, t);
  const btn = (t, onclick, cls = "") => h("button", { type: "button", class: "tbbtn " + cls, onclick }, t);
  const sel = (opts, value, onchange, cls = "") => { const s = h("select", { class: "tbsel " + cls }, opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v }, t); })); if (value != null) s.value = value; if (onchange) s.onchange = () => onchange(s.value); return s; };
  const card = (...kids) => {
    const list = kids.flat().filter((k) => k != null && k !== false), out = [];
    for (let i = 0; i < list.length; i++) {
      const k = list[i], nx = list[i + 1];
      if (k.classList && k.classList.contains("tblab") && nx && nx.nodeType === 1 && !(nx.classList && (nx.classList.contains("tblab") || nx.classList.contains("tbbtn")))) {
        const c = nx.classList || { contains: () => false };
        out.push(h("label", { class: "tbf" + (c.contains("num") ? " sm" : c.contains("note") || c.contains("wide") ? " full" : "") }, k, nx)); i++;
      } else out.push(k);
    }
    return h("div", { class: "tbcard" }, ...out);
  };
  const spacer = () => h("span", { style: "flex:1" });
  const empty = (msg) => h("div", { class: "tbtable" }, h("div", { class: "tbempty" }, msg));
  /* 결과표: 머리글 고정, 행 클릭 = 선택/불러오기, 길게 누르기·오른쪽 클릭 = 삭제/취소 */
  let KEEP_SCROLL = false; // 표에서 행을 눌러 다시 그릴 때 스크롤 위치 유지
  function table({ headers, rows, weights, aligns = [], selectedRow = -1, cellColor, cellBg, custom, onClick, onLong, cls = "" }) {
    if (!rows.length) return null;
    const sum = weights.reduce((a, b) => a + b, 0);
    const t = h("table", { style: PHONE() ? `min-width:${Math.round(Math.max(330, headers.length * 60, weights.reduce((a, b) => a + b, 0) * 0.7))}px` : "" }, h("colgroup", {}, weights.map((w) => h("col", { style: `width:${(w / sum * 100).toFixed(3)}%` }))),
      h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))));
    const tb = h("tbody");
    rows.forEach((r, i) => {
      const tr = h("tr", { class: i === selectedRow ? "sel" : "" });
      r.forEach((v, c) => {
        const own = custom && custom(i, c);
        const td = h("td", { class: aligns[c] === 1 ? "l" : aligns[c] === 2 ? "r" : "" }, own || String(v ?? ""));
        const fg = cellColor && cellColor(i, c); if (fg) td.style.color = fg;
        const bg = i !== selectedRow && cellBg && cellBg(i, c); if (bg) td.style.background = bg;
        if (!own) td.title = String(v ?? "");
        tr.append(td);
      });
      if (onClick) tr.onclick = () => { KEEP_SCROLL = true; onClick(i); };
      if (onLong) {
        tr.oncontextmenu = (e) => { e.preventDefault(); onLong(i); };
        let tm; tr.onpointerdown = (e) => { if (e.pointerType === "mouse") return; tm = setTimeout(() => onLong(i), 650); };
        tr.onpointerup = tr.onpointerleave = () => clearTimeout(tm);
      }
      tb.append(tr);
    });
    t.append(tb);
    return h("div", { class: "tbtable " + cls }, t);
  }
  function infoBox(title, items) {
    return h("div", { class: "tbinfo" }, h("b", {}, title), ...items.map(([k, v]) => h("div", { class: "tbline" }, h("span", {}, k), h("b", {}, v))));
  }
  function root(...kids) {
    kids = kids.filter(Boolean);
    const sub = $("pcsub");
    if (VIEWONLY && TB_ON() && sub) {
      sub.textContent = "";
      const i = kids.findIndex((k) => k.classList && k.classList.contains("tbcard"));
      if (i >= 0) { sub.append(...kids[i].childNodes); kids.splice(i, 1); }
    }
    const keep = KEEP_SCROLL; KEEP_SCROLL = false;
    const tops = keep ? [...view.querySelectorAll(".tbtable, .tbright, .tbdetail")].map((e) => e.scrollTop) : null;
    const r = h("div", { class: "tbroot" }, ...kids); view.textContent = ""; view.append(r); fit();
    if (tops) {
      const put = () => { [...r.querySelectorAll(".tbtable, .tbright, .tbdetail")].forEach((e, i) => { if (tops[i] != null) e.scrollTop = tops[i]; });
        r.querySelectorAll(".tbtable").forEach((t) => { const sel = t.querySelector("tr.sel"); if (!sel) return; const a = t.getBoundingClientRect(), b = sel.getBoundingClientRect(), hd = t.querySelector("thead") ? t.querySelector("thead").offsetHeight : 0;
          if (b.bottom > a.bottom) t.scrollTop += b.bottom - a.bottom + 4; else if (b.top < a.top + hd) t.scrollTop -= a.top + hd - b.top + 4; }); };
      put(); requestAnimationFrame(put);
    }
    return r;
  }
  function fit() {
    const r = view.querySelector(":scope > .tbroot"); if (!r) return;
    if (PHONE()) { r.style.height = ""; document.documentElement.classList.remove("fitpage"); return; }
    window.scrollTo(0, 0);
    const nav = $("bnav"), navTop = nav && !nav.hidden && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : window.innerHeight;
    r.style.height = Math.max(360, navTop - r.getBoundingClientRect().top - 6) + "px";
    document.documentElement.classList.add("fitpage");
  }
  window.addEventListener("resize", () => { if (TB.wasOn != null && TB.wasOn !== MODE_KEY() && typeof render === "function" && $("pchead") && !$("pchead").hidden) render(); else fit(); });

  /* =====================================================================
     게임기록 / 분기에버 (LargeGameFragment)
     ===================================================================== */
  const GS = { report: "개인기록", linked: null, sort: "평균점수", date: null, type: null, member: null, editing: 0, lockedType: null, lockedWeek: null, scores: ["", "", "", ""], note: "", qOpt: null, qMember: null, draft: {}, inited: false };
  const typeList = () => (S.meetingTypes && S.meetingTypes.length ? S.meetingTypes : ["정모", "비모"]);

  function applyMeetingTypeRule(week) {
    if (GS.lockedType && week !== GS.lockedWeek) { GS.lockedType = null; GS.lockedWeek = null; }
    if (GS.lockedType) GS.type = GS.lockedType;
    else if (GS.editing <= 0) { const n = +(week.match(/(\d+)월(\d+)주/) || [0, 0, 1])[2]; const want = n === 1 || n === 3 ? "정모" : "비모"; GS.type = typeList().includes(want) ? want : typeList()[0]; }
  }
  function inputMembersFor(games, anyType) {
    const key = weekKey(GS.date), type = GS.type || "정모";
    const reg = new Set(games.filter((g) => g.recordId !== GS.editing && weekKey(g.gameDate) === key && (anyType || gtype(g) === type)).map((g) => g.memberId));
    const editMember = GS.editing > 0 ? (games.find((g) => g.recordId === GS.editing) || {}).memberId : null;
    return activeMembers().filter((m) => !reg.has(m.memberId) || m.memberId === editMember).sort((a, b) => ko.compare(a.name.trim(), b.name.trim()) || a.memberId - b.memberId);
  }

  const MOPEN = new Set(); // 펼친 월 (접힘이 기본)
  const toggleM = (k) => { MOPEN.has(k) ? MOPEN.delete(k) : MOPEN.add(k); KEEP_SCROLL = true; RENDER[current](); };
  function renderGames(quarterOnly) {
    const games = tbGames(), stat = statGames(), groups = weekGroups(games), mm = byId();
    const inMode = inputMode() && !quarterOnly;
    if (!GS.inited && games.length) { GS.date = games.reduce((a, g) => (g.gameDate > a ? g.gameDate : a), ""); GS.inited = true; }
    if (!GS.date) GS.date = today();
    // 게임일: 주차 목록 + 다가오는 주차(마지막 기록 이후 2주 + 오늘 주차)
    const opts = groups.slice().reverse().map((g) => [g.label, g.dates[g.dates.length - 1]]);
    const last = games.reduce((a, g) => (g.gameDate > a ? g.gameDate : a), "") || today();
    [today(), GS.date, addDays(last, 7), addDays(last, 14)].forEach((d) => { if (!opts.some((o) => o[0] === weekLabel(d) && weekKey(o[1]) === weekKey(d))) opts.push([weekLabel(d), d]); });
    opts.sort((a, b) => (a[1] < b[1] ? 1 : -1));
    if (GS.type == null) applyMeetingTypeRule(weekLabel(GS.date));

    let inputCard = null, batchRow = null;
    if (inMode) {
      const dSel = sel(opts.map((o, i) => [String(i), o[0]]), String(Math.max(0, opts.findIndex((o) => weekKey(o[1]) === weekKey(GS.date)))), (v) => {
        const o = opts[+v]; if (weekLabel(GS.date) !== o[0] || weekKey(GS.date) !== weekKey(o[1])) GS.date = o[1];
        applyMeetingTypeRule(o[0]); draw();
      });
      const tSel = sel(typeList(), GS.type, (v) => { GS.type = v; draw(); });
      tSel.disabled = !!GS.lockedType;
      const ims = inputMembersFor(games);
      if (!ims.some((m) => m.memberId === GS.member)) GS.member = ims.length ? ims[0].memberId : null;
      const mSel = sel(ims.length ? ims.map((m) => [m.memberId, m.name]) : [["", "등록 가능한 회원 없음"]], GS.member, (v) => { GS.member = +v; });
      mSel.disabled = !ims.length; mSel.id = "tbMember"; mSel.classList.add("wide");
      const scoreIn = GS.scores.map((v, i) => h("input", { class: "tbin num", inputmode: "numeric", maxlength: "3", value: v }));
      const noteIn = h("input", { class: "tbin note", value: GS.note });
      // 3자리를 입력하면 다음 칸(1G→2G→3G→4G→비고)으로 자동 이동
      scoreIn.forEach((e, i) => { e.oninput = () => { e.value = e.value.replace(/\D/g, "").slice(0, 3); GS.scores[i] = e.value; if (e.value.length === 3) (scoreIn[i + 1] || noteIn).focus(); }; e.onkeydown = (ev) => { if (ev.key === "Enter") saveInput(GS.editing > 0); }; });
      noteIn.oninput = () => GS.note = noteIn.value; noteIn.onkeydown = (ev) => { if (ev.key === "Enter") saveInput(GS.editing > 0); };
      const add = btn("등록", () => saveInput(false), "pri"), edit = btn("수정", () => saveInput(true));
      add.disabled = GS.editing > 0; edit.disabled = !(GS.editing > 0);
      inputCard = card(lab("게임일"), dSel, lab("모임 구분"), tSel, lab("회원명"), mSel, ...scoreIn.flatMap((e, i) => [lab(`${i + 1}G`), e]), lab("비고"), noteIn, add, edit);
      batchRow = h("div", { class: "tbbatch" }, h("span", { class: "tbbtitle" }, `게임기록 · ${weekLabel(GS.date)}`), GS.editing > 0 ? btn("입력 취소", () => { clearInput(); draw(); }) : null, btn("일괄변경", bulkChange));
    }

    // 2행: 보고서 종류 / 연결 필드 / 조회
    let queryCard = null;
    const reports = quarterOnly ? ["분기에버"] : (PHONE() || VIEWONLY) && !inMode ? ["개인기록", "모임기록", "누적기록", "순위표", "분기에버"] : ["개인기록", "모임기록", "누적기록", "순위표"];
    if (!reports.includes(GS.report)) GS.report = reports[0];
    const report = quarterOnly ? "분기에버" : GS.report;
    let linkedOpts = [], linkedLabel = "";
    const qOpts = (() => { const y = ynum(today()); return [[`${pad2((y - 1) % 100)}_4분기`, y - 1, 4], ...[1, 2, 3, 4].map((q) => [`${q}분기`, y, q])]; })();
    if (report === "개인기록") { linkedLabel = "회원명"; linkedOpts = activeMembers().map((m) => [String(m.memberId), m.name]); }
    else if (report === "모임기록") { linkedLabel = "주차"; linkedOpts = groups.slice().reverse().map((g) => [g.key, g.label]); }
    else if (report === "누적기록") { linkedLabel = "기간"; linkedOpts = ["최근 2주", "최근 3주", "최근 4주", "최근 5주"].map((x) => [x, x]); }
    else if (report === "순위표") { linkedLabel = "기준"; linkedOpts = [...new Set([...games.map((g) => ynum(g.gameDate)), ynum(today())])].sort((a, b) => b - a).map((y) => [String(y), `${y}년`]); }
    else { linkedLabel = "분기"; linkedOpts = qOpts.map((o) => [o[0], o[0]]); }
    if (!linkedOpts.some((o) => o[0] === GS.linked)) GS.linked = report === "누적기록" ? "최근 4주" : report === "분기에버" ? qOpts[Math.min(Math.floor((mnum(today()) - 1) / 3) + 2, qOpts.length - 1)][0] : (linkedOpts[0] || [""])[0];
    if (!inMode || quarterOnly) {
      const rSel = quarterOnly ? null : sel(reports, report, (v) => { GS.report = v; GS.linked = null; draw(); });
      const lSel = sel(linkedOpts, GS.linked, (v) => { GS.linked = v; draw(); });
      const sortSel = report === "순위표" ? sel(["평균점수", "최고점수", "게임수"], GS.sort, (v) => { GS.sort = v; draw(); }) : null;
      const qEdit = quarterOnly && inputMode();
      queryCard = card(rSel, lab(linkedLabel), lSel, sortSel ? lab("정렬") : null, sortSel, btn("조회", draw, "pri"),
        qEdit ? btn("조정에버 저장", saveQuarter, "pri") : null, spacer(), qEdit ? h("span", { class: "tbbadge" }, "수정모드 : 조정에버 칸 입력 가능") : null);
    }

    // 결과표
    let title = "", body;
    const editingSel = (list) => list.findIndex((g) => GS.editing > 0 && g.recordId === GS.editing);
    if (inMode) {
      const key = weekKey(GS.date);
      title = `게임기록 · ${weekLabel(GS.date)}`;
      const list = games.filter((g) => weekKey(g.gameDate) === key).sort((a, b) => gavg(b) - gavg(a));
      const roles = roleMap(list), refs = meetingHighRefs(list, roles);
      body = table({ headers: ["회원명(에버)", "구분", "1G", "2G", "3G", "4G", "평균", "에버편차", "비고"],
        rows: list.map((g) => [nameWithAvg(mm.get(g.memberId), g.gameDate), gtype(g), "", "", "", "", fmt1(gavg(g)), deviation(gavg(g), qBase(mm.get(g.memberId), g.gameDate)), noteOf(g, roles)]),
        weights: [256, 90, 112, 112, 112, 112, 134, 146, 214], selectedRow: editingSel(list),
        cellBg: (r) => ROW_BG[(roles.get(list[r].recordId) || {}).role], custom: (r, c) => (c >= 2 && c <= 5 ? scoreCell(list[r], c - 1, refs, roles) : null),
        onClick: (i) => loadToInput(list[i]), onLong: (i) => confirmDelete(list[i]) }) || empty("이 주차에 등록된 기록이 없습니다.");
    } else if (report === "개인기록") {
      const id = +GS.linked, m = mm.get(id);
      title = `개인 기록 · ${m ? m.name : ""}`;
      const list = stat.filter((g) => g.memberId === id).sort((a, b) => (a.gameDate < b.gameDate ? 1 : -1));
      const refs = highRefs(list.filter((g) => ynum(g.gameDate) === ynum(today()) && g.gameDate <= today()));
      body = table({ headers: ["게임일", "1G", "2G", "3G", "4G", "평균", "에버편차", "비고"],
        rows: list.map((g) => [weekLabel(g.gameDate), "", "", "", "", fmt1(gavg(g)), deviation(gavg(g), qBase(m, g.gameDate)), g.note]),
        weights: [198, 124, 124, 124, 124, 148, 162, 248], custom: (r, c) => (c >= 1 && c <= 4 ? scoreCell(list[r], c, refs) : null) }) || empty("조회된 자료가 없습니다.");
    } else if (report === "모임기록") {
      const g0 = groups.find((g) => g.key === GS.linked);
      title = `모임 기록 · ${g0 ? g0.label : ""}`;
      const list = games.filter((g) => g0 && g0.dates.includes(g.gameDate)).sort((a, b) => gavg(b) - gavg(a));
      const roles = roleMap(list), refs = meetingHighRefs(list, roles);
      body = table({ headers: ["회원명(에버)", "1G", "2G", "3G", "4G", "평균", "에버편차", "비고"],
        rows: list.map((g) => [nameWithAvg(mm.get(g.memberId), g.gameDate), "", "", "", "", fmt1(gavg(g)), deviation(gavg(g), qBase(mm.get(g.memberId), g.gameDate)), noteOf(g, roles)]),
        weights: [256, 118, 118, 118, 118, 140, 152, 236],
        cellBg: (r) => ROW_BG[(roles.get(list[r].recordId) || {}).role], custom: (r, c) => (c >= 1 && c <= 4 ? scoreCell(list[r], c, refs, roles) : null) }) || empty("조회된 자료가 없습니다.");
    } else if (report === "누적기록") {
      const n = +(GS.linked.match(/\d+/) || [4])[0], gs = groups.slice(-Math.max(1, n));
      const year = gs.length ? ynum(gs[gs.length - 1].dates[gs[gs.length - 1].dates.length - 1]) : ynum(today());
      title = `모임 누적 현황 · ${year}년 기준 · ${GS.linked}`;
      const yearGames = new Map(); stat.filter((g) => ynum(g.gameDate) === year).forEach((g) => { if (!yearGames.has(g.memberId)) yearGames.set(g.memberId, []); yearGames.get(g.memberId).push(g); });
      const ids = [...yearGames.keys()].sort((a, b) => a - b);
      const groupRefs = gs.map((gr) => { const l = games.filter((g) => gr.dates.includes(g.gameDate)); return meetingHighRefs(l, roleMap(l)); });
      const cellOf = (id, k) => {
        const w = (yearGames.get(id) || []).filter((g) => gs[k].dates.includes(g.gameDate)).sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1));
        if (!w.some((g) => cnt(g) > 0)) return null;
        const span = h("span", { class: "tbcum" });
        w.forEach((g, wi) => {
          const raw = sc(g), lastI = raw.map((v) => v > 0).lastIndexOf(true); if (lastI < 0) return;
          if (wi > 0 && span.childNodes.length) span.append("  ");
          raw.slice(0, lastI + 1).forEach((v, si) => {
            if (si > 0) span.append(" / ");
            const high = v > 0 && groupRefs[k].has(g.recordId * 10 + si + 1);
            span.append(h("span", { style: high || v >= 200 ? `color:${high ? "#8B0000" : "#B42318"};font-weight:700` : "" }, v > 0 ? String(v) : "   "));
          });
        });
        span.append(h("b", {}, ` (${recAvg(w).toFixed(1).padStart(5, " ")})`));
        return span;
      };
      body = table({ headers: ["순번", "회원명(에버)", "누적에버", "출석일수", ...gs.map((g) => g.label.replace("월", "월 "))],
        rows: ids.map((id, i) => { const l = yearGames.get(id); return [String(i + 1), nameWithAvg(mm.get(id), yearEndRef(year)), fmt1(recAvg(l)), String(new Set(l.map((g) => g.gameDate)).size), ...gs.map(() => "")]; }),
        weights: [60, 150, 100, 90, ...gs.map(() => (n <= 4 ? 260 : 200))], aligns: [0, 0, 0, 0, ...gs.map(() => 2)], cls: n >= 5 ? "small" : "",
        custom: (r, c) => (c >= 4 ? cellOf(ids[r], c - 4) : null) }) || empty("조회된 자료가 없습니다.");
    } else if (report === "순위표") {
      const year = +GS.linked || ynum(today());
      title = `순위표 · ${year}년`;
      const agg = new Map(); stat.filter((g) => ynum(g.gameDate) === year).forEach((g) => { if (!agg.has(g.memberId)) agg.set(g.memberId, []); agg.get(g.memberId).push(g); });
      let rows = [...agg.entries()].map(([id, l]) => ({ m: mm.get(id), cnt: l.reduce((a, g) => a + cnt(g), 0), avg: recAvg(l), best: Math.max(...l.map(smax)) })).filter((r) => r.cnt > 0);
      rows.sort(GS.sort === "최고점수" ? (a, b) => b.best - a.best : GS.sort === "게임수" ? (a, b) => b.cnt - a.cnt : (a, b) => b.avg - a.avg);
      if (!rows.some((r) => r.m && r.m.memberId === GS.rankMember)) GS.rankMember = rows.length && rows[0].m ? rows[0].m.memberId : null;
      const rtbl = table({ headers: ["순위", "회원명(기준에버)", "등급", "게임수", "평균점수", "최고점수", "에버편차"],
        rows: rows.map((r, i) => [String(i + 1), nameWithAvg(r.m, yearEndRef(year)), (r.m && r.m.grade) || "-", String(r.cnt), fmt1(r.avg), String(r.best), deviation(r.avg, qBase(r.m, yearEndRef(year)))]),
        weights: [90, 250, 140, 110, 140, 140, 140], selectedRow: rows.findIndex((r) => r.m && r.m.memberId === GS.rankMember),
        onClick: (i) => { GS.rankMember = rows[i].m.memberId; RENDER[current](); } }) || empty("조회된 자료가 없습니다.");
      const wm = mm.get(GS.rankMember);
      const rdet = h("div", { class: "tbdetail" }, h("b", { class: "tbdh" }, wm ? `${wm.name} · ${year}년 상세내역` : "회원을 선택하세요"));
      const mine = stat.filter((g) => g.memberId === GS.rankMember && ynum(g.gameDate) === year);
      const trr = (vals, cls) => h("tr", { class: cls || "" }, vals.map((v) => h("td", {}, v)));
      const line = (lbl, rs) => {
        const c = rs.reduce((a, g) => a + cnt(g), 0); if (!c) return [lbl, "-", "-", "-", "-", "-", "-", "-"];
        const per = [0, 1, 2, 3].map((i) => rs.reduce((a, g) => a + (sc(g)[i] > 0 ? sc(g)[i] : 0), 0));
        const tot = per.reduce((a, b) => a + b, 0), avg = recAvg(rs), bw = rs.reduce((a, g) => a + qBase(mm.get(g.memberId), g.gameDate) * cnt(g), 0) / c;
        return [lbl, ...per.map((v) => (v > 0 ? String(v) : "-")), String(tot), fmt1(avg), bw > 0 ? sgn1(avg - bw) : "-"];
      };
      for (let mo = 1; mo <= 12; mo++) {
        const recs = mine.filter((g) => mnum(g.gameDate) === mo), k = `r${year}-${mo}`, isOpen = MOPEN.has(k);
        rdet.append(h("div", { class: "tbmh tgl", onclick: () => toggleM(k) }, h("b", {}, h("i", { class: "chv" }, isOpen ? "▾" : "▸"), `${mo}월`), h("b", { class: "blue" }, "에버 : " + (recs.some((g) => cnt(g) > 0) ? fmt1(recAvg(recs)) : "-"))));
        const wc = recs.some((g) => Math.floor((dnum(g.gameDate) - 1) / 7) >= 4) ? 5 : 4;
        rdet.append(h("table", { class: "tbmini rk" }, h("tbody", {}, trr(["구분", "1G", "2G", "3G", "4G", "Total", "Avg", "편차"], "hd"),
          ...(isOpen ? Array.from({ length: wc }, (_, w) => trr(line(`${w + 1}주`, recs.filter((g) => Math.floor((dnum(g.gameDate) - 1) / 7) === w)), w % 2 ? "alt" : "")) : []),
          trr(line("Total", recs), "tot"))));
      }
      body = h("div", { class: "tbsplit" }, h("div", { style: "flex:55;min-width:0;display:flex" }, rtbl), h("div", { style: "flex:45;min-width:0;display:flex" }, rdet));
    } else {
      const o = qOpts.find((x) => x[0] === GS.linked) || qOpts[qOpts.length - 1];
      const r = renderQuarter(o, stat, games); title = r.title; body = r.body;
    }

    function draw() { renderGames(quarterOnly); }
    function clearInput() { GS.editing = 0; GS.scores = ["", "", "", ""]; GS.note = ""; }
    function loadToInput(g) {
      if (!inMode) return;
      GS.editing = g.recordId; GS.date = g.gameDate; GS.type = gtype(g); GS.member = g.memberId;
      GS.scores = sc(g).map((v) => (v > 0 ? String(v) : "")); GS.note = g.note || ""; draw();
    }
    async function confirmDelete(g) {
      if (!inMode) return;
      if (!(await confirmBox("선택한 기록을 삭제하시겠습니까?"))) return;
      clearInput();
      await save([op("games", "delete", gamePayload(g), S.rv.games[g.recordId])], "게임 기록이 삭제되었습니다.");
    }
    async function saveInput(update) {
      if (!canIn()) return;
      const m = mm.get(GS.member); if (!m) return toast("등록 가능한 회원이 없습니다.");
      const s = [];
      for (let i = 0; i < 4; i++) { const t = String(GS.scores[i] || "").trim(); const v = t ? (/^\d+$/.test(t) ? +t : null) : 0; if (v == null) return toast(`${i + 1}G 점수를 숫자로 입력하세요.`); if (v < 0 || v > 300) return toast(`${i + 1}G 점수는 0~300 사이여야 합니다.`); s.push(v); }
      if (update && !(GS.editing > 0)) return toast("표에서 수정할 기록을 선택하세요.");
      const rec = { recordId: update ? GS.editing : 0, memberId: m.memberId, gameDate: GS.date, s1: s[0], s2: s[1], s3: s[2], s4: s[3], note: String(GS.note || "").trim(), meetingType: GS.type || "정모" };
      const ok = await save([op("games", update ? "update" : "insert", gamePayload(rec), update ? S.rv.games[GS.editing] : undefined)], update ? "게임 기록이 수정되었습니다." : "게임 기록이 저장되었습니다.");
      if (!ok) return;
      GS.lockedWeek = weekLabel(GS.date); GS.lockedType = rec.meetingType;
      clearInput(); applyMeetingTypeRule(GS.lockedWeek); draw();
      setTimeout(() => { const ms = $("tbMember"); if (ms) ms.focus(); }, 30); // 저장 후 다음 회원 입력
    }
    async function bulkChange() {
      if (!canIn()) return;
      const key = weekKey(GS.date), wk = weekLabel(GS.date), targets = games.filter((g) => weekKey(g.gameDate) === key);
      if (!targets.length) return toast(`${wk}에 변경할 기록이 없습니다.`);
      const cur = [...new Set(targets.map(gtype))].join("/");
      const r = await modal("모임 구분 일괄변경", h("p", { style: "margin:0" }, `${wk} ${targets.length}건 (현재 ${cur})`, h("br"), "바꿀 모임 구분을 선택하세요."), [...typeList().map((t) => [t, t]), ["취소", null]]);
      if (!r) return;
      const per = new Map(); targets.forEach((g) => per.set(g.memberId, (per.get(g.memberId) || 0) + 1));
      if ([...per.values()].some((v) => v > 1)) return toast("같은 회원의 기록이 2건 이상이라 일괄변경할 수 없습니다.");
      const ops = targets.filter((g) => gtype(g) !== r).map((g) => op("games", "update", gamePayload({ ...g, meetingType: r }), S.rv.games[g.recordId]));
      if (!ops.length) return toast(`이미 모두 ${r}입니다.`);
      if (await save(ops, `${wk} ${ops.length}건을 ${r}(으)로 변경했습니다.`)) { GS.lockedWeek = wk; GS.lockedType = r; clearInput(); applyMeetingTypeRule(wk); draw(); }
    }
    async function saveQuarter() {
      if (!canIn()) return;
      const o = qOpts.find((x) => x[0] === GS.linked); if (!o) return;
      const dates = games.map((g) => g.gameDate);
      if (!QA.isOpen(dates, o[1], o[2])) { const op1 = QA.openFrom(dates, o[1], o[2]); return toast(`조정에버는 ${mnum(op1)}월 ${dnum(op1)}일부터 입력할 수 있습니다.`); }
      document.querySelectorAll(".tbadj").forEach((e) => { GS.draft[`${o[1]}-${o[2]}-${e.dataset.id}`] = e.value; });
      const ops = [];
      Object.entries(GS.draft).forEach(([k, v]) => { const [y, q, id] = k.split("-").map(Number); if (y !== o[1] || q !== o[2]) return; const n = /^\d+$/.test(String(v).trim()) ? +v : 0; if (n >= 1 && n <= 300) ops.push(...quarterOps(id, y, q, n)); });
      GS.draft = {};
      if (!ops.length) { toast("저장할 조정에버 값이 없습니다."); return draw(); }
      await save(ops, `조정에버 ${ops.length}명이 저장되었습니다.`);
    }

    root(inputCard, batchRow, queryCard, inMode ? null : h("div", { class: "tbtitle" }, title), h("div", { class: "tbbody" }, body));
  }

  function renderQuarter(o, stat, games) {
    const [label, y, q] = o, mm = byId();
    const act = activeMembers();
    const [py, pq] = q === 1 ? [y - 1, 4] : [y, q - 1];
    const dates = games.map((g) => g.gameDate);
    const curY = ynum(today()), curQ = Math.floor((mnum(today()) - 1) / 3) + 1;
    const inProgress = y === curY && q === curQ && !QA.isOpen(dates, y, q);
    const months = [q * 3 - 2, q * 3 - 1, q * 3];
    const rows = act.map((m) => {
      const exact = S.sq[`${m.memberId}|${y}|${q}`];
      const pv = S.sq[`${m.memberId}|${py}|${pq}`];
      const base = exact != null ? exact : pv != null ? pv : m.currentBaseAverage;
      const recs = stat.filter((g) => g.memberId === m.memberId && ynum(g.gameDate) === y && months.includes(mnum(g.gameDate)));
      return { id: m.memberId, cells: ["", m.name, m.grade || "-", base > 0 ? String(base) : "-", fmt1(recAvg(recs)), inProgress ? "진행중" : exact != null ? String(exact) : ""] };
    });
    const editable = inputMode(), open = QA.isOpen(dates, y, q);
    let title = `분기 기준에버 · ${label}`;
    if (editable && !open) { const lk = QA.openFrom(dates, y, q); title += ` · 조정에버는 ${mnum(lk)}/${dnum(lk)}부터 입력`; }
    if (!rows.some((r) => r.id === GS.qMember)) GS.qMember = rows.length ? rows[0].id : null;
    const tbl = table({ headers: ["순번", "회원명", "등급", "기준에버", "누적에버", "조정에버"], rows: rows.map((r, i) => [String(i + 1), ...r.cells.slice(1)]),
      weights: [135, 271, 203, 203, 203, 237], selectedRow: rows.findIndex((r) => r.id === GS.qMember),
      onClick: (i) => { document.querySelectorAll(".tbadj").forEach((e) => { GS.draft[`${y}-${q}-${e.dataset.id}`] = e.value; }); GS.qMember = rows[i].id; RENDER[current](); },
      custom: (r, c) => {
        if (c !== 5 || !editable) return null;
        const k = `${y}-${q}-${rows[r].id}`;
        const e = h("input", { class: "tbin adj " + (open ? "tbadj" : "lock"), inputmode: "numeric", maxlength: "3", placeholder: open ? "" : "잠김", value: inProgress ? "진행중" : (GS.draft[k] ?? rows[r].cells[5]) });
        e.dataset.id = rows[r].id; if (!open) e.disabled = true;
        e.onclick = (ev) => ev.stopPropagation();
        return e;
      } }) || empty("조회된 자료가 없습니다.");
    // A영역: 선택 회원의 분기 월별 상세내역
    const who = mm.get(GS.qMember);
    const summary = (lbl, recs) => {
      const c = recs.reduce((a, g) => a + cnt(g), 0);
      if (!c) return [lbl, "-", "-", "-", "-"];
      const avg = recAvg(recs), best = Math.max(...recs.map(smax));
      const bw = recs.reduce((a, g) => a + qBase(mm.get(g.memberId), g.gameDate) * cnt(g), 0) / c;
      return [lbl, String(c), fmt1(avg), String(best), bw > 0 ? sgn1(avg - bw) : "-"];
    };
    const detail = h("div", { class: "tbdetail" }, h("b", { class: "tbdh" }, who ? `${who.name} · 상세내역` : "회원을 선택하세요"));
    months.forEach((mo) => {
      const recs = stat.filter((g) => g.memberId === GS.qMember && ynum(g.gameDate) === y && mnum(g.gameDate) === mo);
      const k = `q${y}-${mo}`, isOpen = MOPEN.has(k);
      detail.append(h("div", { class: "tbmh tgl", onclick: () => toggleM(k) }, h("b", {}, h("i", { class: "chv" }, isOpen ? "▾" : "▸"), `${mo}월`), h("b", { class: "blue" }, "에버 : " + (recs.some((g) => cnt(g) > 0) ? fmt1(recAvg(recs)) : "-"))));
      const wc = recs.some((g) => Math.floor((dnum(g.gameDate) - 1) / 7) >= 4) ? 5 : 4;
      const tr = (vals, cls) => h("tr", { class: cls || "" }, vals.map((v) => h("td", {}, v)));
      detail.append(h("table", { class: "tbmini" }, h("tbody", {}, tr(["구분", "게임수", "총에버", "최고게임", "편차"], "hd"),
        ...(isOpen ? Array.from({ length: wc }, (_, w) => tr(summary(`${w + 1}주`, recs.filter((g) => Math.floor((dnum(g.gameDate) - 1) / 7) === w)), w % 2 ? "alt" : "")) : []),
        tr(summary("Total", recs), "tot"))));
    });
    return { title, body: h("div", { class: "tbsplit" }, h("div", { style: "flex:55;min-width:0;display:flex" }, tbl), h("div", { style: "flex:45;min-width:0;display:flex" }, detail)) };
  }

  /* =====================================================================
     회계장부 (LargeLedgerFragment)
     ===================================================================== */
  const LS = { date: null, type: "수입", cat: null, amount: "", note: "", editing: 0, showAll: false, month: null, pickedFrom: null };
  const mkey = (d) => d.slice(0, 7);
  function renderLedger() {
    const inMode = inputMode(), all = S.ledger.filter((e) => e.date);
    if (!LS.date) LS.date = today();
    const keys = new Set(all.map((e) => mkey(e.date))); keys.add(mkey(today()));
    const latest = all.reduce((a, e) => (e.date > a ? e.date : a), ""); if (latest) keys.add(mkey(addDays(latest, 1)));
    const monthKeys = [...keys].sort().reverse();
    if (!monthKeys.includes(LS.month)) LS.month = monthKeys[0];
    const mLabel = (k) => (ynum(k + "-01") === ynum(today()) ? `${+k.slice(5)}월` : k);
    const signed = (e) => (e.type === "수입" ? e.amount : -e.amount);

    let inputCard = null, queryCard = null;
    if (inMode) {
      const dIn = h("input", { class: "tbin date", type: "date", value: LS.date }); dIn.onchange = () => { LS.date = dIn.value || today(); LS.pickedFrom = LS.date; renderLedger(); };
      const tSel = sel(["수입", "지출"], LS.type, (v) => { LS.type = v; LS.cat = null; renderLedger(); });
      const cats = LC.names(LS.type); if (LS.cat && !cats.includes(LS.cat)) cats.push(LS.cat);
      if (!cats.includes(LS.cat)) LS.cat = cats[0] || "";
      const cSel = sel(cats, LS.cat, (v) => LS.cat = v);
      const aIn = h("input", { class: "tbin amt", inputmode: "numeric", value: LS.amount }); aIn.oninput = () => LS.amount = aIn.value;
      const nIn = h("input", { class: "tbin note", value: LS.note }); nIn.oninput = () => LS.note = nIn.value;
      inputCard = card(lab("일자"), dIn, lab("구분"), tSel, lab("내역"), cSel, lab("금액"), aIn, lab("비고"), nIn, btn("장부 저장", () => saveL(false), "pri"), btn("장부수정", () => saveL(true)),
        LS.editing > 0 ? btn("취소", () => { clearL(); renderLedger(); }) : null);
    } else {
      queryCard = card(lab("조회월"), sel(monthKeys.map((k) => [k, mLabel(k)]), LS.month, (v) => { LS.month = v; LS.showAll = false; renderLedger(); }),
        btn("월별 조회", () => { LS.showAll = false; renderLedger(); }), btn("전체 조회", () => { LS.showAll = true; if (latest) { const k = mkey(addDays(latest, 1)); if (monthKeys.includes(k)) LS.month = k; } renderLedger(); }), h("span", { class: "tbsum", id: "tbLsum" }));
    }
    const key = LS.month, ty = ynum(today());
    const windowStart = inMode ? `${ty}-01-01` : null, from = inMode ? LS.pickedFrom : null;
    const sortAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ledgerId - b.ledgerId);
    let list;
    if (from) list = all.filter((e) => e.date >= from).sort(sortAsc);
    else if (windowStart) list = all.filter((e) => e.date >= windowStart && e.date <= today()).sort((a, b) => -sortAsc(a, b));
    else list = (LS.showAll || !key ? all : all.filter((e) => mkey(e.date) === key)).slice().sort(sortAsc);
    const income = list.filter((e) => e.type === "수입").reduce((a, e) => a + e.amount, 0), expense = list.filter((e) => e.type === "지출").reduce((a, e) => a + e.amount, 0);
    const firstOfMonth = key ? key + "-01" : null;
    const carry = from ? all.filter((e) => e.date < from).reduce((a, e) => a + signed(e), 0)
      : windowStart ? all.filter((e) => e.date < windowStart).reduce((a, e) => a + signed(e), 0)
      : (!firstOfMonth || LS.showAll) ? 0 : all.filter((e) => e.date < firstOfMonth).reduce((a, e) => a + signed(e), 0);
    const tbl = table({ headers: ["번호", "일자", "구분", "내역", "금액", "비고"], rows: list.map((e, i) => [String(i + 1), PHONE() ? e.date.slice(2) : e.date, e.type, e.category, won(e.amount), e.note]),
      weights: [40, 100, 50, 85, 95, 430], aligns: [0, 0, 0, 0, 2, 1], selectedRow: list.findIndex((e) => LS.editing > 0 && e.ledgerId === LS.editing),
      cellColor: (r, c) => (c === 2 ? (list[r].type === "수입" ? "#0F9D45" : "#D93025") : 0),
      onClick: (i) => loadL(list[i]), onLong: (i) => delL(list[i]) }) || empty("해당 장부 내역이 없습니다.");
    const monthNo = key ? +key.slice(5) : null, yearView = LS.showAll || inMode, janView = !yearView && monthNo === 1;
    const title = inMode ? `${pad2(ty % 100)}년 보고서` : LS.showAll ? "1년 보고서" : `${monthNo ? monthNo + "월" : "월별"} 보고서`;
    const isCarryFund = (e) => e.type === "수입" && String(e.category).trim() === "이월금";
    const carryFund = yearView || janView ? list.filter(isCarryFund).reduce((a, e) => a + e.amount, 0) : 0;
    const incomeShown = income - carryFund, carryShown = yearView || janView ? carry + carryFund : carry;
    const mEnd = !yearView && key ? monthEnd(+key.slice(0, 4), +key.slice(5)) : null;
    const total = all.filter((e) => !mEnd || e.date <= mEnd).reduce((a, e) => a + signed(e), 0);
    const line = (l, v, color, dot, bold) => h("div", { class: "tbrl" }, dot ? h("i", { style: `color:${dot}` }, "● ") : null, h("span", { style: bold ? "font-weight:700;color:" + (color === "#1A5BA8" ? "#1A5BA8" : "#12285A") : "" }, l), h("b", { style: `color:${color}` }, v));
    const report = h("div", { class: "tbreport" }, h("b", { class: "tbrt" }, title),
      h("div", { class: "tbg1" }, line("수입 합계", won(incomeShown), "#0F9D45", "#0F9D45"), line("지출 합계", won(expense), "#D93025", "#D93025")),
      h("div", { class: "tbg2" }, line("잔액", won(incomeShown - expense), incomeShown - expense < 0 ? "#D93025" : "#1A5BA8", null, true)),
      h("div", { class: "tbg3" }, line(yearView || janView ? "전년 이월" : "전월 이월", won(carryShown), "#12285A"), line("총 잔액", won(total), "#12285A", null, true)));
    // 집계(연간집계 구분 기준)
    const groupOf = new Map(LC.items().map((i) => [i.type + "|" + i.name, i.group && i.group !== "-" ? i.group : ""]));
    const src = janView || yearView ? list.filter((e) => !isCarryFund(e)) : list;
    const inc = new Map(), exp = new Map();
    src.forEach((e) => { const g = groupOf.get(e.type + "|" + e.category) || e.category || "기타"; const t = e.type === "수입" ? inc : exp; t.set(g, (t.get(g) || 0) + e.amount); });
    const agg = (label, map, color, fill, stroke, track) => {
      const rows = [...map.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...rows.map((r) => r[1]));
      return h("div", { class: "tbagg", style: `background:${fill};border-color:${stroke}` },
        h("div", { class: "tbah", style: `color:${color};border-bottom-color:${stroke}` }, h("b", {}, "● " + label), h("b", {}, won(rows.reduce((a, r) => a + r[1], 0)))),
        rows.length ? rows.map(([n, v]) => h("div", { class: "tbar" }, h("span", {}, n), h("div", { class: "trk", style: `background:${track}` }, h("i", { style: `background:${color};width:${Math.max(2, v / mx * 100)}%` })), h("b", { style: `color:${color}` }, won(v))))
          : h("div", { class: "tbna" }, "내역 없음"));
    };
    const chart = h("div", { class: "tbchart" }, h("b", { class: "tbrt" }, yearView ? "연간집계 수입/지출" : "월간집계 수입/지출"),
      inc.size || exp.size ? h("div", { class: "tbcs" }, agg("수입", inc, "#0F9D45", "#F2FAF5", "#CFE8D9", "#DDF0E4"), agg("지출", exp, "#D93025", "#FDF4F4", "#F0D3D3", "#F8DEDE")) : h("div", { class: "tbna" }, "표시할 장부 내역이 없습니다."));
    root(inputCard, queryCard, h("div", { class: "tbbody", style: "margin-top:10px" }, h("div", { style: "flex:62;min-width:0;display:flex" }, tbl), h("div", { class: "tbright", style: "flex:38" }, report, chart)));
    const sm = $("tbLsum"); if (sm) sm.textContent = `수입 ${won(income)} · 지출 ${won(expense)} · 잔액 ${won(income - expense)}`;

    function clearL() { LS.editing = 0; LS.amount = ""; LS.note = ""; }
    function loadL(e) { if (!inputMode()) return; LS.editing = e.ledgerId; LS.date = e.date; LS.type = e.type === "지출" ? "지출" : "수입"; LS.cat = e.category; LS.amount = String(e.amount); LS.note = e.note || ""; renderLedger(); }
    async function delL(e) {
      if (!inputMode()) return;
      if (!(await confirmBox("선택한 내역을 삭제하시겠습니까?"))) return;
      clearL(); await save([op("ledger_entries", "delete", ledgerPayload(e), S.rv.ledger[e.ledgerId])], "장부가 삭제되었습니다.");
    }
    async function saveL(update) {
      if (!canIn()) return;
      const amount = parseInt(String(LS.amount).replace(/,/g, ""), 10) || 0;
      if (!LS.cat) return toast("내역을 선택하세요.");
      if (amount <= 0) return toast("금액을 입력하세요.");
      if (update && !(LS.editing > 0)) return toast("표에서 수정할 내역을 선택하세요.");
      const prev = update ? S.ledger.find((x) => x.ledgerId === LS.editing) : null;
      const e = { ledgerId: update ? LS.editing : 0, date: LS.date, type: LS.type || "수입", category: LS.cat, amount, note: String(LS.note || "").trim(), fromFee: prev ? prev.fromFee : false, memberId: prev ? prev.memberId : 0 };
      if (await save([op("ledger_entries", update ? "update" : "insert", ledgerPayload(e), update ? S.rv.ledger[LS.editing] : undefined)], "저장되었습니다.")) { clearL(); renderLedger(); }
    }
  }

  /* =====================================================================
     회비관리 (LargeFeeFragment)
     ===================================================================== */
  const FS = { member: null, prepay: false, start: null, end: null, date: null, note: "", month: null };
  /* MemberLifecycleUtils.isFeeTargetMonth */
  function isFeeTarget(m, y, mo, pays) {
    if (m.feeExempt) return false;
    const key = y * 100 + mo, baseKey = m.feeStartYear * 100 + Math.min(12, Math.max(1, m.feeStartMonth || 1));
    if (key < baseKey) return false;
    const rjY = m.rejoinFeeStartYear > 0 ? m.rejoinFeeStartYear : m.rejoinDate ? ynum(m.rejoinDate) : null;
    const rjM = m.rejoinFeeStartMonth >= 1 && m.rejoinFeeStartMonth <= 12 ? m.rejoinFeeStartMonth : m.rejoinDate ? mnum(m.rejoinDate) : null;
    const rjKey = rjY != null && rjM != null ? rjY * 100 + rjM : null;
    let wKey = null;
    if (m.withdrawalDate) {
      const fin = pays.filter((p) => rjKey == null || p.year * 100 + p.month < rjKey).reduce((a, p) => Math.max(a, p.year * 100 + p.month), 0);
      wKey = fin ? (fin % 100 >= 12 ? (Math.floor(fin / 100) + 1) * 100 + 1 : fin + 1) : ynum(m.withdrawalDate) * 100 + mnum(m.withdrawalDate);
    }
    if (rjKey != null && key >= rjKey) return true;
    if (wKey != null && key >= wKey) return false;
    return true;
  }
  function renderFees() {
    const inMode = inputMode(), year = ynum(today()), tm = mnum(today());
    const members = activeMembers().filter((m) => !m.feeExempt);
    const allPays = S.fees, pays = allPays.filter((p) => p.year === year);
    if (!members.some((m) => m.memberId === FS.member)) FS.member = members.length ? members[0].memberId : null;
    if (FS.start == null) FS.start = tm; if (FS.end == null) FS.end = tm; if (!FS.date) FS.date = today(); if (!FS.month) FS.month = tm;
    const months = Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]);
    let inputCard = null, queryCard = null;
    if (inMode) {
      const pre = h("input", { type: "checkbox", class: "tbchk" }); pre.checked = FS.prepay; pre.onchange = () => { FS.prepay = pre.checked; renderFees(); };
      const sSel = sel(months, String(FS.start), (v) => { FS.start = +v; if (!FS.prepay) FS.end = FS.start; }), eSel = sel(months, String(FS.prepay ? FS.end : FS.start), (v) => FS.end = +v);
      eSel.disabled = !FS.prepay;
      const dIn = h("input", { class: "tbin date", type: "date", value: FS.date }); dIn.onchange = () => FS.date = dIn.value || today();
      const nIn = h("input", { class: "tbin", style: "width:150px", value: FS.note }); nIn.oninput = () => FS.note = nIn.value;
      inputCard = card(lab("회원명"), sel(members.map((m) => [m.memberId, m.name]), FS.member, (v) => { FS.member = +v; renderFees(); }), lab("선납"), pre, lab("시작월"), sSel, lab("종료월"), eSel,
        lab("납부일"), dIn, lab("비고"), nIn, btn("회비 등록", savePay, "pri"), btn("수정", openModify));
    } else {
      queryCard = card(lab("조회월"), sel(months, String(FS.month), (v) => { FS.month = +v; renderFees(); }), btn("회비 현황 조회", renderFees), h("span", { class: "tbsum", id: "tbFsum" }));
    }
    const month = inMode ? tm : FS.month;
    const dueMonth = year < ynum(today()) ? 12 : year === ynum(today()) ? tm : 0, displayMonth = Math.max(month, dueMonth);
    const rank = { 미납: 0, 예정: 1, 정상: 2, 완납: 3 };
    const built = members.map((m) => {
      const p = new Map(pays.filter((x) => x.memberId === m.memberId).map((x) => [x.month, x]));
      const prior = allPays.filter((x) => x.memberId === m.memberId);
      let hasUnpaid = false, curUnpaid = false, req = 0, allPaid = true;
      const cells = Array.from({ length: 12 }, (_, i) => {
        const mo = i + 1, fp = p.get(mo), active = isFeeTarget(m, year, mo, prior), exempt = active && m.executiveThreeMonthExempt && mo >= 10;
        if (active && !exempt) { req++; if (!fp) allPaid = false; }
        if (fp) return "P"; if (!active) return "N"; if (exempt) return "E";
        if (mo <= displayMonth && mo <= dueMonth) { if (year === ynum(today()) && mo === tm) { curUnpaid = true; return "S"; } hasUnpaid = true; return "O"; }
        return "N";
      });
      const status = req > 0 && allPaid ? "완납" : hasUnpaid ? "미납" : curUnpaid ? "예정" : "정상";
      return { m, status, cells, total: [...p.values()].reduce((a, x) => a + x.amount, 0) };
    });
    const sorted = built.slice().sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
    const sc2 = (s) => built.filter((b) => b.status === s).length;
    const ids = new Set(built.map((b) => b.m.memberId)), shownPays = pays.filter((p) => ids.has(p.memberId));
    const DOT = { P: "#0F9D45", S: "#E3A92B", O: "#D93025", E: "#A79FC9" };
    const ST_FG = { 미납: "#B33535", 예정: "#B07000", 정상: "#1A5BA8", 완납: "#2E7D32" }, ST_BG = { 미납: "#FFEDED", 예정: "#FFF8E1", 정상: "#E3EEFB", 완납: "#E8F5E9" };
    const tbl = table({ headers: ["순번", "회원명", "등급", "상태", ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`), "합계금액"],
      rows: sorted.map((b, i) => [String(i + 1), b.m.name, b.m.grade || "-", b.status, ...b.cells, won(b.total)]),
      weights: [44, 86, 100, 74, ...Array(12).fill(50), 104], aligns: [...Array(16).fill(0), 2],
      selectedRow: sorted.findIndex((b) => b.m.memberId === FS.member),
      cellColor: (r, c) => (c === 3 ? ST_FG[sorted[r].status] : 0), cellBg: (r, c) => (c === 3 ? ST_BG[sorted[r].status] : 0),
      custom: (r, c) => { if (c < 4 || c > 15) return null; const k = sorted[r].cells[c - 4]; return DOT[k] ? h("span", { class: "tbdot", style: `color:${DOT[k]}` }, "●") : h("span", { style: "color:#C3CBD8" }, "—"); },
      onClick: (i) => { FS.member = sorted[i].m.memberId; renderFees(); }, onLong: (i) => cancelMonth(sorted[i].m, month) }) || empty("회원 자료가 없습니다.");
    const legend = h("div", { class: "tblegend" }, ...[["#0F9D45", "납부"], ["#E3A92B", "예정(현재월)"], ["#D93025", "미납(이전 달)"], ["#A79FC9", "운영진 면제"]].flatMap(([c, l]) => [h("i", { style: `color:${c}` }, "●"), h("span", {}, l)]), h("span", {}, "— 대상 아님"));
    const selM = members.find((m) => m.memberId === FS.member), sp = pays.filter((p) => p.memberId === FS.member).sort((a, b) => a.month - b.month);
    const detail = [["회원명", selM ? selM.name : "-"], ["등급", (selM && selM.grade) || "-"], ...sp.map((p) => [`${p.month}월 납부일`, p.paidDate || "-"])];
    if (!sp.length) detail.push(["납부일", "-"]); detail.push(["합계금액", won(sp.reduce((a, p) => a + p.amount, 0))]);
    FS_MODIFY = openModify;
    if (FS.noDraw) return;
    root(inputCard, queryCard, h("div", { class: "tbbody", style: "margin-top:10px" }, h("div", { class: "tbcol", style: "flex:71" }, tbl, legend), h("div", { class: "tbright", style: "flex:29" }, infoBox("회원 상세", detail))));
    const sm = $("tbFsum"); if (sm) sm.textContent = `완납 ${sc2("완납")}명 · 정상 ${sc2("정상")}명 · 예정 ${sc2("예정")}명 · 미납 ${sc2("미납")}명 · 총납부 ${shownPays.length}건 · 총합계 ${won(shownPays.reduce((a, p) => a + p.amount, 0))}`;

    const monthsLabel = (ms) => { const s = [...new Set(ms)].sort((a, b) => a - b); if (!s.length) return ""; const parts = []; let st = s[0], pv = st; for (let i = 1; i < s.length; i++) { if (s[i] === pv + 1) { pv = s[i]; continue; } parts.push(st === pv ? `${st}월` : `${st}~${pv}월`); st = pv = s[i]; } parts.push(st === pv ? `${st}월` : `${st}~${pv}월`); return parts.join(", "); };
    async function apply(memberId, desired, msg) {
      const ops = feeOps(memberId, year, desired);
      if (!ops.length) return toast(msg);
      await save(ops, msg);
    }
    async function savePay() {
      if (!canIn()) return;
      const m = members.find((x) => x.memberId === FS.member); if (!m) return;
      const s = FS.start, e = FS.prepay ? FS.end : FS.start;
      const ms = []; for (let k = Math.min(s, e); k <= Math.max(s, e); k++) if (!(m.executiveThreeMonthExempt && k >= 10)) ms.push(k);
      if (!ms.length) return toast("등록할 회비 월이 없습니다.");
      const label = ms.length === 1 ? `${ms[0]}월` : `${ms[0]}~${ms[ms.length - 1]}월`;
      const note = String(FS.note || "").trim() || `${m.name}(${label})`;
      const list = feeCopy(m.memberId, year);
      ms.forEach((mo) => { const i = list.findIndex((f) => f.month === mo), nf = { feeId: 0, memberId: m.memberId, year, month: mo, paidDate: FS.date, amount: S.monthlyFee, note }; if (i >= 0) list[i] = { ...list[i], ...nf, feeId: list[i].feeId }; else list.push(nf); });
      FS.note = "";
      await apply(m.memberId, list, "회비가 저장되었습니다.");
    }
    async function cancelMonth(m, mo) {
      if (!inputMode() || !canIn()) return;
      if (!pays.some((p) => p.memberId === m.memberId && p.month === mo)) return toast(`${mo}월 납부 기록이 없습니다.`);
      if (!(await confirmBox(`${m.name}님의 ${year}년 ${mo}월 회비를 취소하시겠습니까?`))) return;
      await apply(m.memberId, feeCopy(m.memberId, year).filter((f) => f.month !== mo), "회비가 취소되었습니다.");
    }
    async function openModify() {
      if (!canIn()) return;
      if (!members.find((x) => x.memberId === FS.member)) return toast("수정할 회원을 먼저 선택하세요.");
      const m = members.find((x) => x.memberId === FS.member); if (!m) return toast("수정할 회원을 먼저 선택하세요.");
      if (withdrawn(m)) return toast("탈퇴 회원은 회비를 수정할 수 없습니다.");
      const mine = pays.filter((p) => p.memberId === m.memberId).sort((a, b) => (a.paidDate < b.paidDate ? -1 : a.paidDate > b.paidDate ? 1 : a.month - b.month));
      if (!mine.length) return toast("수정할 회비 기록이 없습니다.");
      const gmap = new Map(); mine.forEach((p) => { if (!gmap.has(p.paidDate)) gmap.set(p.paidDate, []); gmap.get(p.paidDate).push(p); });
      const groups = [...gmap.values()];
      let target = groups[0];
      if (groups.length > 1) {
        const pick = await pickList(`${m.name} 회비 수정`, groups.map((g) => `${mmdd(g[0].paidDate)}  |  ${g.map((p) => p.month + "월").join(", ")}${g[0].note ? " / " + g[0].note : ""}`));
        if (pick == null) return; target = groups[pick];
      }
      const selSet = new Set(target.map((p) => p.month)), reserved = new Set(mine.map((p) => p.month).filter((x) => !selSet.has(x)));
      const boxes = new Map();
      const grid = h("div", { class: "tbmonths" }, Array.from({ length: 12 }, (_, i) => { const mo = i + 1, cb = h("input", { type: "checkbox" }); cb.checked = selSet.has(mo); cb.disabled = reserved.has(mo) && !selSet.has(mo); boxes.set(mo, cb); return h("label", {}, cb, `${mo}월`); }));
      const dIn = h("input", { class: "pcin", type: "date", value: target[0].paidDate }), nIn = h("input", { class: "pcin" });
      const checked = () => [...boxes.entries()].filter(([, c]) => c.checked).map(([k]) => k);
      const gen = () => { const l = monthsLabel(checked()); nIn.value = l ? `${m.name}(${l})` : m.name; };
      boxes.forEach((c) => c.onchange = gen); gen();
      const r = await modal("회비 기록 수정", h("div", {}, h("div", { class: "pcnote" }, `${m.name} · 선납 월 선택`), grid, h("div", { class: "pcgrid" }, h("label", {}, "납부일"), dIn, h("label", {}, "비고"), nIn)), [["수정", "ok"], ["삭제", "del", "danger"], ["닫기", null]]);
      if (!r) return;
      if (r === "del") {
        const ms = checked().length ? checked() : target.map((p) => p.month);
        if (!(await confirmBox(`${m.name} ${monthsLabel(ms) || "회비"} 회비 기록을 삭제하시겠습니까?`))) return;
        const drop = new Set(target.map((p) => p.month));
        return apply(m.memberId, feeCopy(m.memberId, year).filter((f) => !drop.has(f.month)), "회비 기록이 삭제되었습니다.");
      }
      const ms = checked(); if (!ms.length) return toast("선택된 월이 없습니다.");
      const d = smartDate(dIn.value); if (!d) return toast("납부일을 확인하세요.");
      const note = nIn.value.trim() || (monthsLabel(ms) ? `${m.name}(${monthsLabel(ms)})` : m.name);
      const amount = target[0].amount || S.monthlyFee, tset = new Set(target.map((p) => p.month));
      const list = feeCopy(m.memberId, year).filter((f) => !tset.has(f.month));
      ms.forEach((mo) => list.push({ feeId: 0, memberId: m.memberId, year, month: mo, paidDate: d, amount, note }));
      await apply(m.memberId, list, "회비 기록이 수정되었습니다.");
    }
  }

  /* =====================================================================
     회원관리 (LargeMemberFragment) · 락카 (LargeLockerFragment)
     ===================================================================== */
  const MS = { q: "", sel: 0 };
  const genderTxt = (g) => (g === "MALE" ? "남" : g === "FEMALE" ? "여" : "-");
  const lockerOf = (id) => { const r = S.lockerRows.find((x) => int(x.member_id) === id); return r && String(r.locker_number || "").trim() ? r : null; };
  function renderMembers() {
    const all = allMembers(), names = [...new Set(all.map((m) => m.name.trim()).filter(Boolean))].sort(ko.compare);
    const list = MS.q ? all.filter((m) => m.name.includes(MS.q)) : all;
    if (!list.some((m) => m.memberId === MS.sel)) MS.sel = list.length ? list[0].memberId : 0;
    const act = list.filter((m) => isActive(m)).length;
    const actions = inputMode() ? [btn("회원 등록", () => memberForm(null), "pri"), btn("회원수정", () => { const m = all.find((x) => x.memberId === MS.sel); m ? editMember(m) : toast("수정할 회원을 먼저 선택하세요."); }), btn("삭제", delMember)] : [];
    const rows = list.map((m, i) => { const lk = lockerOf(m.memberId), b = qBase(m); return [String(i + 1), m.name, m.grade || "-", genderTxt(m.gender), m.phone || "-", m.joinDate || "-", b > 0 ? String(b) : "-", lk ? lk.locker_number : "-", isActive(m) ? "활동" : "탈퇴"]; });
    const tbl = table({ headers: ["번호", "회원명", "등급", "성별", "연락처", "가입일", "에버", "락카", "상태"], rows, weights: [50, 150, 90, 50, 150, 110, 60, 60, 60],
      selectedRow: list.findIndex((m) => m.memberId === MS.sel), cellColor: (r, c) => (c === 8 && rows[r][8] === "탈퇴" ? "#D93025" : 0),
      onClick: (i) => { MS.sel = list[i].memberId; renderMembers(); }, onLong: (i) => { if (inputMode()) editMember(list[i]); } }) || empty("회원 자료가 없습니다.");
    const m = list.find((x) => x.memberId === MS.sel);
    const lk = m && lockerOf(m.memberId), b = m ? qBase(m) : 0;
    const detail = m ? [["회원명", m.name], ["등급", m.grade || "-"], ["성별", genderTxt(m.gender)], ["연락처", m.phone || "-"], ["가입일", m.joinDate || "-"], ["기준 에버", b > 0 ? String(b) : "-"], ["락카", lk ? lk.locker_number : "-"],
      ["회비 면제", m.feeExempt ? "예" : "아니오"], ["회비 시작", `${m.feeStartYear || "-"}년 ${m.feeStartMonth}월`], ["운영진 3개월 면제", m.executiveThreeMonthExempt ? "예" : "아니오"],
      ["탈퇴일", m.withdrawalDate || "-"], ["재가입일", m.rejoinDate || "-"], ["상태", isActive(m) ? "활동" : "탈퇴"]] : [["회원명", "-"]];
    root(card(lab("회원명 검색"), sel([["", "전체"], ...names.map((n) => [n, n])], MS.q, (v) => { MS.q = v; renderMembers(); }), h("span", { class: "tbsum" }, `전체 ${list.length}명 · 활동 ${act}명`), spacer(), ...actions),
      h("div", { class: "tbbody", style: "margin-top:10px" }, h("div", { style: "flex:2;min-width:0;display:flex" }, tbl), h("div", { class: "tbright", style: "flex:1" }, infoBox("회원 상세기록", detail))));

    async function delMember() {
      const m = all.find((x) => x.memberId === MS.sel); if (!m) return toast("삭제할 회원을 먼저 선택하세요.");
      editMember(m); // 삭제 규칙(탈퇴 후 다음 해부터 · 서버 자료는 탈퇴일로 관리)은 회원 수정 창과 같아요
    }
  }
  async function memberForm() {
    if (!canIn()) return;
    const f = { name: h("input", { class: "pcin", maxlength: "30" }), phone: h("input", { class: "pcin", maxlength: "20", inputmode: "tel" }), grade: selectEl(S.gradeTypes, S.gradeTypes[0]),
      gender: selectEl([["", "미선택"], ["MALE", "남"], ["FEMALE", "여"]], ""), join: h("input", { class: "pcin", type: "date", value: today() }), avg: h("input", { class: "pcin", inputmode: "numeric", maxlength: "3" }) };
    const r = await modal("회원 등록", h("div", { class: "pcgrid" }, h("label", {}, "회원명"), f.name, h("label", {}, "연락처"), f.phone, h("label", {}, "등급"), f.grade, h("label", {}, "성별"), f.gender, h("label", {}, "가입일"), f.join, h("label", {}, "기준에버"), f.avg), [["등록", "ok"], ["취소", null]]);
    if (r !== "ok") return;
    const nm = f.name.value.trim(); if (!nm) return toast("이름을 입력하세요.");
    if (!/^\d+$/.test(f.avg.value.trim())) return toast("기준에버를 숫자로 입력하세요.");
    const m = { memberId: 0, name: nm, phone: f.phone.value.trim(), grade: f.grade.value || "일반", gender: f.gender.value || null, joinDate: f.join.value || null, currentBaseAverage: int(f.avg.value), feeExempt: false, feeStartMonth: f.join.value ? mnum(f.join.value) : 1, feeStartYear: f.join.value ? ynum(f.join.value) : ynum(today()), executiveThreeMonthExempt: false, withdrawalDate: null, rejoinDate: null, rejoinFeeStartMonth: 0, rejoinFeeStartYear: 0 };
    await save([op("members", "insert", memberPayload(m))], "회원이 등록되었습니다.");
  }

  const KS = { sel: 0 };
  function renderLockers() {
    const st = S.settings, dDep = int(st.key_locker_deposit), dFee = int(st.key_locker_yearly_fee), dCon = st.key_locker_contract_date || "", dExp = st.key_locker_expiry_date || "";
    const md = (v) => { const s = String(v || ""); const m = s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}-${m[3]}` : s || "-"; };
    const no = (m) => { const l = lockerOf(m.memberId); return l ? String(l.locker_number) : "-"; };
    const ms = activeMembers().sort((a, b) => { const x = no(a) === "-" ? "9999" : no(a), y = no(b) === "-" ? "9999" : no(b); return (x < y ? -1 : x > y ? 1 : 0) || ko.compare(a.name, b.name); });
    if (!ms.some((m) => m.memberId === KS.sel)) KS.sel = (ms.find((m) => no(m) !== "-") || ms[0] || {}).memberId || 0;
    const used = ms.filter((m) => no(m) !== "-");
    const depSum = used.reduce((a, m) => a + (int((lockerOf(m.memberId) || {}).deposit) || dDep), 0);
    const rows = ms.map((m, i) => { const l = lockerOf(m.memberId) || {}; return [String(i + 1), m.name, String(qBase(m)), m.phone || "-", no(m), won(int(l.deposit) || dDep), won(int(l.yearly_fee) || dFee), md(l.contract_date || dCon), md(l.expiry_date || dExp), m.joinDate || "-"]; });
    const tbl = table({ headers: ["순번", "회원명", "에버", "연락처", "메인락커", "보증금", "1년사용료", "계약일", "만료일", "가입일"], rows, weights: [70, 130, 80, 200, 100, 100, 120, 150, 150, 150],
      selectedRow: ms.findIndex((m) => m.memberId === KS.sel), onClick: (i) => { KS.sel = ms[i].memberId; renderLockers(); }, onLong: (i) => { if (inputMode()) { KS.sel = ms[i].memberId; editL(); } } }) || empty("회원 자료가 없습니다.");
    root(h("div", { class: "tbhead" }, h("b", {}, "락카 사용 현황"), h("span", {}, `사용 ${used.length} / 전체 ${ms.length} · 보증금 합계 ${won(depSum)}`), spacer(), inputMode() ? btn("수정", editL) : null),
      h("div", { class: "tbbody" }, tbl));
    async function editL() {
      if (!canIn()) return toast("입력 권한이 있는 회원만 수정할 수 있습니다.");
      const m = ms.find((x) => x.memberId === KS.sel); if (!m) return toast("수정할 회원을 선택하세요.");
      const l = lockerOf(m.memberId) || {};
      const f = (v) => h("input", { class: "pcin", value: v ?? "" });
      const nIn = f(no(m) === "-" ? "" : no(m)), dep = f(String(int(l.deposit) || dDep)), fee = f(String(int(l.yearly_fee) || dFee)), con = f(md(l.contract_date || dCon).replace(/^-$/, "")), exp = f(md(l.expiry_date || dExp).replace(/^-$/, ""));
      const r = await modal(`${m.name} 락카 수정`, h("div", { class: "pcgrid" }, h("label", {}, "번호"), nIn, h("label", {}, "보증금"), dep, h("label", {}, "1년사용료"), fee, h("label", {}, "계약일"), con, h("label", {}, "만료일"), exp),
        [["저장", "ok"], ["배정해제", "rel", "danger"], ["취소", null]]);
      if (!r) return;
      const toDate = (v) => { const s = v.trim(); if (!s) return null; if (/^\d{1,2}-\d{1,2}$/.test(s)) { const [mm2, dd] = s.split("-").map(Number); return ymd(ynum(today()), mm2, dd); } return smartDate(s); };
      let ops;
      try {
        if (r === "rel") { if (!lockerOf(m.memberId)) return toast("저장된 락카 정보가 없습니다."); ops = lockerOps(m.memberId, "", 0, 0, null, null); }
        else {
          const number = nIn.value.trim(); if (!number) return toast("락카 번호를 입력하세요.");
          ops = lockerOps(m.memberId, number, parseInt(dep.value.replace(/,/g, ""), 10) || dDep, parseInt(fee.value.replace(/,/g, ""), 10) || dFee, toDate(con.value) || (dCon ? toDate(md(dCon)) : null), toDate(exp.value) || (dExp ? toDate(md(dExp)) : null));
        }
      } catch (e) { return toast(e.message, 4200); }
      if (!ops.length) return toast("변경된 내용이 없습니다.");
      await save(ops, r === "rel" ? "락카 배정이 해제되었습니다." : "락카 현황이 저장되었습니다.");
    }
  }

  /* =====================================================================
     상단 막대 · 화면 연결
     ===================================================================== */
  /* =====================================================================
     세로 화면 입력모드 (모바일 볼링클럽 폰·태블릿 세로 화면 그대로)
     ===================================================================== */
  const pcard = (title, ...kids) => h("section", { class: "phcard" }, title ? h("b", { class: "phct" }, title) : null, ...kids.filter(Boolean));
  const psel = (opts, value, onchange, cls = "") => { const s = sel(opts, value, onchange, "phfs " + cls); return s; };
  const pbtn = (t, onclick, cls = "") => h("button", { type: "button", class: "phbtn " + cls, onclick }, t);
  /* 앞의 n개는 고정, 나머지는 아래에서만 스크롤 (세로 입력모드) */
  let PH_KEEP = false; // 펼침/접힘 때는 스크롤 위치를 그대로 유지
  function phRootF(n, ...kids) {
    const oldSc = PH_KEEP ? view.querySelector(".phscroll") : null, keepTop = oldSc ? oldSc.scrollTop : 0; PH_KEEP = false;
    const ks = kids.filter(Boolean), foot = ks.filter((k, i) => i >= n && k.classList && /\b(phsticky|phsettle|phdet|phfeestat)\b/.test(k.className)), sc = h("div", { class: "phscroll" }, ...ks.slice(n).filter((k) => !foot.includes(k)));
    const r = h("div", { class: "tbroot phroot phfixroot" }, h("div", { class: "phfixed" }, ...ks.slice(0, n)), sc, ...foot.map((f) => { f.classList.add("phfoot"); return f; }));
    view.textContent = ""; view.append(r);
    const size = () => { const top = r.getBoundingClientRect().top, bn = document.querySelector(".bnav"), bh = bn && !bn.hidden ? bn.offsetHeight : 0; r.style.setProperty("--phh", Math.max(240, window.innerHeight - top - bh - 4) + "px"); };
    size(); window.onresize = size;
    const restore = () => { size(); if (!oldSc) return; sc.scrollTop = keepTop; const o = sc.querySelector(".open"); if (o) { const a = sc.getBoundingClientRect(), b = o.getBoundingClientRect(); if (b.bottom > a.bottom) sc.scrollTop += Math.min(b.bottom - a.bottom + 8, b.top - a.top - 4); else if (b.top < a.top) sc.scrollTop -= a.top - b.top + 4; } };
    restore(); requestAnimationFrame(restore); return r;
  }
  /* 회원명 선택: 6명까지 보이고 위·아래로 끌어서 이동하는 목록 */
  function ppick(opts, value, onchange, cls = "") {
    const cur = opts.find((o) => String(o[0]) === String(value)) || opts[0] || ["", ""];
    const b = h("button", { type: "button", class: "phfs phpickbtn " + cls }, h("span", {}, cur[1]), h("i", {}, "▾"));
    b.onclick = () => {
      const close = () => { back.remove(); };
      const rowH = 44, list = h("div", { class: "phpicklist", style: `max-height:${rowH * 6}px` }, opts.map((o) => h("button", { type: "button", class: "phpickit" + (String(o[0]) === String(cur[0]) ? " on" : ""), style: `height:${rowH}px`, onclick: () => { close(); b.firstChild.textContent = o[1]; onchange(String(o[0])); } }, o[1])));
      const r = b.getBoundingClientRect(), back = h("div", { class: "phpickback", onclick: (e) => { if (e.target === back) close(); } }, list);
      list.style.left = Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 160) - 8)) + "px"; list.style.width = Math.max(r.width, 160) + "px";
      const below = innerHeight - r.bottom; list.style.top = (below >= rowH * 6 + 8 ? r.bottom + 2 : Math.max(8, r.top - rowH * 6 - 2)) + "px";
      document.body.append(back);
      const on = list.querySelector(".on"); if (on) list.scrollTop = Math.max(0, on.offsetTop - rowH * 2);
    };
    return b;
  }
  function phRoot(...kids) { const r = h("div", { class: "tbroot phroot" }, ...kids.filter(Boolean)); view.textContent = ""; view.append(r); fit(); return r; }

  /* ---- 점수관리: 점수 입력 ---- */
  function phGames() {
    const games = tbGames(), groups = weekGroups(games), mm = byId();
    if (!GS.inited && games.length) { GS.date = games.reduce((a, g) => (g.gameDate > a ? g.gameDate : a), ""); GS.inited = true; }
    if (!GS.date) GS.date = today();
    const opts = groups.slice().reverse().map((g) => [g.label, g.dates[g.dates.length - 1]]);
    const last = games.reduce((a, g) => (g.gameDate > a ? g.gameDate : a), "") || today();
    [today(), GS.date, addDays(last, 7), addDays(last, 14)].forEach((d) => { if (!opts.some((o) => weekKey(o[1]) === weekKey(d))) opts.push([weekLabel(d), d]); });
    opts.sort((a, b) => (a[1] < b[1] ? 1 : -1));
    if (GS.type == null) applyMeetingTypeRule(weekLabel(GS.date));
    const dSel = psel(opts.map((o, i) => [String(i), o[0]]), String(Math.max(0, opts.findIndex((o) => weekKey(o[1]) === weekKey(GS.date)))), (v) => { const o = opts[+v]; GS.date = o[1]; GS.editing = 0; applyMeetingTypeRule(o[0]); phGames(); });
    const tSel = psel(typeList(), GS.type, (v) => { GS.type = v; phGames(); }); tSel.disabled = !!GS.lockedType;
    const ims = inputMembersFor(games, true);
    if (!ims.some((m) => m.memberId === GS.member)) GS.member = ims.length ? ims[0].memberId : null;
    const mSel = ppick(ims.length ? ims.map((m) => [m.memberId, m.name]) : [["", "등록 가능한 회원 없음"]], GS.member, (v) => { GS.member = +v; }); mSel.disabled = !ims.length; mSel.id = "tbMember";
    const sumBar = h("div", { class: "phsumbar" });
    const scoreIn = GS.scores.map((v, i) => h("input", { class: "phin sc", inputmode: "numeric", maxlength: "3", placeholder: `${i + 1}G`, value: v }));
    const noteIn = h("input", { class: "phin note", placeholder: "비고", value: GS.note });
    const upd = () => { const v = GS.scores.map((x) => +x || 0).filter((x) => x > 0); sumBar.textContent = ""; sumBar.append(h("span", {}, "합계 ", h("b", {}, v.length ? String(v.reduce((a, b) => a + b, 0)) : "—")), h("span", {}, "에버 ", h("b", {}, v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "—"))); };
    scoreIn.forEach((e, i) => { e.oninput = () => { e.value = e.value.replace(/\D/g, "").slice(0, 3); GS.scores[i] = e.value; upd(); if (e.value.length === 3) (scoreIn[i + 1] || noteIn).focus(); }; });
    noteIn.oninput = () => GS.note = noteIn.value; upd();
    const del = pbtn("삭제", async () => {
      const g = games.find((x) => x.recordId === GS.editing); if (!g) return;
      if (!(await confirmBox("선택한 기록을 삭제하시겠습니까?"))) return;
      clear(); await save([op("games", "delete", gamePayload(g), S.rv.games[g.recordId])], "게임 기록이 삭제되었습니다.");
    }, "ghost"); del.disabled = !(GS.editing > 0);
    const sv = pbtn("저장", () => saveIt(), "pri");
    const key = weekKey(GS.date);
    const list = games.filter((g) => weekKey(g.gameDate) === key).sort((a, b) => (qBase(mm.get(a.memberId), a.gameDate) - qBase(mm.get(b.memberId), b.gameDate)) || (b.recordId - a.recordId));
    const rows = list.map((g) => h("tr", { class: g.recordId === GS.editing ? "sel" : "", onclick: () => { GS.editing = g.recordId; GS.date = g.gameDate; GS.type = gtype(g); GS.member = g.memberId; GS.scores = sc(g).map((v) => (v > 0 ? String(v) : "")); GS.note = g.note || ""; phGames(); window.scrollTo({ top: 0, behavior: "smooth" }); } },
      h("td", { class: "nm" }, nameWithAvg(mm.get(g.memberId), g.gameDate)), ...sc(g).map((v) => h("td", {}, v > 0 ? String(v) : "")), h("td", { class: "nt" }, g.note || "")));
    const tbl = h("div", { class: "phtable" }, h("table", {}, h("thead", {}, h("tr", {}, ["회원명(에버)", "1G", "2G", "3G", "4G", "비고"].map((x) => h("th", {}, x)))), h("tbody", {}, rows)));
    phRootF(2, pcard("점수 입력", h("div", { class: "phrow3" }, dSel, tSel, mSel), h("div", { class: "phrow4" }, scoreIn), sumBar, noteIn, h("div", { class: "phbtns" }, del, sv)),
      h("div", { class: "phpreview" }, `입력 중 미리보기: ${weekLabel(GS.date)} / ${list.length}건${GS.editing > 0 ? " · 수정 중" : ""}`), list.length ? tbl : h("div", { class: "phempty" }, "등록된 게임 기록이 없습니다."));
    function clear() { GS.editing = 0; GS.scores = ["", "", "", ""]; GS.note = ""; }
    async function saveIt() {
      if (!canIn()) return;
      const m = mm.get(GS.member); if (!m) return toast("등록 가능한 회원이 없습니다.");
      const s = [];
      for (let i = 0; i < 4; i++) { const t = String(GS.scores[i] || "").trim(); const v = t ? (/^\d+$/.test(t) ? +t : null) : 0; if (v == null) return toast(`${i + 1}G 점수를 숫자로 입력하세요.`); if (v < 0 || v > 300) return toast(`${i + 1}G 점수는 0~300 사이여야 합니다.`); s.push(v); }
      const update = GS.editing > 0;
      const rec = { recordId: update ? GS.editing : 0, memberId: m.memberId, gameDate: GS.date, s1: s[0], s2: s[1], s3: s[2], s4: s[3], note: String(GS.note || "").trim(), meetingType: GS.type || "정모" };
      if (!(await save([op("games", update ? "update" : "insert", gamePayload(rec), update ? S.rv.games[GS.editing] : undefined)], update ? "게임 기록이 수정되었습니다." : "게임 기록이 저장되었습니다."))) return;
      GS.lockedWeek = weekLabel(GS.date); GS.lockedType = rec.meetingType; clear(); applyMeetingTypeRule(GS.lockedWeek); phGames();
      setTimeout(() => { const ms = $("tbMember"); if (ms) ms.focus(); }, 30);
    }
  }

  /* ---- 분기에버: 회원 카드 목록 + 하단 저장 ---- */
  const QP = { open: new Set() };
  function phQuarter() {
    const games = tbGames(), stat = statGames(), mm = byId(), y0 = ynum(today());
    const qOpts = [[`${pad2((y0 - 1) % 100)}_4분기`, y0 - 1, 4], ...[1, 2, 3, 4].map((q) => [`${q}분기`, y0, q])];
    if (!qOpts.some((o) => o[0] === GS.linked)) GS.linked = qOpts[Math.min(Math.floor((mnum(today()) - 1) / 3) + 2, qOpts.length - 1)][0];
    const [label, y, q] = qOpts.find((o) => o[0] === GS.linked);
    const [py, pq] = q === 1 ? [y - 1, 4] : [y, q - 1];
    const dates = games.map((g) => g.gameDate), months = [q * 3 - 2, q * 3 - 1, q * 3];
    const open = QA.isOpen(dates, y, q), from = QA.openFrom(dates, y, q);
    const inProgress = y === y0 && q === Math.floor((mnum(today()) - 1) / 3) + 1 && !open;
    const rows = activeMembers().map((m) => {
      const exact = S.sq[`${m.memberId}|${y}|${q}`], pv = S.sq[`${m.memberId}|${py}|${pq}`];
      const base = exact != null ? exact : pv != null ? pv : m.currentBaseAverage;
      const recs = stat.filter((g) => g.memberId === m.memberId && ynum(g.gameDate) === y && months.includes(mnum(g.gameDate)));
      return { m, base, exact, recs, avg: recAvg(recs) };
    }).sort((a, b) => b.avg - a.avg || b.base - a.base);
    const list = h("div", { class: "phqlist" });
    rows.forEach((r) => {
      const k = `${y}-${q}-${r.m.memberId}`;
      const inp = h("input", { class: "phadj" + (open ? "" : " lock"), inputmode: "numeric", maxlength: "3", value: inProgress ? "진행중" : (GS.draft[k] ?? (r.exact != null ? String(r.exact) : "")), placeholder: open ? "" : "잠김" });
      inp.disabled = !open; inp.oninput = () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 3); GS.draft[k] = inp.value; };
      const isOpen = QP.open.has(r.m.memberId);
      const item = h("div", { class: "phqitem" + (isOpen ? " open" : "") },
        h("div", { class: "phqhead", onclick: (e) => { if (e.target === inp) return; isOpen ? QP.open.delete(r.m.memberId) : QP.open.add(r.m.memberId); PH_KEEP = true; phQuarter(); } },
          h("b", { class: "nm" }, `${r.m.name}(${r.base || "-"})`), h("span", { class: "lb" }, "에버"), inp,
          h("span", { class: "acc" }, h("small", {}, "총 누적에버"), h("b", {}, r.recs.some((g) => cnt(g) > 0) ? r.avg.toFixed(1) : "-")), h("i", { class: "chev" }, isOpen ? "︿" : "﹀")));
      if (isOpen) {
        const det = h("div", { class: "phqdet" });
        const summ = (lbl, rs) => { const c = rs.reduce((a, g) => a + cnt(g), 0); if (!c) return [lbl, "—", "—", "—", "—"]; const av = recAvg(rs), bw = rs.reduce((a, g) => a + qBase(mm.get(g.memberId), g.gameDate) * cnt(g), 0) / c; return [lbl, String(c), av.toFixed(1), String(Math.max(...rs.map(smax))), bw > 0 ? sgn1(av - bw) : "—"]; };
        const tr = (vals, cls) => h("tr", { class: cls || "" }, vals.map((v, i) => h("td", { style: i === 4 && /^[-−]\d/.test(v) ? "color:#C0392B" : "" }, v)));
        det.append(h("div", { class: "phrd" }, h("table", { class: "phst" }, h("tbody", {}, tr(["구분", "게임수", "총에버", "최고게임", "편차"], "hd"),
          ...months.map((mo) => tr(summ(`${mo}월`, r.recs.filter((g) => mnum(g.gameDate) === mo)))), tr(summ("Total", r.recs), "tot")))));
        item.append(det);
      }
      list.append(item);
    });
    const qs = psel(qOpts.map((o) => [o[0], o[0]]), GS.linked, (v) => { GS.linked = v; phQuarter(); }, "big");
    phRootF(2, h("div", { class: "phqbar" }, qs, pbtn("조회", phQuarter, "ghost sm"), pbtn("저장", saveQ, "pri sm")),
      h("div", { class: "phqcap" }, h("b", {}, `전회원 · 조정 ${open ? "입력 가능" : `${mnum(from)}/${dnum(from)}부터`}`), h("span", {}, `${months[0]}~${months[2]}월`)),
      list);
    async function saveQ() {
      if (!canIn()) return;
      if (!QA.isOpen(dates, y, q)) return toast(`조정에버는 ${mnum(from)}월 ${dnum(from)}일부터 입력할 수 있습니다.`);
      const ops = [];
      Object.entries(GS.draft).forEach(([k, v]) => { const [yy, qq, id] = k.split("-").map(Number); if (yy !== y || qq !== q) return; const n = /^\d+$/.test(String(v).trim()) ? +v : 0; if (n >= 1 && n <= 300) ops.push(...quarterOps(id, yy, qq, n)); });
      GS.draft = {};
      if (!ops.length) { toast("저장할 조정에버 값이 없습니다."); return phQuarter(); }
      await save(ops, `조정에버 ${ops.length}명이 저장되었습니다.`);
    }
  }

  /* ---- 회비관리: 회비 납부 등록 + 월별 납부 현황 ---- */
  function phFees() {
    const year = ynum(today()), tm = mnum(today());
    const members = activeMembers().filter((m) => !m.feeExempt);
    if (!members.some((m) => m.memberId === FS.member)) FS.member = members.length ? members[0].memberId : null;
    if (FS.start == null) FS.start = tm; if (FS.end == null) FS.end = tm; if (!FS.date) FS.date = today();
    const m = members.find((x) => x.memberId === FS.member);
    const months = Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1}월`]);
    const range = () => { const s = FS.start, e = FS.prepay ? FS.end : FS.start, out = []; for (let k = Math.min(s, e); k <= Math.max(s, e); k++) if (!(m && m.executiveThreeMonthExempt && k >= 10)) out.push(k); return out; };
    const calc = h("div", { class: "phcalc" });
    const updCalc = () => { const n = range().length; calc.textContent = `월 회비 ${won(S.monthlyFee)}원 x ${n}개월    ${won(S.monthlyFee * n)}원`; };
    const pre = h("input", { type: "checkbox" }); pre.checked = FS.prepay; pre.onchange = () => { FS.prepay = pre.checked; if (!FS.prepay) FS.end = FS.start; phFees(); };
    const sSel = psel(months, String(FS.start), (v) => { FS.start = +v; if (!FS.prepay || FS.end < FS.start) FS.end = FS.start; phFees(); });
    const eSel = psel(months, String(FS.prepay ? FS.end : FS.start), (v) => { FS.end = +v; updCalc(); }); eSel.disabled = !FS.prepay;
    const dIn = h("input", { class: "phin", type: "date", value: FS.date }); dIn.onchange = () => FS.date = dIn.value || today();
    const nIn = h("input", { class: "phin", placeholder: "비고", value: FS.note }); nIn.oninput = () => FS.note = nIn.value;
    updCalc();
    // 선택 회원의 월별 상태
    const pays = S.fees.filter((p) => p.memberId === FS.member && p.year === year), byMo = new Map(pays.map((p) => [p.month, p]));
    const prior = S.fees.filter((p) => p.memberId === FS.member);
    let paid = 0, miss = 0, req = 0;
    const tiles = Array.from({ length: 12 }, (_, i) => {
      const mo = i + 1, fp = byMo.get(mo), active = m && isFeeTarget(m, year, mo, prior), exempt = active && m.executiveThreeMonthExempt && mo >= 10;
      let cls = "na", txt = "—";
      if (fp) { cls = "ok"; txt = "✓ " + mmdd(fp.paidDate); paid++; }
      else if (!active) { cls = "na"; txt = "—"; }
      else if (exempt) { cls = "ex"; txt = "면제"; }
      else if (mo < tm) { cls = "no"; txt = "미납"; miss++; }
      else if (mo === tm) { cls = "soon"; txt = "예정"; }
      else { cls = "na"; txt = "—"; }
      if (active && !exempt) req++;
      return h("div", { class: "phtile " + cls }, h("b", {}, `${mo}월`), h("span", {}, txt));
    });
    const pct = req ? Math.round(Math.min(paid, req) / req * 100) : 0;
    phRootF(1, pcard("회비 납부 등록",
      ppick(members.map((x) => [x.memberId, x.name]), FS.member, (v) => { FS.member = +v; phFees(); }, "center"),
      h("div", { class: "phfeerow" }, h("label", { class: "phchk" }, pre, "선납"), h("label", { class: "phlab" }, h("small", {}, "시작 월"), sSel), h("label", { class: "phlab" }, h("small", {}, "종료 월"), eSel)),
      h("div", { class: "phrow2" }, h("label", { class: "phout" }, h("small", {}, "납부일"), dIn), nIn), calc,
      h("div", { class: "phbtns three" }, pbtn("납부취소", cancelRange, "ghost"), pbtn("수정", modifyFee, "ghost"), pbtn("납부 등록", savePay, "pri"))),
      h("section", { class: "phcard phfeestat" }, h("b", { class: "phct sm" }, `완납: ${paid}개월 / 미납: ${miss}개월`), h("div", { class: "phprog" }, h("i", { style: `width:${pct}%` })), h("div", { class: "phtiles" }, tiles)));
    async function apply(memberId, desired, msg) { const ops = feeOps(memberId, year, desired); if (!ops.length) return toast(msg); await save(ops, msg); }
    async function savePay() {
      if (!canIn() || !m) return;
      const ms = range(); if (!ms.length) return toast("등록할 회비 월이 없습니다.");
      const lbl = ms.length === 1 ? `${ms[0]}월` : `${ms[0]}~${ms[ms.length - 1]}월`, note = String(FS.note || "").trim() || `${m.name}(${lbl})`;
      const list = feeCopy(m.memberId, year);
      ms.forEach((mo) => { const i = list.findIndex((f) => f.month === mo), nf = { feeId: 0, memberId: m.memberId, year, month: mo, paidDate: FS.date, amount: S.monthlyFee, note }; if (i >= 0) list[i] = { ...list[i], ...nf, feeId: list[i].feeId }; else list.push(nf); });
      FS.note = ""; await apply(m.memberId, list, "회비가 저장되었습니다.");
    }
    async function cancelRange() {
      if (!canIn() || !m) return;
      const ms = range().filter((mo) => byMo.has(mo)); if (!ms.length) return toast("선택한 월에 납부 기록이 없습니다.");
      if (!(await confirmBox(`${m.name}님의 ${year}년 ${ms.map((x) => x + "월").join(", ")} 회비를 취소하시겠습니까?`))) return;
      const drop = new Set(ms); await apply(m.memberId, feeCopy(m.memberId, year).filter((f) => !drop.has(f.month)), "회비가 취소되었습니다.");
    }
    async function modifyFee() { FS.noDraw = true; try { renderFees(); } finally { FS.noDraw = false; } FS_MODIFY(); }
  }
  let FS_MODIFY = () => {};

  /* ---- 락카관리: 락카 현황 카드 목록 + 수정 창 ---- */
  function phLockers() {
    const st = S.settings, dDep = int(st.key_locker_deposit), dFee = int(st.key_locker_yearly_fee), dCon = st.key_locker_contract_date || "", dExp = st.key_locker_expiry_date || "";
    const md = (v) => { const s = String(v || ""); const x = s.match(/(\d{4})-(\d{2})-(\d{2})/); return x ? `${x[2]}-${x[3]}` : s; };
    const no = (m) => { const l = lockerOf(m.memberId); return l ? String(l.locker_number) : "-"; };
    const ms = activeMembers().sort((a, b) => { const x = no(a) === "-" ? "9999" : no(a), y = no(b) === "-" ? "9999" : no(b); return (x < y ? -1 : x > y ? 1 : 0) || ko.compare(a.name, b.name); });
    const rows = ms.map((m) => h("div", { class: "phlrow" + (m.memberId === KS.sel ? " sel" : ""), onclick: () => { KS.sel = m.memberId; edit(m); } }, h("span", {}, m.name), h("span", {}, no(m)), h("span", {}, m.joinDate ? m.joinDate.slice(2) : "-")));
    phRootF(2, h("section", { class: "phcard" }, h("b", { class: "phct big" }, "락카 현황")), h("div", { class: "phlhead" }, h("span", {}, "회원명"), h("span", {}, "번호"), h("span", {}, "가입일")), h("div", { class: "phllist" }, rows));
    async function edit(m) {
      if (!canIn()) return;
      const l = lockerOf(m.memberId) || {};
      const f = (v, cls = "") => h("input", { class: "phdin " + cls, value: v ?? "" });
      const nIn = f(no(m) === "-" ? "" : no(m)), dep = f(won(int(l.deposit) || dDep)), fee = f(won(int(l.yearly_fee) || dFee)), con = f(md(l.contract_date || dCon), "date"), exp = f(md(l.expiry_date || dExp), "date");
      [dep, fee].forEach((e) => e.oninput = () => { const v = e.value.replace(/\D/g, ""); e.value = v ? won(+v) : ""; });
      const body = h("div", { class: "phdlg" }, ...[["번호", nIn], ["보증금", dep], ["1년사용료", fee], ["계약일", con], ["만료일", exp]].map(([k, e]) => h("label", {}, h("span", {}, k), e)), h("p", {}, "저장 시 회원의 락카번호도 함께 반영됩니다."));
      const r = await modal(`${m.name} 락카 수정`, body, [["배정해제", "rel", "lnk left"], ["취소", null, "lnk"], ["저장", "ok", "lnk"]]);
      if (!r) return;
      const toDate = (v) => { const s = String(v || "").trim(); if (!s) return null; if (/^\d{1,2}-\d{1,2}$/.test(s)) { const [a, b] = s.split("-").map(Number); return ymd(ynum(today()), a, b); } return smartDate(s); };
      let ops;
      try {
        if (r === "rel") { if (!lockerOf(m.memberId)) return toast("저장된 락카 정보가 없습니다."); ops = lockerOps(m.memberId, "", 0, 0, null, null); }
        else { const number = nIn.value.trim(); if (!number) return toast("락카 번호를 입력하세요."); ops = lockerOps(m.memberId, number, int(dep.value.replace(/,/g, "")) || dDep, int(fee.value.replace(/,/g, "")) || dFee, toDate(con.value), toDate(exp.value)); }
      } catch (e) { return toast(e.message, 4200); }
      if (!ops.length) return toast("변경된 내용이 없습니다.");
      await save(ops, r === "rel" ? "락카 배정이 해제되었습니다." : "락카 현황이 저장되었습니다.");
    }
  }
  const phIn = () => PHONE() && inputMode();

  /* =====================================================================
     세로 화면 조회모드 (모바일 볼링클럽 조회 결과 화면)
     ===================================================================== */
  const QS = { mq: "", grade: "", open: new Set(), rk: "전회원", period: "전분기", lsel: 0, fsel: 0, ksel: 0, all: false };
  const fbar = (...kids) => h("div", { class: "phfbar" }, ...kids.filter(Boolean));
  const fsel = (opts, value, onchange) => sel(opts, value, onchange, "phfsel");
  const refreshBtn = () => h("button", { type: "button", class: "phref", title: "새로고침", onclick: async () => { try { await reload("서버 최신 자료를 불러왔어요."); render(); } catch (e) { toast(e.message); } } }, "↻");
  const pTitle = (t, sub, right) => h("div", { class: "phqt" }, h("b", {}, t), sub ? h("div", { class: "sub" }, h("span", {}, sub), right ? h("span", {}, right) : null) : null);
  const devCls = (d) => (d == null ? "" : d >= 0 ? "pos" : "neg");
  const toggleOpen = (k) => { QS.open.has(k) ? QS.open.delete(k) : QS.open.add(k); PH_KEEP = true; RENDER[current](); };
  const ROLE_TXT = { HIGH: "최고하이", EVER: "에버하이", ALL: "올카" };
  const kv = (pairs) => h("div", { class: "phkv" }, pairs.map(([k, v]) => [h("span", {}, k), h("b", {}, v ?? "-")]).flat());
  const yy = (d) => (d ? d.slice(2) : "-");

  /* ---- 회원 ---- */
  function phqMembers() {
    const all = allMembers().filter((m) => isActive(m));
    const grades = S.gradeTypes || [];
    const gi = (g) => { const i = grades.indexOf(g); return i < 0 ? 99 : i; };
    let list = all.filter((m) => (!QS.mq || m.memberId === +QS.mq) && (!QS.grade || m.grade === QS.grade));
    list.sort((a, b) => gi(a.grade) - gi(b.grade) || ko.compare(a.name, b.name));
    const rows = list.map((m) => { const lk = lockerOf(m.memberId), b = qBase(m); return h("tr", {}, h("td", {}, m.name), h("td", { class: "tel" }, m.phone ? [h("span", {}, m.phone), VIEWONLY ? null : h("a", { href: "tel:" + m.phone.replace(/[^\d+]/g, ""), class: "call", title: "전화 걸기" }, "📞")] : "-"), h("td", {}, m.grade || "-"), h("td", {}, b > 0 ? String(b) : "-"), h("td", {}, lk ? String(lk.locker_number) : "-")); });
    phRootF(1, fbar(fsel([["", "회원ALL"], ...all.slice().sort((a, b) => ko.compare(a.name, b.name)).map((m) => [String(m.memberId), m.name])], QS.mq, (v) => { QS.mq = v; phqMembers(); }),
      fsel([["", "등급ALL"], ...[...new Set(all.map((m) => m.grade).filter(Boolean))].sort((a, b) => gi(a) - gi(b)).map((g) => [g, g])], QS.grade, (v) => { QS.grade = v; phqMembers(); })),
      h("div", { class: "phmtable" }, h("table", {}, h("thead", {}, h("tr", {}, ["회원명", "연락처", "구분", "기준에버", "락카번호"].map((x) => h("th", {}, x)))), h("tbody", {}, rows))));
  }

  /* ---- 게임기록 ---- */
  const scoreLine = (g, refs) => { const raw = sc(g), last = raw.map((v) => v > 0).lastIndexOf(true); const out = []; raw.slice(0, Math.max(0, last + 1)).forEach((v, i) => { if (i) out.push(" / "); const hi = refs && refs.has(g.recordId * 10 + i + 1); out.push(h("span", { class: hi ? "hi" : v >= 200 ? "red" : "" }, v > 0 ? String(v) : "   ")); }); return out; };
  function phqGames() {
    const games = tbGames(), stat = statGames(), groups = weekGroups(games), mm = byId(), roles = roleMap(games);
    const reports = ["개인기록", "모임기록", "누적기록", "분기에버", "순위표"];
    if (!reports.includes(GS.report)) GS.report = "개인기록";
    const rep = GS.report;
    const y0 = ynum(today()), qOpts = [[`${pad2((y0 - 1) % 100)}_4분기`, y0 - 1, 4], ...[1, 2, 3, 4].map((q) => [`${q}분기`, y0, q])];
    let lopts = [];
    if (rep === "개인기록") lopts = activeMembers().slice().sort((a, b) => ko.compare(a.name, b.name)).map((m) => [String(m.memberId), m.name]);
    else if (rep === "모임기록") lopts = groups.slice().reverse().map((g) => [g.key, g.label]);
    else if (rep === "누적기록") lopts = ["최근2주", "최근3주", "최근4주", "최근5주"].map((x) => [x, x]);
    else if (rep === "분기에버") lopts = qOpts.map((o) => [o[0], o[0]]);
    if (rep !== "순위표" && !lopts.some((o) => o[0] === GS.linked)) GS.linked = rep === "누적기록" ? "최근4주" : rep === "분기에버" ? qOpts[Math.min(Math.floor((mnum(today()) - 1) / 3) + 2, 4)][0] : (lopts[0] || [""])[0];
    const repSel = fsel(reports, rep, (v) => { GS.report = v; GS.linked = null; QS.open.clear(); phqGames(); });
    const bar = rep === "순위표"
      ? fbar(repSel, fsel(["전회원", "남자", "여자"], QS.rk, (v) => { QS.rk = v; phqGames(); }), fsel(["전분기", "1분기", "2분기", "3분기", "4분기", "상반기", "하반기"], QS.period, (v) => { QS.period = v; phqGames(); }), refreshBtn())
      : fbar(repSel, fsel(lopts, GS.linked, (v) => { GS.linked = v; QS.open.clear(); phqGames(); }), refreshBtn());
    const body = [];
    const card = (key, head, detail, extraCls = "") => { const open = QS.open.has(key); return h("div", { class: "phrc" + (open ? " open" : "") + (extraCls ? " " + extraCls : "") }, h("div", { class: "phrh", onclick: () => toggleOpen(key) }, ...head, h("i", { class: "chev" }, open ? "︿" : "﹀")), open ? detail() : null); };
    const scoreDetail = (g) => () => h("div", { class: "phrd" }, h("div", { class: "phscores" }, ...sc(g).map((v, i) => h("div", {}, h("small", {}, `${i + 1}G`), h("b", { class: v >= 200 ? "red" : "" }, v > 0 ? String(v) : "-")))), g.note ? h("div", { class: "phnote" }, g.note) : null);
    if (rep === "개인기록") {
      const id = +GS.linked, m = mm.get(id), list = stat.filter((g) => g.memberId === id).sort((a, b) => (a.gameDate < b.gameDate ? 1 : a.gameDate > b.gameDate ? -1 : 0));
      const n = list.reduce((a, g) => a + cnt(g), 0), best = list.length ? Math.max(...list.map(smax)) : 0;
      body.push(pTitle("개인 기록", `${m ? m.name : ""} / ${n}G / Avg : ${n ? recAvg(list).toFixed(1) : "-"} / 최고 : ${best || "-"}`));
      list.forEach((g) => { const r = roles.get(g.recordId), b = qBase(m, g.gameDate), av = gavg(g); body.push(card("p" + g.recordId, [h("b", { class: "wk" }, `${weekLabel(g.gameDate)} ${gtype(g)}`), h("span", { class: "pav" }, `Avg ${fmt1(av)}`), h("span", { class: "pdv" }, b > 0 && av > 0 ? sgn1(av - b) : ""), r ? h("span", { class: "badge " + r.role.toLowerCase() }, ROLE_TXT[r.role]) : null], scoreDetail(g), r ? "r-" + r.role.toLowerCase() : "")); });
    } else if (rep === "모임기록") {
      const g0 = groups.find((g) => g.key === GS.linked), list = games.filter((g) => g0 && g0.dates.includes(g.gameDate)).sort((a, b) => gavg(b) - gavg(a));
      body.push(pTitle("모임 기록", g0 ? `${g0.label} / ${[...new Set(list.map(gtype))].join("·")}` : ""));
      list.forEach((g) => { const m = mm.get(g.memberId), r = roles.get(g.recordId), b = qBase(m, g.gameDate), av = gavg(g); body.push(card("m" + g.recordId, [h("b", { class: "nm" }, `${nameWithAvg(m, g.gameDate)} ${gtype(g)}`), h("span", { class: "pav" }, `Avg ${fmt1(av)}`), h("span", { class: "pdv" }, b > 0 && av > 0 ? sgn1(av - b) : ""), r ? h("span", { class: "badge " + r.role.toLowerCase() }, ROLE_TXT[r.role]) : null], scoreDetail(g), r ? "r-" + r.role.toLowerCase() : "")); });
    } else if (rep === "누적기록") {
      const n = +(String(GS.linked).match(/\d+/) || [4])[0], gs = groups.slice(-n), year = gs.length ? ynum(gs[gs.length - 1].dates[0]) : y0;
      body.push(pTitle("누적 기록"));
      const yg = new Map(); stat.filter((g) => ynum(g.gameDate) === year).forEach((g) => { if (!yg.has(g.memberId)) yg.set(g.memberId, []); yg.get(g.memberId).push(g); });
      const refsBy = gs.map((gr) => { const l = games.filter((g) => gr.dates.includes(g.gameDate)); return meetingHighRefs(l, roleMap(l)); });
      [...yg.entries()].map(([id, l]) => ({ id, l, acc: recAvg(l), wk: l.filter((g) => gs.some((gr) => gr.dates.includes(g.gameDate))) })).sort((a, b) => b.acc - a.acc).forEach((r) => {
        const m = mm.get(r.id);
        body.push(card("c" + r.id, [h("b", { class: "nm" }, nameWithAvg(m, yearEndRef(year))), h("span", { class: "pav" }, fmt1(r.acc)), h("span", { class: "pat" }, `출석 ${new Set(r.l.map((g) => g.gameDate)).size}`), h("span", { class: "ppa" }, `( ${r.wk.some((g) => cnt(g) > 0) ? recAvg(r.wk).toFixed(1) : "-"} )`)],
          () => h("div", { class: "phrd wk" }, gs.map((gr, k) => { const w = r.l.filter((g) => gr.dates.includes(g.gameDate)); return h("div", { class: "phwk" }, h("span", { class: "lb" }, gr.label), h("span", { class: "sc" }, w.some((g) => cnt(g) > 0) ? [...w.flatMap((g) => scoreLine(g, refsBy[k])), ` (${recAvg(w).toFixed(1)})`] : "-")); }))));
      });
    } else if (rep === "분기에버") {
      const [lb, y, q] = qOpts.find((o) => o[0] === GS.linked), [py, pq] = q === 1 ? [y - 1, 4] : [y, q - 1], months = [q * 3 - 2, q * 3 - 1, q * 3];
      body.push(h("div", { class: "phqcap" }, h("b", {}, "전회원"), h("span", {}, `${months[0]}~${months[2]}월`)));
      activeMembers().map((m) => { const ex = S.sq[`${m.memberId}|${y}|${q}`], pv = S.sq[`${m.memberId}|${py}|${pq}`], base = ex != null ? ex : pv != null ? pv : m.currentBaseAverage; const recs = stat.filter((g) => g.memberId === m.memberId && ynum(g.gameDate) === y && months.includes(mnum(g.gameDate))); return { m, base, recs, avg: recAvg(recs) }; })
        .sort((a, b) => b.avg - a.avg || b.base - a.base).forEach((r) => {
          const row = (lbl, rs) => { const c = rs.reduce((a, g) => a + cnt(g), 0); if (!c) return [lbl, "—", "—", "—", "—", null]; const av = recAvg(rs), bw = rs.reduce((a, g) => a + qBase(mm.get(g.memberId), g.gameDate) * cnt(g), 0) / c; return [lbl, String(c), av.toFixed(1), String(Math.max(...rs.map(smax))), bw > 0 ? sgn1(av - bw) : "—", bw > 0 ? av - bw : null]; };
          body.push(card("q" + r.m.memberId, [h("b", { class: "nm" }, `${r.m.name}(${r.base || "-"})`), h("span", { class: "lb" }, "에버"), h("span", { class: "pill" }, String(r.base || "-")), h("span", { class: "acc" }, h("small", {}, "총 누적에버"), h("b", {}, r.recs.some((g) => cnt(g) > 0) ? r.avg.toFixed(1) : "-"))],
            () => h("div", { class: "phrd" }, h("table", { class: "phst" }, h("tbody", {}, h("tr", { class: "hd" }, ["구분", "게임수", "총에버", "최고게임", "편차"].map((x) => h("td", {}, x))),
              ...[...months.map((mo) => row(`${mo}월`, r.recs.filter((g) => mnum(g.gameDate) === mo))), row("Total", r.recs)].map((v) => h("tr", { class: v[0] === "Total" ? "tot" : "" }, v.slice(0, 4).map((x) => h("td", {}, x)), h("td", { class: devCls(v[5]) }, v[4]))))))));
        });
    } else {
      const P = { 전분기: [1, 12], "1분기": [1, 3], "2분기": [4, 6], "3분기": [7, 9], "4분기": [10, 12], 상반기: [1, 6], 하반기: [7, 12] }[QS.period];
      const year = y0, curQ = Math.floor((mnum(today()) - 1) / 3) + 1;
      const label = QS.period === "전분기" ? `${year}년 전체` : `${year}년 ${QS.period}`;
      body.push(pTitle("랭킹 현황", QS.rk, label));
      const agg = new Map();
      stat.filter((g) => ynum(g.gameDate) === year && mnum(g.gameDate) >= P[0] && mnum(g.gameDate) <= P[1]).forEach((g) => { const m = mm.get(g.memberId); if (!m) return; if (QS.rk === "남자" && m.gender !== "MALE") return; if (QS.rk === "여자" && m.gender !== "FEMALE") return; if (!agg.has(g.memberId)) agg.set(g.memberId, []); agg.get(g.memberId).push(g); });
      const ref = QS.period === "전분기" ? yearEndRef(year) : (() => { const e = monthEnd(year, P[1]); return e > today() ? today() : e; })();
      [...agg.entries()].map(([id, l]) => ({ m: mm.get(id), l, n: l.reduce((a, g) => a + cnt(g), 0), avg: recAvg(l), best: Math.max(...l.map(smax)) })).filter((r) => r.n > 0).sort((a, b) => b.avg - a.avg)
        .forEach((r, i) => {
          const b = qBase(r.m, ref), dv = b > 0 ? r.avg - b : null;
          body.push(card("r" + r.m.memberId, [h("span", { class: "rk r" + (i + 1) }, String(i + 1)), h("b", { class: "nm" }, `${r.m.name}(${b || "-"})`), h("span", { class: "pn" }, String(r.n)), h("span", { class: "pav" }, r.avg.toFixed(1)), h("span", { class: "pn" }, String(r.best)), h("span", { class: "pdv " + devCls(dv) }, dv == null ? "-" : sgn1(dv))],
            () => h("div", { class: "phrd" }, h("table", { class: "phst" }, h("tbody", {}, h("tr", { class: "hd" }, ["구분", "게임수", "총에버", "최고게임", "편차"].map((x) => h("td", {}, x))),
              ...[1, 2, 3, 4].filter((q) => q <= (year === y0 ? curQ : 4)).map((q) => { const rs = r.l.filter((g) => Math.floor((mnum(g.gameDate) - 1) / 3) + 1 === q), qb = qBase(r.m, ymd(year, q * 3 - 2, 1)), c = rs.reduce((a, g) => a + cnt(g), 0); if (!c) return null; const av = recAvg(rs), d = qb > 0 ? av - qb : null; return h("tr", {}, h("td", {}, `${q}분기(${qb || "-"})`), h("td", {}, String(c)), h("td", {}, av.toFixed(1)), h("td", {}, String(Math.max(...rs.map(smax)))), h("td", { class: devCls(d) }, d == null ? "-" : sgn1(d))); })))), "rank"));
        });
    }
    if (body.length <= 1) body.push(h("div", { class: "phempty" }, "조회된 자료가 없습니다."));
    phRootF(2, bar, ...body);
  }

  /* ---- 장부 ---- */
  function phqLedger() {
    const all = S.ledger.filter((e) => e.date), signed = (e) => (e.type === "수입" ? e.amount : -e.amount);
    const keys = new Set(all.map((e) => e.date.slice(0, 7))); keys.add(today().slice(0, 7));
    const mk = [...keys].sort().reverse(); if (!mk.includes(LS.month)) LS.month = mk[0];
    const list = (QS.all ? all : all.filter((e) => e.date.startsWith(LS.month))).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ledgerId - b.ledgerId));
    const inc = list.filter((e) => e.type === "수입").reduce((a, e) => a + e.amount, 0), exp = list.filter((e) => e.type === "지출").reduce((a, e) => a + e.amount, 0);
    const end = QS.all ? null : monthEnd(+LS.month.slice(0, 4), +LS.month.slice(5));
    const total = all.filter((e) => !end || e.date <= end).reduce((a, e) => a + signed(e), 0);
    const selE = list.find((e) => e.ledgerId === QS.lsel);
    const items = list.map((e) => h("div", { class: "phle" + (e.ledgerId === QS.lsel ? " sel" : ""), onclick: () => { QS.lsel = e.ledgerId; phqLedger(); } },
      h("div", { class: "l1" }, h("b", {}, QS.all ? e.date.slice(2) : e.date.slice(5)), h("span", { class: "tag " + (e.type === "수입" ? "in" : "out") }, e.type), h("b", { class: "amt" }, won(e.amount) + "원")),
      h("div", { class: "l2" }, `${e.category}${e.note ? " – " + e.note : ""}`)));
    const tile = (ic, cls, lb, v, big) => h("div", { class: "phti" + (big ? " big" : "") }, h("i", { class: cls }, ic), h("div", {}, h("small", {}, lb), h("b", { class: cls }, v)));
    phRootF(2, h("div", { class: "phlbar" }, fsel(mk.map((k) => [k, ynum(k + "-01") === ynum(today()) ? `${+k.slice(5)}월` : k]), LS.month, (v) => { LS.month = v; QS.all = false; phqLedger(); }),
      h("button", { type: "button", class: "phpillbtn" + (QS.all ? "" : " on"), onclick: () => { QS.all = false; phqLedger(); } }, "월별"), h("button", { type: "button", class: "phpillbtn" + (QS.all ? " on" : ""), onclick: () => { QS.all = true; phqLedger(); } }, "전체")),
      h("div", { class: "phqt center" }, h("b", {}, QS.all ? "전체 장부 현황" : "월별 장부 현황")),
      h("div", { class: "phllist2" }, items.length ? items : h("div", { class: "phempty" }, "해당 장부 내역이 없습니다.")),
      h("section", { class: "phsettle" }, h("div", { class: "hd" }, h("b", {}, "정산 정보"), h("small", {}, QS.all ? "장부 전체 내역 기준" : "이번 달 전체 내역 기준")),
        h("div", { class: "g3" }, tile("↑", "up", QS.all ? "총 수입" : "월 수입", won(inc) + "원"), tile("↓", "dn", QS.all ? "총 지출" : "월 지출", won(exp) + "원"), tile("▣", "bl", QS.all ? "잔액" : "월 잔액", won(inc - exp) + "원")),
        h("div", { class: "g2" }, tile("▣", "bl", "총 잔액", won(total) + "원", true), tile("↗", "pu", "회비 연동", selE && selE.fromFee ? "예" : "아니오", true))));
  }

  /* ---- 회비 ---- */
  function phqFees() {
    const year = ynum(today()), tm = mnum(today()), members = activeMembers().filter((m) => !m.feeExempt);
    const ST = { 완납: "ok", 정상: "ok", 예정: "soon", 미납: "no" };
    const rows = members.map((m) => {
      const prior = S.fees.filter((p) => p.memberId === m.memberId), pays = prior.filter((p) => p.year === year), by = new Map(pays.map((p) => [p.month, p]));
      let req = 0, allPaid = true, unpaid = 0, cur = false;
      for (let mo = 1; mo <= 12; mo++) { const active = isFeeTarget(m, year, mo, prior), ex = active && m.executiveThreeMonthExempt && mo >= 10; if (active && !ex) { req++; if (!by.get(mo)) { allPaid = false; if (mo < tm) unpaid++; else if (mo === tm) cur = true; } } }
      const status = req > 0 && allPaid ? "완납" : unpaid ? "미납" : cur ? "예정" : "정상";
      return { m, status, pays, by, unpaid, total: pays.reduce((a, p) => a + p.amount, 0) };
    });
    if (!rows.some((r) => r.m.memberId === QS.fsel)) QS.fsel = rows.length ? rows[0].m.memberId : 0;
    const r = rows.find((x) => x.m.memberId === QS.fsel);
    const items = rows.map((x) => h("div", { class: "phfi" + (x.m.memberId === QS.fsel ? " sel" : ""), onclick: () => { QS.fsel = x.m.memberId; phqFees(); } }, h("b", {}, x.m.name), h("span", { class: "st " + ST[x.status] }, (x.status === "미납" ? "! " : "✓ ") + x.status), h("b", { class: "amt" }, won(x.total) + "원")));
    let det = null;
    if (r) {
      const cp = r.by.get(tm), lastPaid = r.pays.reduce((a, p) => (p.paidDate > a ? p.paidDate : a), "");
      det = h("section", { class: "phdet" }, h("div", { class: "top" }, h("b", { class: "big" }, r.m.name), h("span", { class: "dot " + ST[r.status] }, "● " + r.status)),
        h("b", { class: "sec" }, "회원 정보"), kv([["회원명", r.m.name], ["회원구분", r.m.grade || "-"], ["연락처", r.m.phone || "-"], ["가입일", yy(r.m.joinDate)]]),
        h("b", { class: "sec" }, "납부 정보"), kv([[`${tm}월 회비`, won(cp ? cp.amount : S.monthlyFee) + "원"], ["납부상태", r.status], ["납부일", cp ? yy(cp.paidDate) : "-"], ["누적 미납", won(r.unpaid * S.monthlyFee) + "원"], ["완납 납부일", r.status === "완납" && lastPaid ? lastPaid.slice(2).replace(/-/g, "/") : "-"], ["누적 납부", won(r.total) + "원"]]),
        h("b", { class: "sec" }, "메모"), h("div", { class: "memo" }, (cp && cp.note) || (r.pays.length ? r.pays[r.pays.length - 1].note : "") || "-"));
    }
    phRootF(1, h("div", { class: "phqt center" }, h("b", {}, "회비 현황")), h("div", { class: "phflist" }, items.length ? items : h("div", { class: "phempty" }, "회원 자료가 없습니다.")), det);
  }

  /* ---- 락카 ---- */
  function phqLockers() {
    const st = S.settings, dDep = int(st.key_locker_deposit), dFee = int(st.key_locker_yearly_fee);
    const ms = activeMembers().map((m) => ({ m, l: lockerOf(m.memberId) })).filter((x) => x.l).sort((a, b) => String(a.l.locker_number).localeCompare(String(b.l.locker_number), "ko", { numeric: true }));
    if (!ms.some((x) => x.m.memberId === QS.ksel)) QS.ksel = ms.length ? ms[0].m.memberId : 0;
    const s0 = ms.find((x) => x.m.memberId === QS.ksel);
    const tiles = ms.map((x) => h("div", { class: "phlk" + (x.m.memberId === QS.ksel ? " sel" : ""), onclick: () => { QS.ksel = x.m.memberId; phqLockers(); } }, h("b", {}, String(x.l.locker_number)), h("span", { class: "use" }, "● 사용중"), h("span", {}, x.m.name)));
    const det = s0 ? h("section", { class: "phdet white" }, h("div", { class: "top" }, h("b", { class: "big" }, String(s0.l.locker_number)), h("span", { class: "dot ok" }, "● 사용중")), h("div", { class: "who" }, s0.m.name),
      h("b", { class: "sec" }, "회원 정보"), kv([["회원명", s0.m.name], ["회원구분", s0.m.grade || "-"], ["연락처", s0.m.phone || "-"], ["성별", s0.m.gender === "MALE" ? "남자" : s0.m.gender === "FEMALE" ? "여자" : "-"], ["가입일", yy(s0.m.joinDate)], ["", ""]]),
      h("b", { class: "sec" }, "락카 정보"), kv([["락카번호", String(s0.l.locker_number)], ["상태", "사용중"], ["보증금", won(int(s0.l.deposit) || dDep) + "원"], ["1년사용료", won(int(s0.l.yearly_fee) || dFee) + "원"], ["계약일", s0.l.contract_date || st.key_locker_contract_date || "-"], ["만료일", s0.l.expiry_date || st.key_locker_expiry_date || "-"], ["비고", s0.l.note || "-"], ["", ""]])) : null;
    phRootF(1, h("div", { class: "phqt center" }, h("b", {}, "락카 현황")), h("div", { class: "phlkgrid" }, tiles.length ? tiles : h("div", { class: "phempty" }, "사용 중인 락카가 없습니다.")), det);
  }
  const phQ = () => PHONE() && !inputMode();

  /* ---- 회원관리 (세로 입력모드) ---- */
  function phMembers() {
    const all = allMembers().filter((m) => isActive(m));
    const q = (MS.q || "").trim();
    const list = all.filter((m) => !q || m.name.includes(q)).sort((a, b) => qBase(b) - qBase(a) || ko.compare(a.name, b.name));
    if (!list.some((m) => m.memberId === MS.sel)) MS.sel = 0;
    const qIn = h("input", { class: "phin", placeholder: "검색 (회원명)", value: MS.q || "", enterkeyhint: "search" });
    qIn.oninput = () => { MS.q = qIn.value; clearTimeout(phMembers.t); phMembers.t = setTimeout(() => { phMembers(); const n = view.querySelector(".phin"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); };
    const rows = list.map((m) => { const lk = lockerOf(m.memberId), b = qBase(m);
      return h("tr", { class: m.memberId === MS.sel ? "sel" : "", onclick: () => { MS.sel = MS.sel === m.memberId ? 0 : m.memberId; phMembers(); }, ondblclick: () => editMember(m) },
        h("td", { class: "nm" }, m.name), h("td", {}, m.phone || "-"), h("td", {}, m.grade || "-"), h("td", {}, b > 0 ? String(b) : "-"), h("td", {}, lk ? lk.locker_number : "-")); });
    phRootF(1, h("section", { class: "phcard" }, qIn,
      h("div", { class: "phbtns three" }, pbtn("팝업", () => (window.contactView ? contactView() : toast("연락처를 열 수 없어요."))), pbtn("추가", () => memberForm(null)),
        pbtn("수정", () => { const m = all.find((x) => x.memberId === MS.sel); m ? editMember(m) : toast("수정할 회원을 먼저 선택하세요."); }, "pri"))),
      h("div", { class: "phtable phmem" }, h("table", {}, h("thead", {}, h("tr", {}, ["회원명", "연락처", "구분", "기준에버", "락카번호"].map((x) => h("th", {}, x)))),
        h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: 5, class: "phempty" }, "회원 자료가 없습니다."))))));
  }

  /* ---- 장부관리 (세로 입력모드) ---- */
  function phLedger() {
    if (!LS.date) LS.date = today();
    const all = S.ledger.filter((e) => e.date), mk = LS.date.slice(0, 7);
    const dIn = h("input", { class: "phin sc", type: "date", value: LS.date }); dIn.onchange = () => { LS.date = dIn.value || today(); phLedger(); };
    const tSel = psel(["수입", "지출"], LS.type, (v) => { LS.type = v; LS.cat = null; phLedger(); }, "phbox");
    const cats = LC.names(LS.type); if (LS.cat && !cats.includes(LS.cat)) cats.push(LS.cat);
    if (!cats.includes(LS.cat)) LS.cat = cats[0] || "";
    const cSel = psel(cats, LS.cat, (v) => (LS.cat = v), "phbox");
    const aIn = h("input", { class: "phin", inputmode: "numeric", placeholder: "금액", value: LS.amount }); aIn.oninput = () => (LS.amount = aIn.value);
    const nIn = h("input", { class: "phin", placeholder: "비고", value: LS.note }); nIn.oninput = () => (LS.note = nIn.value);
    const list = all.filter((e) => e.date.startsWith(mk)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ledgerId - b.ledgerId));
    const items = list.map((e) => h("div", { class: "phle" + (e.ledgerId === LS.editing ? " sel" : ""), onclick: () => { LS.editing = e.ledgerId; LS.date = e.date; LS.type = e.type === "지출" ? "지출" : "수입"; LS.cat = e.category; LS.amount = String(e.amount); LS.note = e.note || ""; phLedger(); } },
      h("div", { class: "l1" }, h("b", {}, e.date.slice(5)), h("span", { class: "tag " + (e.type === "수입" ? "in" : "out") }, e.type), h("b", { class: "amt" }, won(e.amount) + "원")),
      h("div", { class: "l2" }, `${e.category}${e.note ? " – " + e.note : ""}`)));
    const clear = () => { LS.editing = 0; LS.amount = ""; LS.note = ""; };
    async function saveP(update) {
      if (!canIn()) return;
      const amount = parseInt(String(LS.amount).replace(/,/g, ""), 10) || 0;
      if (!LS.cat) return toast("내역을 선택하세요.");
      if (amount <= 0) return toast("금액을 입력하세요.");
      if (update && !(LS.editing > 0)) return toast("아래 목록에서 수정할 내역을 선택하세요.");
      const prev = update ? S.ledger.find((x) => x.ledgerId === LS.editing) : null;
      const e = { ledgerId: update ? LS.editing : 0, date: LS.date, type: LS.type || "수입", category: LS.cat, amount, note: String(LS.note || "").trim(), fromFee: prev ? prev.fromFee : false, memberId: prev ? prev.memberId : 0 };
      if (await save([op("ledger_entries", update ? "update" : "insert", ledgerPayload(e), update ? S.rv.ledger[LS.editing] : undefined)], "저장되었습니다.")) { clear(); phLedger(); }
    }
    async function delP() {
      const e = S.ledger.find((x) => x.ledgerId === LS.editing); if (!e) return toast("삭제할 내역을 선택하세요.");
      if (!(await confirmBox("선택한 내역을 삭제하시겠습니까?"))) return;
      clear(); await save([op("ledger_entries", "delete", ledgerPayload(e), S.rv.ledger[e.ledgerId])], "장부가 삭제되었습니다.");
    }
    phRootF(2, h("section", { class: "phcard" }, h("b", { class: "phct" }, "장부 입력"),
      h("div", { class: "phrow2e" }, dIn, tSel), cSel, h("div", { class: "phrow2e" }, aIn, nIn),
      h("div", { class: "phbtns three" }, LS.editing > 0 ? pbtn("삭제", delP) : pbtn("초기화", () => { clear(); phLedger(); }), pbtn("수정", () => saveP(true)), pbtn("저장", () => saveP(false), "pri"))),
      h("div", { class: "phpreview" }, `입력 중 월별 미리보기: ${+mk.slice(5)}월 / ${list.length}건`),
      h("div", { class: "phllist2" }, items.length ? items : h("div", { class: "phempty" }, "해당 월 장부 내역이 없습니다.")));
  }

  const RENDER = { games: () => (phIn() ? phGames() : phQ() ? phqGames() : renderGames(false)), quarter: () => (phIn() ? phQuarter() : phQ() ? phqGames() : renderGames(true)),
    ledger: () => (phIn() ? phLedger() : phQ() ? phqLedger() : renderLedger()), fees: () => (phIn() ? phFees() : phQ() ? phqFees() : renderFees()),
    album: () => window.ClubAlbum.render(),
    members: () => (phIn() ? phMembers() : phQ() ? phqMembers() : renderMembers()), lockers: () => (phIn() ? phLockers() : phQ() ? phqLockers() : renderLockers()) };
  const PC = {}; TB_KEYS.forEach((k) => { PC[k] = TABS[k]; TABS[k] = { render() { TB.wasOn = MODE_KEY(); RENDER[k](); } }; });
  const pcHeader = drawHeader;
  /* 세로 화면 구역 목록 (모바일 볼링클럽: 입력모드 / 조회모드 선택목록) */
  const PH_INPUT = [["members", "회원관리"], ["games", "점수관리"], ["quarter", "분기에버"], ["ledger", "장부관리"], ["fees", "회비관리"], ["lockers", "락카 사용현황"]];
  const PH_QUERY = [["members", "회원"], ["games", "게임기록"], ["ledger", "장부"], ["fees", "회비"], ["lockers", "락카"]];
  const phList = () => (inputMode() ? PH_INPUT : PH_QUERY);
  drawHeader = function () {
    const tab = TB_ON(), phone = !tab;
    TB.wasOn = MODE_KEY();
    document.body.classList.toggle("tbon", tab);
    document.body.classList.toggle("phmode", phone);
    $("logoutBtn").style.display = "";
    const old = $("tbpill"); if (old) old.remove();
    if (!TB.started) { TB.started = true; if (!location.hash.replace("#", "")) current = "games"; }
    if (!TB_KEYS.includes(current) && current !== "settings") current = "games";
    const nav = $("pcnav"); nav.textContent = "";
    $("pcsub").textContent = "";
    const me = Conn.me, mgr = cleanTitle(S.settings.key_management_name || "");
    if (current === "album" && (phone || VIEWONLY)) current = "games";
    if (phone) {
      // 조회모드에는 분기에버 구역이 없어요 → 게임기록의 분기에버 보고서로 보여 줘요
      if (!inputMode() && current === "quarter") { current = "games"; GS.report = "분기에버"; GS.linked = null; }
      const list = phList();
      const secSel = h("select", { class: "phsec", "aria-label": "구역 선택" }, list.map(([k, t]) => h("option", { value: k }, t)));
      secSel.value = list.some(([k]) => k === current) ? current : "games";
      secSel.onchange = () => go(secSel.value);
      nav.append(h("b", { class: "phclub" }, mgr || "클럽관리"), secSel);
      const tools = h("span", { class: "phtools", id: "tbpill" });
      tools.append(h("button", { type: "button", class: "phmenu pcbtn file", title: "메뉴", onclick: (e) => {
        if (inputMode()) return openFileMenu(e.currentTarget);
        const m = $("fileMenu"); if (!m.hidden) { m.hidden = true; return; }
        m.textContent = ""; const it = (t, href) => h("button", { type: "button", onclick: () => { m.hidden = true; location.href = href; } }, t);
        m.append(it("🎳 클럽관리", "/club"), it("🔐 관리", "/admin"), it("🏠 홈으로", "/"));
        const r = e.currentTarget.getBoundingClientRect(); m.style.left = Math.max(8, r.right - 170) + "px"; m.style.top = r.bottom + 2 + "px"; m.hidden = false;
      } }, "☰"));
      $("authStatus").before(tools);
      $("authStatus").textContent = "";
      $("appName").textContent = mgr || (VIEWONLY ? "기록 조회" : "클럽관리");
      $("pchead").hidden = false;
      return;
    }
    if (VIEWONLY) {
      // 기록 조회(PC): 상단 탭 대신 제목 자리 드롭메뉴, 메뉴 줄에는 선택한 화면의 하위 메뉴
      if (current === "quarter") { current = "games"; GS.report = "분기에버"; GS.linked = null; }
      const VM = [["members", "회원관리"], ["games", "게임기록"], ["ledger", "회계장부"], ["fees", "회비관리"], ["lockers", "락카관리"]];
      const ms = h("select", { class: "pcmenusel", "aria-label": "메뉴 선택" }, VM.map(([k, t]) => h("option", { value: k }, t)));
      ms.value = VM.some(([k]) => k === current) ? current : "games"; ms.onchange = () => go(ms.value);
      $("authStatus").textContent = me ? `조회 · ${mgr}` : ""; $("logoutBtn").style.display = "none";
      $("pchead").hidden = false; $("appName").textContent = ""; $("appName").append(ms);
      return;
    }
    nav.append(h("button", { class: "tbbtn file pcbtn", type: "button", onclick: (e) => openFileMenu(e.currentTarget) }, "FILE"));
    for (const k of ["games", "ledger", "fees", "quarter", "album"]) nav.append(h("button", { class: "tbbtn" + (current === k ? " sel" : ""), type: "button", onclick: () => go(k) }, TAB_LABEL[k]));
    const oldRf = $("hdrRefresh"); if (oldRf) oldRf.remove();
    if (!VIEWONLY && me) {
      const rf = h("button", { type: "button", class: "pcbtn hdrrefresh", id: "hdrRefresh", title: "홈페이지·서버의 변경 내용 갱신", "aria-label": "새로고침", onclick: async () => { rf.disabled = true; rf.classList.add("spin"); try {
          await reload(); // 서버 자료(홈페이지 승인·규칙 포함)를 먼저 다시 받아 오류가 없는지 확인
          // 화면 파일(스크립트·스타일)과 서비스 워커를 최신으로 받아 전체 적용
          const urls = [...document.querySelectorAll("script[src],link[rel=stylesheet]")].map((n) => n.src || n.href).concat(["/common.js", "/style.css", "/manifest.webmanifest"]);
          await Promise.all([...new Set(urls)].map((u) => fetch(u, { cache: "reload" }).catch(() => 0)));
          try { if (window.caches) (await caches.keys()).forEach((k) => caches.delete(k)); } catch {}
          try { const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()); if (reg) await reg.update(); } catch {}
          toast("최신 내용으로 갱신하는 중이에요…"); setTimeout(() => location.reload(), 350);
        } catch (e) { toast(e.message); rf.disabled = false; rf.classList.remove("spin"); } } }, "↻");
      $("authStatus").before(rf);
    }
    $("authStatus").textContent = me ? `${me.isAdmin ? "관리자" : VIEWONLY ? "조회" : "회원"} · ${mgr}` : "";
    $("authStatus").title = me ? `${me.siteName || me.name || ""} · 서버 v${S.dataVersion}` : "";
    $("logoutBtn").textContent = VIEWONLY ? "홈으로" : "로그아웃";
    $("pchead").hidden = false;
    $("appName").textContent = TITLES[current] || (VIEWONLY ? "기록 조회" : "클럽관리");
  };

  /* 세로 화면: 좌우로 밀어 이전·다음 구역 (표 안에서 시작한 밀기는 표 가로 스크롤로 둬요) */
  let sw = null;
  view.addEventListener("touchstart", (e) => { if (!PHONE() || e.touches.length !== 1 || e.target.closest(".tbtable, input, select, textarea")) { sw = null; return; } sw = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  view.addEventListener("touchend", (e) => {
    if (!sw) return; const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y; sw = null;
    if (Math.abs(dx) < 80 || Math.abs(dy) > 50) return;
    const list = phList(), i = list.findIndex(([k]) => k === current); if (i < 0) return;
    const n = list[(i + (dx < 0 ? 1 : -1) + list.length) % list.length][0]; go(n);
  }, { passive: true });
})();
