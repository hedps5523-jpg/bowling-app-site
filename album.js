/* 기록앨범 만들기 (PC 클럽관리 입력 화면)
   모바일 볼링클럽 '기록앨범(ClubReportActivity)'을 웹으로 옮긴 화면이에요.
   선택한 항목을 1080×1920 한 장씩 그려서 JPG · PDF · 단독실행(독립뷰어 HTML)으로 만들어요.
   (club.js 다음, tablet.js 앞에서 불러와요.) */
(() => {
  "use strict";
  const LIBS = {
    html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  };
  const loadLib = (k, test) => new Promise((res, rej) => {
    if (test()) return res();
    const url = (window.ALBUM_LIBS && window.ALBUM_LIBS[k]) || LIBS[k];
    const s = document.createElement("script"); s.src = url; s.onload = () => (test() ? res() : rej(new Error(k + " 로드 실패"))); s.onerror = () => rej(new Error("라이브러리를 불러오지 못했어요 (" + k + "). 인터넷 연결을 확인해 주세요."));
    document.head.append(s);
  });
  const need = { h2c: () => loadLib("html2canvas", () => !!window.html2canvas), pdf: () => loadLib("jspdf", () => !!(window.jspdf && window.jspdf.jsPDF)), zip: () => loadLib("jszip", () => !!window.JSZip) };

  /* ---------- 설정 ---------- */
  const PREF = "bcAlbumPrefs";
  const AL = { screen: "main", group: null, sel: new Set(), confirm: new Set(), qpick: new Set([0]), format: "jpg", maskName: false, maskPhone: true, mergePdf: true, running: false, outputs: [], status: "", progress: 0, items: [] };
  try { const p = JSON.parse(localStorage.getItem(PREF) || "{}"); ["format", "maskName", "maskPhone", "mergePdf"].forEach((k) => { if (p[k] != null) AL[k] = p[k]; }); } catch {}
  const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify({ format: AL.format, maskName: AL.maskName, maskPhone: AL.maskPhone, mergePdf: AL.mergePdf })); } catch {} };

  /* ---------- 자료 도우미 ---------- */
  const ko = new Intl.Collator("ko", { sensitivity: "base" });
  const today = () => todayStr();
  const Y = () => yearOf(today());
  const mn = (s) => +s.slice(5, 7), dn = (s) => +s.slice(8, 10);
  const won = (v) => Number(v || 0).toLocaleString("ko-KR");
  const signed = (v) => (v >= 0 ? "+" : "") + won(v);
  const withdrawn = (m, ref) => !!m.withdrawalDate && ref >= m.withdrawalDate && (!m.rejoinDate || ref < m.rejoinDate);
  const activeMembers = () => S.members.filter((m) => !m.deletedAt && !withdrawn(m, today()));
  const mById = () => new Map(S.members.map((m) => [m.memberId, m]));
  const clubName = () => cleanTitle(S.programTitle);
  const asOf = () => today().replace(/-/g, ".") + " 기준";
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const dowOf = (d) => DOW[new Date(d + "T00:00:00").getDay()];
  const isExec = (m) => ["회장", "총무", "감사", "고문", "운영"].some((k) => (m.grade || "").includes(k));
  const GRADE_ORDER = ["회장", "운영총무", "전산총무", "고문", "감사"];
  const gradeRank = (m) => { const i = GRADE_ORDER.indexOf((m.grade || "").replace(/ /g, "")); return i >= 0 ? i : isExec(m) ? GRADE_ORDER.length : GRADE_ORDER.length + 1; };
  const genderRank = (g) => (g === "MALE" ? 0 : g === "FEMALE" ? 1 : 2);
  const sortedMembers = () => activeMembers().sort((a, b) => gradeRank(a) - gradeRank(b) || (isExec(a) ? 0 : genderRank(a.gender)) - (isExec(b) ? 0 : genderRank(b.gender)) || ko.compare(a.name, b.name));
  const ymdShort = (d) => (d ? d.slice(2) : "-"); // yy-mm-dd
  const md = (d) => { const m = String(d || "").match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); return m ? `${pad2(m[2])}-${pad2(m[3])}` : d || ""; };

  function qBase(m, date = today()) {
    if (!m) return 0;
    const y = yearOf(date), q = Math.floor((mn(date) - 1) / 3) + 1;
    const ex = S.sq[`${m.memberId}|${y}|${q}`]; if (ex != null) return ex;
    const [py, pq] = q === 1 ? [y - 1, 4] : [y, q - 1];
    const pv = S.sq[`${m.memberId}|${py}|${pq}`];
    return pv != null ? pv : m.currentBaseAverage;
  }
  const sc = (g) => [g.s1, g.s2, g.s3, g.s4];
  const gtype = (g) => (g.meetingType || "").trim() || "정모";
  const included = (m, d) => !!m && !m.deletedAt && !withdrawn(m, today()) && (!m.rejoinDate || d >= m.rejoinDate);

  /* 개인정보 가리기 (앱과 같은 규칙) */
  const maskNm = (n) => { if (!AL.maskName) return n; return n.length >= 3 ? n[0] + "*" + n.slice(2) : n.length === 2 ? n[0] + "*" : n; };
  const maskTel = (raw) => {
    if (!raw) return "-"; if (!AL.maskPhone) return raw;
    const p = raw.split("-"); return p.length === 3 ? `${p[0]}-****-${p[2]}` : raw.length >= 8 ? raw.slice(0, 3) + "****" + raw.slice(-4) : raw;
  };

  /* 최고하이 · 에버하이 · 올카 (정모만) */
  function roleMap(list) {
    const mm = mById(), base = (g) => qBase(mm.get(g.memberId), g.gameDate), nk = (g) => String(g.note || "").replace(/\s+/g, "");
    const smax = (g) => Math.max(...sc(g));
    const out = new Map(), groups = new Map();
    for (const g of list) { const k = g.gameDate + "|" + gtype(g); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
    const maxBy = (arr, cmp) => arr.reduce((b, x) => (b == null || cmp(x, b) > 0 ? x : b), null);
    for (const grp of groups.values()) {
      if (gtype(grp[0]) !== "정모") continue;
      const topCmp = (a, b) => (smax(a) - smax(b)) || (base(a) - base(b));
      const marked = grp.filter((g) => nk(g).includes("최고하이"));
      const top = maxBy(marked.length ? marked : grp.filter((g) => smax(g) > 0), topCmp);
      if (top) out.set(top.recordId, { role: "HIGH", score: smax(top), diff: smax(top) - base(top) });
      const devCmp = (a, b) => ((smax(a) - base(a)) - (smax(b) - base(b))) || (base(a) - base(b));
      const markedEver = grp.filter((g) => nk(g).includes("에버하이") && (!top || g.memberId !== top.memberId));
      const ever = maxBy(markedEver, devCmp) || maxBy(grp.filter((g) => (!top || g.memberId !== top.memberId) && smax(g) > 0 && base(g) > 0), devCmp);
      if (ever) out.set(ever.recordId, { role: "EVER", score: smax(ever), diff: smax(ever) - base(ever) });
      grp.filter((g) => nk(g).includes("올카") && (!top || g.memberId !== top.memberId) && (!ever || g.memberId !== ever.memberId)).forEach((g) => out.set(g.recordId, { role: "ALL", score: smax(g), diff: smax(g) - base(g) }));
    }
    return out;
  }

  /* ---------- 항목 목록 (앱 ClubReportRenderer.buildItems) ---------- */
  const G_MEMBER = "회원목록", G_LEDGER = "장부기록", G_FEE = "회비기록", G_LOCKER = "락카현황", G_GAME = "게임기록";
  const GROUPS = [G_MEMBER, G_LEDGER, G_FEE, G_LOCKER, G_GAME];
  const ledgerAll = () => S.ledger.filter((l) => l.date && yearOf(l.date) === S.year).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ledgerId - b.ledgerId));
  const lockersShown = () => S.lockerRows.filter((r) => String(r.locker_number || "").trim()).filter((r) => { const m = mById().get(int(r.member_id)); return m && !m.deletedAt && !withdrawn(m, today()); })
    .sort((a, b) => (parseInt(a.locker_number, 10) || 1e9) - (parseInt(b.locker_number, 10) || 1e9) || String(a.locker_number).localeCompare(String(b.locker_number)));
  const meetings = () => {
    const g = new Map();
    S.games.filter((x) => x.gameDate && yearOf(x.gameDate) === S.year).forEach((x) => { const k = x.gameDate + "|" + gtype(x); if (!g.has(k)) g.set(k, { date: x.gameDate, type: gtype(x), records: [] }); g.get(k).records.push(x); });
    return [...g.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  };
  function buildItems() {
    const L = [], am = activeMembers();
    const it = (key, group, title, subtitle, fname) => L.push({ key, group, title, subtitle, fname });
    it("MEMBER", G_MEMBER, "회원목록", `${am.length}명 · 연락처/등급/성별/가입일/기준에버/락카`, "회원목록");
    it("MEMBER_CONTACT", G_MEMBER, "연락처(뷰)", `${am.length}명 · 회원명(에버)/락카/구분/연락처`, "연락처뷰");
    it("LEDGER_ANNUAL_WIDE", G_LEDGER, "1년결산", `${S.year}년 · 월별 현황 · 수입/지출 분류표`, "장부_1년결산");
    it("LEDGER_SUMMARY", G_LEDGER, "월별 요약", `${S.year}년 월별 수입·지출·잔액`, "장부_월별요약");
    const led = ledgerAll();
    [...new Set(led.map((l) => mn(l.date)))].sort((a, b) => a - b).forEach((m) => {
      const rows = led.filter((l) => mn(l.date) === m), bal = led.filter((l) => mn(l.date) <= m).reduce((a, l) => a + (l.type === "수입" ? l.amount : -l.amount), 0);
      it("LEDGER_M_" + pad2(m), G_LEDGER, `${m}월 상세`, `${rows.length}건 · 잔액 ${won(bal)}`, `장부_${pad2(m)}월`);
    });
    it("FEE", G_FEE, "회비기록", `${Y()}년 · 완납/정상/예정/미납`, "회비기록");
    it("LOCKER", G_LOCKER, "락카현황", `${lockersShown().length}칸 · 보증금/사용료/계약·만료일`, "락카현황");
    it("GAME_RANK", G_GAME, "순위표", `${S.year}년 누적 평균`, "순위표");
    it("GAME_QUARTER", G_GAME, "분기에버", "분기 기준에버 변동", "분기에버");
    meetings().forEach((mt) => it(`GAME_MEET_${mt.date}_${mt.type}`, G_GAME, `${mn(mt.date)}/${dn(mt.date)} ${mt.type}`, `${new Set(mt.records.map((r) => r.memberId)).size}명 참가`, `모임_${mt.date.slice(5).replace("-", "")}_${mt.type}`));
    return L;
  }
  const pathOf = (item) => {
    const k = item.key;
    if (k === "MEMBER") return ["회원현황", "회원목록", null]; if (k === "MEMBER_CONTACT") return ["회원현황", "연락처(뷰)", null];
    if (k === "GAME_RANK") return ["기록현황", "순위표", null]; if (k === "GAME_QUARTER") return ["기록현황", "분기에버", null];
    if (k.startsWith("GAME_MEET_")) return ["기록현황", "모임기록", item.title];
    if (k === "LEDGER_ANNUAL_WIDE") return ["장부현황", "1년결산", null]; if (k === "LEDGER_SUMMARY") return ["장부현황", "월별 요약", null];
    if (k.startsWith("LEDGER_M_")) return ["장부현황", "월별 상세", item.title.replace(/ 상세$/, "")];
    if (k === "FEE") return ["회비현황", "회비 납부 현황", null]; if (k === "LOCKER") return ["락카현황", "락카 현황", null];
    return ["기록현황", item.title, null];
  };
  const MAJOR_ORDER = ["회원현황", "기록현황", "장부현황", "회비현황", "락카현황"];
  const MID_RANK = { "회원목록": 0, "연락처(뷰)": 1, "모임기록": 0, "순위표": 1, "분기에버": 2, "1년결산": 0, "월별 요약": 1, "월별 상세": 2 };
  const orderedSel = (set) => AL.items.filter((i) => set.has(i.key)).sort((a, b) => {
    const pa = pathOf(a), pb = pathOf(b);
    return MAJOR_ORDER.indexOf(pa[0]) - MAJOR_ORDER.indexOf(pb[0]) || (MID_RANK[pa[1]] ?? 9) - (MID_RANK[pb[1]] ?? 9) || AL.items.indexOf(a) - AL.items.indexOf(b);
  });

  /* ---------- 페이지 그리기 (1080×1920) ---------- */
  const TONE = { ok: "alp-ok", warn: "alp-warn", bad: "alp-bad" };
  function newPage(title, per) {
    const root = h("div", { class: "alp" });
    const head = h("div", { class: "alp-head" }, h("div", { class: "alp-club" }, clubName()), h("div", { class: "alp-title" }, title), h("div", { class: "alp-per" }, per));
    const body = h("div", { class: "alp-body" }), foot = h("div", { class: "alp-foot" });
    root.append(head, body, foot);
    return { root, body, foot: (t) => { foot.textContent = t; } };
  }
  const kpis = (list, small) => h("div", { class: "alp-kpis" + (small ? " sm" : "") }, list.map((k) => h("div", { class: "alp-kpi " + (TONE[k.tone] || "") }, h("small", {}, k.label), h("b", {}, k.value), k.sub ? h("em", {}, k.sub) : null)));
  const section = (t) => h("div", { class: "alp-sec" }, t);
  const legend = (items, extra) => h("div", { class: "alp-legend" }, items.flatMap(([c, l]) => [h("i", { style: c === "dash" ? "border:3px dashed #B9C6D3;background:transparent" : "background:" + c }), h("span", {}, l)]), extra ? h("span", {}, extra) : null);
  function monthBars(data) {
    const mx = Math.max(1, ...data.map((d) => Math.max(d[1], d[2])));
    return h("div", { class: "alp-bars" }, data.map(([l, a, b]) => h("div", { class: "alp-bar" }, h("div", { class: "alp-bcol" }, h("u", { style: `height:${Math.max(0, a) / mx * 100}%` }), h("s", { style: `height:${Math.max(0, b) / mx * 100}%` })), h("span", {}, l))));
  }
  function podium(top) {
    if (!top.length) return null;
    const cols = ["#D9A021", "#8DA2B6", "#B57A4F"], hs = [1, 0.8, 0.66];
    return h("div", { class: "alp-pod" }, [1, 0, 2].filter((r) => r < top.length).map((r) => h("div", { class: "alp-pcol", style: `height:${330 * hs[r]}px;background:${cols[r]}` }, h("b", {}, r + 1), h("strong", {}, top[r][0]), h("span", {}, top[r][1]))));
  }
  const PILL = { green: "alp-pg", red: "alp-pr", blue: "alp-pb", gray: "alp-pgr", yellow: "alp-py" };
  /* cols: [{t, w, align, wrap}], rows: [[cell]], cell = 문자열 | {t, color, bold, pill, dot, small} */
  function table(cols, rows, o = {}) {
    const tw = cols.reduce((a, c) => a + c.w, 0);
    const cell = (v, c, tag = "td") => {
      const x = typeof v === "object" && v !== null ? v : { t: v };
      const td = h(tag, { class: (c.align ? "a-" + c.align : "") + (c.wrap ? " wr" : "") });
      if (x.dot != null) td.append(x.dot === "none" ? h("i", { class: "alp-dot none" }) : h("i", { class: "alp-dot", style: "background:" + x.dot }));
      else if (x.pill) td.append(h("span", { class: "alp-pill " + PILL[x.pill] }, x.t));
      else td.append(x.t ?? "");
      if (x.color) td.style.color = x.color; if (x.bold) td.style.fontWeight = "800"; if (x.small) td.style.fontSize = "calc(var(--rs,1) * 25px)";
      return td;
    };
    const top = o.highlightTop || 0, hi = o.highlightRows || new Set();
    const t = h("table", { class: "alp-t", style: `--fs:${o.fs || 29}px` }, h("colgroup", {}, cols.map((c) => h("col", { style: `width:${c.w / tw * 100}%` }))),
      h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c.t)))),
      h("tbody", {}, rows.map((r, i) => h("tr", { class: (i < top ? "top " : "") + (hi.has(i) ? "hl " : "") + (i % 2 ? "alt" : "") }, r.map((v, j) => cell(v, cols[j]))))));
    if (o.summary) { const sp = o.summarySpan || 1; t.append(h("tfoot", {}, h("tr", {}, o.summary.map((v, j) => { if (j > 0 && j < sp) return null; const td = cell(v, cols[Math.min(j, cols.length - 1)], "td"); if (j === 0 && sp > 1) { td.colSpan = sp; td.style.textAlign = "left"; td.style.paddingLeft = "16px"; } return td; })))); }
    return t;
  }
  const C = (t, w, align, wrap) => ({ t, w, align, wrap });
  const GRN = "#147A45", RED = "#B42332", MUT = "#6B7F93", MUTI = "#475467", GOLD = "#E0A82E", EXE = "#8A63C9";

  const pageMembers = (contact) => {
    const list = sortedMembers(), lockerOf = new Map(lockersShown().map((r) => [int(r.member_id), String(r.locker_number)]));
    const pg = newPage(contact ? "연락처" : "회원 현황", asOf());
    if (!contact) {
      pg.body.append(kpis([{ label: "활동 회원", value: `${list.length}명` }, { label: "운영진", value: `${list.filter(isExec).length}명` }, { label: "남 / 여", value: `${list.filter((m) => m.gender === "MALE").length} / ${list.filter((m) => m.gender === "FEMALE").length}` }, { label: "락카 사용", value: `${lockerOf.size}명`, tone: "ok" }]));
      pg.body.append(table([C("No", 0.7), C("회원명", 1.5), C("연락처", 2.3), C("등급", 1.6), C("성별", 0.8), C("가입일", 1.4), C("기준에버", 1.2), C("락카", 0.9)],
        list.map((m, i) => [{ t: i + 1, bold: true }, { t: maskNm(m.name), bold: true }, maskTel(m.phone), { t: m.grade || "-", pill: isExec(m) ? "blue" : "gray" }, m.gender === "MALE" ? "남" : m.gender === "FEMALE" ? "여" : "-", ymdShort(m.joinDate), { t: qBase(m) > 0 ? String(qBase(m)) : "-", bold: true }, lockerOf.get(m.memberId) || "-"]), { fs: 29 }));
    } else {
      pg.body.append(table([C("No", 0.7), C("회원명(에버)", 2), C("락카", 0.9), C("구분", 1.6), C("연락처", 2.3)],
        list.map((m, i) => [{ t: i + 1, bold: true }, { t: maskNm(m.name) + (qBase(m) > 0 ? `(${qBase(m)})` : ""), bold: true }, lockerOf.get(m.memberId) || "-", { t: m.grade || "-", pill: isExec(m) ? "blue" : "gray" }, maskTel(m.phone)]), { fs: 29 }));
    }
    pg.foot("활동 회원 전체"); return pg;
  };

  const monthRows = () => {
    const led = ledgerAll(); let bal = 0;
    return [...new Set(led.map((l) => mn(l.date)))].sort((a, b) => a - b).map((m) => {
      const es = led.filter((l) => mn(l.date) === m), inc = es.filter((l) => l.type === "수입").reduce((a, l) => a + l.amount, 0), exp = es.filter((l) => l.type !== "수입").reduce((a, l) => a + l.amount, 0);
      const carry = es.filter((l) => l.type === "수입" && l.category.includes("이월")).reduce((a, l) => a + l.amount, 0);
      bal += inc - exp; return { m, inc, exp, bal, carry };
    });
  };
  const pageLedgerSummary = () => {
    const rows = monthRows(), ti = rows.reduce((a, r) => a + r.inc - r.carry, 0), te = rows.reduce((a, r) => a + r.exp, 0), bal = rows.length ? rows[rows.length - 1].bal : 0;
    const pg = newPage("장부 월별 요약", `${S.year}년 (${mmdd(today())} 기준)`);
    pg.body.append(kpis([{ label: "연간 수입", value: won(ti), tone: "ok" }, { label: "연간 지출", value: won(te), tone: "bad" }, { label: "현재 잔액", value: won(bal) }], true), section("월별 수입·지출"), monthBars(rows.map((r) => [`${r.m}월`, r.inc - r.carry, r.exp])),
      legend([["#2D6F9F", "수입"], ["#D9534F", "지출"]], rows.some((r) => r.carry > 0) ? "※ 그래프는 이월금 제외" : null));
    pg.body.append(table([C("월", 0.62), C("이월금", 1.2), C("수입", 1.2), C("지출", 1.1), C("차액", 1.15), C("월말 잔액", 1.25)],
      rows.map((r, i) => { const d = r.inc - r.carry - r.exp; return [{ t: `${r.m}월`, bold: true }, { t: won(i === 0 ? r.carry : rows[i - 1].bal), color: MUTI, bold: true }, { t: won(r.inc - r.carry), color: GRN, bold: true }, { t: won(r.exp), color: RED, bold: true }, { t: signed(d), color: d >= 0 ? GRN : RED, bold: true }, { t: won(r.bal), bold: true }]; }),
      { fs: 27, summary: ["합계", "-", won(ti), won(te), signed(ti - te), won(bal)] }));
    pg.foot(`총 ${ledgerAll().length}건`); return pg;
  };
  const pageLedgerAnnual = () => {
    const rows = monthRows(), led = ledgerAll(), ti = rows.reduce((a, r) => a + r.inc - r.carry, 0), te = rows.reduce((a, r) => a + r.exp, 0), bal = rows.length ? rows[rows.length - 1].bal : 0;
    const pg = newPage("1년 결산", `${S.year}년 · ${asOf()}`);
    pg.body.append(kpis([{ label: "총수입(이월 제외)", value: won(ti), tone: "ok" }, { label: "총지출", value: won(te), tone: "bad" }, { label: "수지차액", value: signed(ti - te) }, { label: "현재 잔액", value: won(bal) }], true));
    pg.body.append(section("월별 현황"), table([C("월", 0.7), C("수입", 1.3), C("지출", 1.3), C("차액", 1.3), C("월말 잔액", 1.4)],
      rows.map((r) => { const d = r.inc - r.carry - r.exp; return [{ t: `${r.m}월`, bold: true }, { t: won(r.inc - r.carry), color: GRN }, { t: won(r.exp), color: RED }, { t: signed(d), color: d >= 0 ? GRN : RED }, { t: won(r.bal), bold: true }]; }), { fs: 26 }));
    const by = (income) => { const m = new Map(); led.filter((l) => (l.type === "수입") === income && !(income && l.category.includes("이월"))).forEach((l) => { const k = l.category.trim() || "기타"; m.set(k, (m.get(k) || 0) + l.amount); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const brk = (title, income, color) => { const list = by(income), tot = list.reduce((a, x) => a + x[1], 0); return h("div", { class: "alp-half" }, section(title), table([C("항목", 2, "left"), C("금액", 1.4, "right"), C("비율", 0.8)], list.map(([k, v]) => [{ t: k, bold: true }, { t: won(v), color }, tot ? (v / tot * 100).toFixed(1) + "%" : "-"]), { fs: 25, summary: ["합계", { t: won(tot), bold: true, color }, ""] })); };
    pg.body.append(h("div", { class: "alp-two" }, brk("수입 분류", true, GRN), brk("지출 분류", false, RED)));
    pg.foot(`총 ${led.length}건`); return pg;
  };
  const pageLedgerMonth = (month) => {
    const led = ledgerAll(), signedAmt = (l) => (l.type === "수입" ? l.amount : -l.amount);
    const start = led.filter((l) => mn(l.date) < month).reduce((a, l) => a + signedAmt(l), 0), rows = led.filter((l) => mn(l.date) === month);
    const inc = rows.filter((l) => l.type === "수입").reduce((a, l) => a + l.amount, 0), exp = rows.filter((l) => l.type !== "수입").reduce((a, l) => a + l.amount, 0), end = start + inc - exp;
    const carryM = rows.filter((l) => l.type === "수입" && l.category.trim() === "이월금").reduce((a, l) => a + l.amount, 0), incShown = inc - carryM;
    const pg = newPage("월별 장부 상세", `${S.year}년 ${month}월` + (month === mn(today()) ? ` (${mmdd(today())}까지)` : ""));
    pg.body.append(kpis([month === 1 ? { label: "전년 이월", value: won(start + carryM) } : { label: "전월 이월", value: won(start) }, { label: "수입", value: won(incShown), tone: "ok" }, { label: "지출", value: won(exp), tone: "bad" }, { label: "월말 잔액", value: won(end) }], true), section(`상세 기록 (${rows.length}건)`));
    let bal = start;
    pg.body.append(table([C("일자", 0.9), C("구분", 0.95), C("항목", 1.25), C("내용", 3.2, "left", true), C("금액", 1.4, "right"), C("잔액", 1.5, "right")],
      rows.map((l) => { bal += signedAmt(l); const isIn = l.type === "수입"; return [mmdd(l.date), { t: l.type, pill: isIn ? "green" : "red" }, l.category || "-", { t: l.note || "-", color: MUTI, small: true }, { t: (isIn ? "" : "-") + won(l.amount), color: isIn ? GRN : RED, bold: true }, won(bal)]; }),
      { fs: 27, summarySpan: 4, summary: [`${month}월 합계 (수입 − 지출)`, "", "", "", signed(incShown - exp), won(end)] }));
    pg.foot(`${month}월말 잔액 ${won(end)}원`); return pg;
  };

  function isFeeTarget(m, y, mo, pays) {
    if (m.feeExempt) return false;
    const key = y * 100 + mo, baseKey = m.feeStartYear * 100 + Math.min(12, Math.max(1, m.feeStartMonth || 1));
    if (key < baseKey) return false;
    const rjY = m.rejoinFeeStartYear > 0 ? m.rejoinFeeStartYear : m.rejoinDate ? yearOf(m.rejoinDate) : null;
    const rjM = m.rejoinFeeStartMonth >= 1 && m.rejoinFeeStartMonth <= 12 ? m.rejoinFeeStartMonth : m.rejoinDate ? mn(m.rejoinDate) : null;
    const rjKey = rjY != null && rjM != null ? rjY * 100 + rjM : null;
    let wKey = null;
    if (m.withdrawalDate) {
      const fin = pays.filter((p) => rjKey == null || p.year * 100 + p.month < rjKey).reduce((a, p) => Math.max(a, p.year * 100 + p.month), 0);
      wKey = fin ? (fin % 100 >= 12 ? (Math.floor(fin / 100) + 1) * 100 + 1 : fin + 1) : yearOf(m.withdrawalDate) * 100 + mn(m.withdrawalDate);
    }
    if (rjKey != null && key >= rjKey) return true;
    if (wKey != null && key >= wKey) return false;
    return true;
  }
  const pageFee = () => {
    const year = Y(), tm = mn(today()), members = activeMembers().filter((m) => !m.feeExempt), pays = S.fees.filter((p) => p.year === year);
    const built = members.map((m) => {
      const p = new Map(pays.filter((x) => x.memberId === m.memberId).map((x) => [x.month, x])), prior = S.fees.filter((x) => x.memberId === m.memberId);
      let hasUnpaid = false, curUnpaid = false, req = 0, allPaid = true;
      const cells = Array.from({ length: 12 }, (_, i) => {
        const mo = i + 1, fp = p.get(mo), active = isFeeTarget(m, year, mo, prior), exempt = active && m.executiveThreeMonthExempt && mo >= 10;
        if (active && !exempt) { req++; if (!fp) allPaid = false; }
        if (fp) return "P"; if (!active) return "N"; if (exempt) return "E";
        if (mo <= tm) { if (mo === tm) { curUnpaid = true; return "S"; } hasUnpaid = true; return "O"; }
        return "N";
      });
      return { m, cells, status: req > 0 && allPaid ? "완납" : hasUnpaid ? "미납" : curUnpaid ? "예정" : "정상", total: [...p.values()].reduce((a, x) => a + x.amount, 0) };
    });
    const rank = { 완납: 0, 정상: 1, 예정: 2, 미납: 3 };
    built.sort((a, b) => rank[a.status] - rank[b.status] || ko.compare(a.m.name, b.m.name));
    const cnt = (s) => built.filter((b) => b.status === s).length, total = built.reduce((a, b) => a + b.total, 0);
    const DOT = { P: GRN, S: GOLD, O: RED, E: EXE, N: "none" }, PL = { 완납: "green", 정상: "blue", 예정: "yellow", 미납: "red" };
    const pg = newPage("회비 납부 현황", `${year}년 · 월 회비 ${won(S.monthlyFee)}원 · ${asOf()}`);
    pg.body.append(kpis([{ label: "완납", value: `${cnt("완납")}명`, tone: "ok" }, { label: "정상", value: `${cnt("정상")}명` }, { label: "예정", value: `${cnt("예정")}명`, tone: "warn" }, { label: "미납", value: `${cnt("미납")}명`, tone: "bad" }]));
    pg.body.append(table([C("회원", 1.6), ...Array.from({ length: 12 }, (_, i) => C(String(i + 1), 0.55)), C("상태", 1.2)],
      built.map((b) => [maskNm(b.m.name), ...b.cells.map((c) => ({ dot: DOT[c] })), { t: b.status, pill: PL[b.status] }]), { fs: 28 }));
    pg.body.append(legend([[GRN, "납부"], [GOLD, "예정(현재월)"], [RED, "미납(이전 달)"], [EXE, "운영진 면제"], ["dash", "대상 아님"]]));
    pg.foot(`${year}년 납부 합계 ${won(total)}원`); return pg;
  };
  const pageLocker = () => {
    const st = S.settings, dDep = int(st.key_locker_deposit), dFee = int(st.key_locker_yearly_fee), dCon = st.key_locker_contract_date || "", dExp = st.key_locker_expiry_date || "", mm = mById();
    const list = lockersShown(); let dep = 0, fee = 0;
    const rows = list.map((r) => {
      const m = mm.get(int(r.member_id)), d = int(r.deposit) || dDep, f = int(r.yearly_fee) || dFee, ex = md(r.expiry_date || dExp);
      dep += d; fee += f;
      return [{ t: String(r.locker_number), bold: true }, { t: maskNm(m ? m.name : "-"), bold: true }, d > 0 ? won(d) : "-", f > 0 ? won(f) : "-", md(r.contract_date || dCon) || "-", { t: ex || "-", pill: ex ? "yellow" : null }, ymdShort(m && m.joinDate)];
    });
    const pg = newPage("락카 현황", asOf());
    pg.body.append(kpis([{ label: "전체", value: `${list.length}칸` }, { label: "사용중", value: `${list.length}칸` }, { label: "보증금 합계", value: won(dep) }, { label: "1년 사용료 합계", value: won(fee) }], true));
    pg.body.append(table([C("번호", 0.9), C("회원명", 2), C("보증금", 1.1), C("1년 사용료", 1.2), C("계약일", 1), C("만료일", 1), C("가입일", 1.1)], rows, { fs: 29 }));
    pg.foot(`1년 사용료 합계 ${won(fee)}원`); return pg;
  };
  const pageMeeting = (mt) => {
    const mm = mById(), recs = mt.records, roles = roleMap(recs);
    const byM = new Map(); recs.forEach((g) => { if (!byM.has(g.memberId)) byM.set(g.memberId, g); });
    const rows = [...byM.values()].map((g) => { const played = sc(g).filter((v) => v > 0); return { g, sc: sc(g), total: played.reduce((a, b) => a + b, 0), avg: played.length ? played.reduce((a, b) => a + b, 0) / played.length : 0, role: roles.get(g.recordId) }; }).sort((a, b) => b.avg - a.avg);
    const gc = [0, 1, 2, 3].filter((i) => rows.some((r) => r.sc[i] > 0)), all = rows.flatMap((r) => r.sc.filter((v) => v > 0));
    const nm = (id) => maskNm((mm.get(id) || {}).name || "#" + id);
    const top = rows.find((r) => r.role && r.role.role === "HIGH"), ever = rows.find((r) => r.role && r.role.role === "EVER"), ac = rows.filter((r) => r.role && r.role.role === "ALL");
    const pg = newPage("모임 결과", `${mt.date.replace(/-/g, ".")} (${dowOf(mt.date)}) ${mt.type} · ${gc.length}게임`);
    pg.body.append(kpis([{ label: "참가", value: `${rows.length}명` }, { label: "최고하이", value: top ? nm(top.g.memberId) : "-", tone: "warn", sub: top ? `${top.role.score}점` : null }, { label: "에버하이", value: ever ? nm(ever.g.memberId) : "-", tone: "warn", sub: ever ? `${ever.role.score}점 · ${ever.role.diff >= 0 ? "+" : ""}${ever.role.diff}` : null }, { label: "전체 평균", value: all.length ? (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1) : "-" }]));
    pg.body.append(table([C("순위", 0.8), C("회원", 1.4), ...gc.map((i) => C(`${i + 1}G`, 0.9)), C("합계", 1), C("평균", 1)],
      rows.map((r, i) => [{ t: i + 1, bold: true }, { t: nm(r.g.memberId), bold: !!(r.role && r.role.role === "ALL") }, ...gc.map((k) => { const v = r.sc[k], pill = v > 0 && r.role && v === r.role.score ? (r.role.role === "HIGH" ? "yellow" : r.role.role === "EVER" ? "blue" : null) : null; return { t: v > 0 ? String(v) : "-", pill }; }), { t: r.total, bold: true }, r.avg.toFixed(1)]),
      { highlightTop: 3, highlightRows: new Set(rows.map((r, i) => (r.role && r.role.role === "ALL" ? i : -1)).filter((i) => i >= 0)) }));
    pg.foot(ac.length ? "올카 : " + ac.map((r) => nm(r.g.memberId)).join(" / ") : `최고하이 ${top ? top.role.score : 0}` + (ever ? ` · 에버하이 ${ever.role.diff >= 0 ? "+" : ""}${ever.role.diff}` : "")); return pg;
  };
  const pageRank = () => {
    const mm = mById(), by = new Map();
    S.games.filter((g) => g.gameDate && yearOf(g.gameDate) === S.year && included(mm.get(g.memberId), g.gameDate)).forEach((g) => { if (!by.has(g.memberId)) by.set(g.memberId, []); by.get(g.memberId).push(...sc(g).filter((v) => v > 0)); });
    const rows = [...by.entries()].filter(([, v]) => v.length).map(([id, v]) => ({ id, avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length, hi: Math.max(...v) })).sort((a, b) => b.avg - a.avg);
    const nm = (id) => maskNm((mm.get(id) || {}).name || "#" + id);
    const pg = newPage("시즌 순위표", `${S.year}년 누적 · 게임 평균 기준`);
    pg.body.append(podium(rows.slice(0, 3).map((r) => [nm(r.id), r.avg.toFixed(1)])), table([C("순위", 0.8), C("회원", 1.5), C("평균", 1.1), C("게임수", 1), C("최고", 1)], rows.map((r, i) => [{ t: i + 1, bold: true }, nm(r.id), { t: r.avg.toFixed(1), bold: true }, String(r.n), String(r.hi)]), { highlightTop: 3 }));
    pg.foot(`총 ${rows.length}명`); return pg;
  };
  /* 분기에버 변동: 선택값(0=자동, 1~4) → 비교 구간 */
  function defaultQuarter() {
    const y = Y(), q = Math.floor((mn(today()) - 1) / 3) + 1, decided = activeMembers().some((m) => S.sq[`${m.memberId}|${y}|${q}`] != null);
    return decided ? [y, q] : q > 1 ? [y, q - 1] : [y - 1, 4];
  }
  const spanOf = (c) => { const y = S.year; if (c >= 1 && c <= 3) return [y, c, y, c + 1]; if (c === 4) return [y, 4, y + 1, 1]; const [ty, tq] = defaultQuarter(); return tq > 1 ? [ty, tq - 1, ty, tq] : [ty - 1, 4, ty, 1]; };
  const pageQuarter = (choice) => {
    const [sy, sq, ty, tq] = spanOf(choice), mm = mById();
    const carried = (id, fy, fq) => { let yy = fy, qq = fq; for (let i = 0; i < 8; i++) { const v = S.sq[`${id}|${yy}|${qq}`]; if (v != null) return v; if (qq === 1) { yy--; qq = 4; } else qq--; } return null; };
    const rows = activeMembers().map((m) => {
      const saved = S.sq[`${m.memberId}|${ty}|${tq}`], fb = m.currentBaseAverage > 0 ? m.currentBaseAverage : null;
      const prev = carried(m.memberId, sy, sq) ?? saved ?? fb, cur = saved ?? prev;
      const v = S.games.filter((g) => g.memberId === m.memberId && g.gameDate && yearOf(g.gameDate) === sy && Math.floor((mn(g.gameDate) - 1) / 3) + 1 === sq).flatMap((g) => sc(g).filter((x) => x > 0));
      return { m, prev, act: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, cur };
    }).sort((a, b) => (b.cur || 0) - (a.cur || 0) || (b.act || 0) - (a.act || 0) || ko.compare(a.m.name, b.m.name));
    const dl = (r) => (r.prev != null && r.cur != null ? r.cur - r.prev : null);
    const up = rows.filter((r) => (dl(r) || 0) > 0).length, dw = rows.filter((r) => (dl(r) || 0) < 0).length, cv = rows.map((r) => r.cur).filter((v) => v != null);
    const pg = newPage("분기 에버 변동", `${sy}년 ${sq}분기 → ${ty}년 ${tq}분기 책정에버`);
    const k = [{ label: "에버 상승", value: `${up}명`, tone: "ok" }]; if (dw) k.push({ label: "하락", value: `${dw}명`, tone: "bad" });
    k.push({ label: "유지", value: `${rows.length - up - dw}명` }, { label: `${tq}분기 평균`, value: cv.length ? (cv.reduce((a, b) => a + b, 0) / cv.length).toFixed(1) : "-" });
    pg.body.append(kpis(k), table([C("회원", 1.4), C(`${sq}분기 기준`, 1.2), C(`${sq}분기 누적`, 1.2), C(`${tq}분기 책정`, 1.2), C("변동", 1)],
      rows.map((r) => { const d = dl(r); return [{ t: maskNm(r.m.name), bold: (d || 0) > 0 }, r.prev != null ? String(r.prev) : "-", r.act != null ? r.act.toFixed(1) : "-", { t: r.cur != null ? String(r.cur) : "-", bold: true, color: (d || 0) > 0 ? GRN : null }, d == null ? { t: "-", color: MUT } : d > 0 ? { t: `▲ ${d}`, bold: true, pill: "green" } : d < 0 ? { t: `▼ ${-d}`, bold: true, color: RED } : { t: "유지", color: MUT }]; }),
      { highlightRows: new Set(rows.map((r, i) => ((dl(r) || 0) > 0 ? i : -1)).filter((i) => i >= 0)) }));
    pg.foot("에버 상승 회원 강조 · 하락 없음(유지/상승) · 관리자 책정값 우선 · 활동 회원 전체"); return pg;
  };

  /* 항목 → 페이지 목록 (분기에버는 선택한 분기마다 한 장) */
  function pagesOf(item) {
    const k = item.key, one = (el, extra = {}) => [{ item, el, ...extra }];
    if (k === "MEMBER") return one(pageMembers(false)); if (k === "MEMBER_CONTACT") return one(pageMembers(true));
    if (k === "LEDGER_ANNUAL_WIDE") return one(pageLedgerAnnual()); if (k === "LEDGER_SUMMARY") return one(pageLedgerSummary());
    if (k.startsWith("LEDGER_M_")) return one(pageLedgerMonth(+k.slice(9)));
    if (k === "FEE") return one(pageFee()); if (k === "LOCKER") return one(pageLocker()); if (k === "GAME_RANK") return one(pageRank());
    if (k === "GAME_QUARTER") { const ch = AL.qpick.size ? [...AL.qpick].sort() : [0]; return ch.map((c) => ({ item, el: pageQuarter(c), suffix: ch.length > 1 || c ? (c ? `_${c}분기` : "_자동") : "", sub: ch.length > 1 || c ? (c ? `${c}분기` : "자동") : null })); }
    if (k.startsWith("GAME_MEET_")) { const [, , d, t] = k.split("_"), mt = meetings().find((x) => x.date === d && x.type === t); return mt ? one(pageMeeting(mt)) : []; }
    return [];
  }

  /* ---------- 그림으로 만들기 (html2canvas) ---------- */
  function fit(root) {
    const body = root.querySelector(".alp-body"), head = root.querySelector(".alp-head"), foot = root.querySelector(".alp-foot");
    const lim = () => 1920 - head.offsetHeight - foot.offsetHeight - 90;
    let rs = 1; root.style.setProperty("--rs", 1);
    while (body.scrollHeight > lim() && rs > 0.6) { rs = Math.round((rs - 0.04) * 100) / 100; root.style.setProperty("--rs", rs); root.classList.toggle("alp-compact", rs < 1); }
    if (body.scrollHeight > lim()) { const k = lim() / body.scrollHeight; body.style.width = 1080 / k + "px"; body.style.transformOrigin = "0 0"; body.style.transform = `scale(${k})`; body.style.height = lim() + "px"; }
  }
  let stage = null;
  const getStage = () => { if (!stage) { stage = h("div", { id: "alstage", "aria-hidden": "true" }); document.body.append(stage); } return stage; };
  async function snap(el0) {
    const el = el0.root || el0;
    const st = getStage(); st.textContent = ""; st.append(el); fit(el);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const canvas = await window.html2canvas(el, { scale: 1, width: 1080, height: 1920, backgroundColor: "#ffffff", logging: false, useCORS: true, windowWidth: 1080 });
    const rects = {}; const base = el.getBoundingClientRect();
    el.querySelectorAll("[data-pg]").forEach((n) => { const r = n.getBoundingClientRect(); (rects[n.dataset.pg] = rects[n.dataset.pg] || []).push([r.left - base.left, r.top - base.top, r.width, r.height]); });
    const url = canvas.toDataURL("image/jpeg", 0.9);
    st.textContent = ""; return { url, rects };
  }
  const dataToBlob = (u) => { const b = atob(u.split(",")[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new Blob([a], { type: "image/jpeg" }); };
  const stamp = () => { const d = new Date(); return `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`; };
  const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "_");

  /* 색인 쪽(표지 + 분류별 색인): 합친 PDF와 독립뷰어에 넣어요 */
  function indexPage(pages) {
    const pg = newPage("기록앨범 색인", `${S.year}년 · 총 ${pages.length + 1}쪽`);
    const wrap = h("div", { class: "alp-idx" });
    MAJOR_ORDER.forEach((maj, n) => {
      const mine = pages.map((p, i) => ({ p, no: i + 2 })).filter((x) => x.p.major === maj); if (!mine.length) return;
      wrap.append(h("div", { class: "alp-imaj", "data-pg": mine[0].no }, h("b", {}, `${n + 1}. ${maj}`), h("span", {}, `${mine[0].no}쪽`)));
      let lastMid = null;
      mine.forEach((x) => {
        if (x.p.middle !== lastMid) { lastMid = x.p.middle; wrap.append(h("div", { class: "alp-imid", "data-pg": x.no }, h("span", {}, x.p.middle), h("span", {}, `${x.no}쪽`))); }
        if (x.p.minor) wrap.append(h("div", { class: "alp-imin", "data-pg": x.no }, h("span", {}, x.p.minor), h("span", {}, `${x.no}쪽`)));
      });
    });
    pg.body.append(wrap); pg.foot(`${clubName()} · ${asOf()}`); return pg.root;
  }

  /* ---------- 독립뷰어 HTML ---------- */
  function viewerHtml(meta, pages) {
    const data = JSON.stringify({ club: meta.club, year: meta.year, made: meta.made, pages: pages.map((p) => ({ t: p.title, major: p.major, mid: p.middle, minor: p.minor, img: p.url })) }).replace(/</g, "\\u003c");
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${meta.club.replace(/[<>&]/g, "")} 기록앨범 ${meta.year}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;background:#eef3f8;color:#1d2b3a}
header{background:linear-gradient(135deg,#14304f,#2d6f9f);color:#fff;padding:28px 20px;text-align:center}header h1{margin:0 0 6px;font-size:26px}header p{margin:0;opacity:.85}
main{max-width:1100px;margin:0 auto;padding:16px}h2{font-size:17px;margin:22px 4px 8px;color:#14304f}
.idx{background:#fff;border-radius:14px;padding:6px 14px;border:1px solid #e3eaf1}.idx .mj{font-weight:800;margin:10px 0 2px;color:#14304f}.idx a{display:flex;justify-content:space-between;padding:7px 10px;border-radius:8px;color:#1d2b3a;text-decoration:none;cursor:pointer;font-size:14px}.idx a:hover{background:#e8f1f8}.idx a.mn{padding-left:28px;color:#475467}
.th{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.th figure{margin:0;background:#fff;border:1px solid #e3eaf1;border-radius:12px;padding:8px;cursor:pointer}.th img{width:100%;display:block;border-radius:6px}.th figcaption{font-size:12px;text-align:center;margin-top:6px;color:#475467}
#fs{position:fixed;inset:0;background:#0b1622;display:none;flex-direction:column;z-index:9}#fs.on{display:flex}#bar{display:flex;gap:8px;align-items:center;padding:8px 12px;color:#fff;background:#14304f}#bar b{flex:1;font-size:14px}#bar button{background:#2d6f9f;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer}
#stage{flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:10px}#stage img{max-width:none;display:block;background:#fff}
</style></head><body><header><h1>${meta.club.replace(/[<>&]/g, "")}</h1><p>${meta.year}년 기록앨범 · 총 <span id="n"></span>쪽 · ${meta.made} 작성</p></header>
<main><h2>색인</h2><div class="idx" id="idx"></div><h2>쪽 보기</h2><div class="th" id="th"></div></main>
<div id="fs"><div id="bar"><button id="pv">◀ 이전</button><button id="nx">다음 ▶</button><b id="tt"></b><button id="zo">축소</button><button id="zi">확대</button><button id="fit">맞춤</button><button id="cl">닫기</button></div><div id="stage"><img id="im"></div></div>
<script>
const D=${data};const P=D.pages;let cur=0,zoom=0;const $=i=>document.getElementById(i);$("n").textContent=P.length;
const idx=$("idx");let lm=null,ll=null;P.forEach((p,i)=>{if(p.major!==lm){lm=p.major;ll=null;const d=document.createElement("div");d.className="mj";d.textContent=p.major;idx.append(d)}
if(p.mid!==ll){ll=p.mid;const a=document.createElement("a");a.innerHTML="<span></span><span>"+(i+1)+"쪽</span>";a.firstChild.textContent=p.mid;a.onclick=()=>open(i);idx.append(a)}
if(p.minor){const a=document.createElement("a");a.className="mn";a.innerHTML="<span></span><span>"+(i+1)+"쪽</span>";a.firstChild.textContent=p.minor;a.onclick=()=>open(i);idx.append(a)}});
P.forEach((p,i)=>{const f=document.createElement("figure");f.innerHTML="<img loading=lazy><figcaption></figcaption>";f.firstChild.src=p.img;f.lastChild.textContent=(i+1)+". "+(p.minor?p.mid+" · "+p.minor:p.mid);f.onclick=()=>open(i);$("th").append(f)});
function fitZ(){const s=$("stage");zoom=Math.min(s.clientWidth-20,(s.clientHeight-20)*1080/1920)/1080;apply()}
function apply(){$("im").style.width=Math.round(1080*zoom)+"px"}
function show(i){cur=(i+P.length)%P.length;$("im").src=P[cur].img;$("tt").textContent=(cur+1)+" / "+P.length+" · "+(P[cur].minor?P[cur].mid+" · "+P[cur].minor:P[cur].mid);$("stage").scrollTop=0}
function open(i){$("fs").classList.add("on");show(i);fitZ()}
$("pv").onclick=()=>show(cur-1);$("nx").onclick=()=>show(cur+1);$("cl").onclick=()=>$("fs").classList.remove("on");$("zi").onclick=()=>{zoom*=1.25;apply()};$("zo").onclick=()=>{zoom/=1.25;apply()};$("fit").onclick=fitZ;
addEventListener("keydown",e=>{if(!$("fs").classList.contains("on"))return;if(e.key==="ArrowLeft")show(cur-1);else if(e.key==="ArrowRight")show(cur+1);else if(e.key==="Escape")$("fs").classList.remove("on")});
addEventListener("resize",()=>{if($("fs").classList.contains("on"))fitZ()});
<\/script></body></html>`;
  }

  /* ---------- 만들기 실행 ---------- */
  async function run() {
    if (AL.running) return; AL.running = true; AL.outputs = []; AL.screen = "result"; AL.progress = 0; AL.status = "라이브러리를 불러오는 중…"; draw();
    const setP = (n, t) => { AL.progress = n; AL.status = t; paintResult(); };
    try {
      await need.h2c(); const fm = AL.format;
      if (fm === "pdf" || fm === "both" || fm === "viewer") await need.pdf().catch((e) => { if (fm !== "viewer") throw e; });
      await need.zip().catch(() => {});
      const items = orderedSel(AL.confirm), isAll = items.length === AL.items.length;
      const pages = [];
      for (const it of items) for (const p of pagesOf(it)) pages.push(p);
      if (!pages.length) throw new Error("만들 항목이 없어요.");
      const done = [];
      for (let i = 0; i < pages.length; i++) {
        setP(Math.round((i / pages.length) * 90), `${i + 1} / ${pages.length} 장 그리는 중…`);
        const p = pages[i], path = pathOf(p.item);
        const r = await snap(p.el);
        done.push({ title: p.item.title + (p.sub ? ` ${p.sub}` : ""), major: path[0], middle: path[1], minor: path[2] ? path[2] + (p.sub ? ` ${p.sub}` : "") : (p.sub || null), fname: p.item.fname + (p.suffix || ""), url: r.url });
        await new Promise((r2) => setTimeout(r2, 0));
      }
      setP(92, "파일로 묶는 중…");
      const st = stamp(), add = (name, blob, note) => AL.outputs.push({ name, blob, note });
      const wantJpg = fm === "jpg" || fm === "both", wantPdf = fm === "pdf" || fm === "both";
      if (wantJpg) {
        const names = done.map((d, i) => `${pad2(i + 1)}_${safe(d.fname)}.jpg`);
        if (done.length === 1) add(names[0], dataToBlob(done[0].url), "JPG 1장");
        else { const z = new JSZip(), dir = isAll ? z.folder(`전체_${st}`) : z; done.forEach((d, i) => dir.file(names[i], dataToBlob(d.url))); add(`기록앨범_JPG_${st}.zip`, await z.generateAsync({ type: "blob" }), `JPG ${done.length}장 (ZIP)`); }
      }
      if (wantPdf) {
        const { jsPDF } = window.jspdf, mk = () => new jsPDF({ unit: "px", format: [1080, 1920], orientation: "portrait", hotfixes: ["px_scaling"], compress: true });
        if (isAll || (AL.mergePdf && done.length > 1)) {
          const ix = await snap(indexPage(done)), doc = mk();
          doc.addImage(ix.url, "JPEG", 0, 0, 1080, 1920); doc.setProperties({ title: `${clubName()} 기록앨범 ${S.year}` });
          Object.entries(ix.rects).forEach(([pgNo, list]) => list.forEach(([x, y, w, hh]) => doc.link(x, y, w, hh, { pageNumber: +pgNo })));
          const outline = doc.outline, nodes = new Map();
          done.forEach((d, i) => {
            doc.addPage([1080, 1920], "portrait"); doc.addImage(d.url, "JPEG", 0, 0, 1080, 1920);
            const pgn = i + 2, key1 = d.major, key2 = d.major + "|" + d.middle;
            if (!nodes.has(key1)) nodes.set(key1, outline.add(null, d.major, { pageNumber: pgn }));
            if (!nodes.has(key2)) nodes.set(key2, outline.add(nodes.get(key1), d.middle, { pageNumber: pgn }));
            if (d.minor) outline.add(nodes.get(key2), d.minor, { pageNumber: pgn });
          });
          add(`기록앨범_${st}.pdf`, doc.output("blob"), `PDF 1개 · ${done.length + 1}쪽 (색인·책갈피)`);
        } else if (done.length === 1) { const doc = mk(); doc.addImage(done[0].url, "JPEG", 0, 0, 1080, 1920); add(`${safe(done[0].fname)}.pdf`, doc.output("blob"), "PDF 1개"); }
        else { const z = new JSZip(); done.forEach((d, i) => { const doc = mk(); doc.addImage(d.url, "JPEG", 0, 0, 1080, 1920); z.file(`${pad2(i + 1)}_${safe(d.fname)}.pdf`, doc.output("arraybuffer")); }); add(`기록앨범_PDF_${st}.zip`, await z.generateAsync({ type: "blob" }), `PDF ${done.length}개 (ZIP)`); }
      }
      if (fm === "viewer") {
        const html = viewerHtml({ club: clubName(), year: S.year, made: today() }, done);
        add(`기록앨범_독립뷰어_${st}.html`, new Blob([html], { type: "text/html" }), `독립뷰어 1개 · ${done.length}쪽 (인터넷 없이 열려요)`);
      }
      setP(100, "완료! 아래에서 내려받으세요.");
    } catch (e) { console.error(e); AL.status = "만들지 못했어요: " + e.message; AL.failed = true; }
    AL.running = false; paintResult();
  }
  const download = (o) => { const a = document.createElement("a"); a.href = URL.createObjectURL(o.blob); a.download = o.name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); };

  /* ---------- 화면 ---------- */
  const mount = () => view;
  const stateOf = (keys, set = AL.sel) => { const n = keys.filter((k) => set.has(k)).length; return n === 0 ? 0 : n === keys.length ? 2 : 1; };
  const cb = (st, onclick) => h("button", { type: "button", class: "alcb s" + st, onclick, "aria-label": "선택" }, st === 2 ? "✓" : st === 1 ? "–" : "");
  const gi = (g) => AL.items.filter((i) => i.group === g);
  const checkRow = (st, title, sub, count, onCheck, onOpen) => h("div", { class: "alrow" }, cb(st, onCheck), h("div", { class: "altx", onclick: onOpen || onCheck }, h("b", {}, title), sub ? h("small", {}, sub) : null), count ? h("span", { class: "alcnt" }, count) : null, onOpen ? h("button", { type: "button", class: "alopen", onclick: onOpen }, "세부항목 ›") : null);
  const itemRow = (it, indent) => h("div", { class: "alrow" + (indent ? " ind" : "") }, cb(AL.sel.has(it.key) ? 2 : 0, () => { AL.sel.has(it.key) ? AL.sel.delete(it.key) : AL.sel.add(it.key); draw(); }), h("div", { class: "altx", onclick: () => { AL.sel.has(it.key) ? AL.sel.delete(it.key) : AL.sel.add(it.key); draw(); } }, h("b", {}, it.title), h("small", {}, it.subtitle)));
  const hint = (t, right, onRight) => h("div", { class: "alhint" }, h("b", {}, t), right ? (onRight ? h("button", { type: "button", class: "alopen", onclick: onRight }, right) : h("span", {}, right)) : null);
  const abtn = (t, onclick, cls = "", dis = false) => h("button", { type: "button", class: "albtn " + cls, onclick, disabled: dis }, t);
  const allBar = (label, st, sub, onclick) => h("div", { class: "alall" }, cb(st, onclick), h("b", {}, label), h("span", {}, sub));

  function quarterPicker() {
    const opts = [[0, "자동"], [1, "1→2분기"], [2, "2→3분기"], [3, "3→4분기"], [4, `4분기→${S.year + 1} 1분기`]];
    return h("div", { class: "alq" }, h("b", {}, "분기에버 분기 선택 (선택한 분기마다 한 장)"), h("div", {}, opts.map(([v, t]) => h("label", { class: "alqo" }, h("input", { type: "checkbox", checked: AL.qpick.has(v), onchange: (e) => { e.target.checked ? AL.qpick.add(v) : AL.qpick.delete(v); if (!AL.qpick.size) AL.qpick.add(0); } }), t))));
  }
  function renderMain() {
    const allKeys = AL.items.map((i) => i.key), left = h("div", { class: "alcol" }), right = h("div", { class: "alcol" });
    const gsel = GROUPS.filter((g) => gi(g).some((i) => AL.sel.has(i.key))).length;
    left.append(allBar("전체 선택", stateOf(allKeys), `${gsel} / ${GROUPS.length} 메뉴 선택`, () => { if (stateOf(allKeys) === 2) AL.sel.clear(); else { allKeys.forEach((k) => AL.sel.add(k)); AL.qpick = new Set([1, 2, 3, 4]); } draw(); }), hint("기록앨범 항목", "세부항목 →"));
    const card = h("div", { class: "alcard alscroll" });
    GROUPS.forEach((g) => {
      const list = gi(g); if (!list.length) return; const keys = list.map((i) => i.key);
      const sub = list.length === 1 ? list[0].subtitle : g === G_LEDGER ? "1년결산 + 월별 요약 + 월별 상세" : g === G_GAME ? "모임기록 · 순위표 · 분기에버" : `${list.length}개 항목`;
      card.append(checkRow(stateOf(keys), g, sub, list.length > 1 ? `${keys.filter((k) => AL.sel.has(k)).length} / ${keys.length}` : null, () => { stateOf(keys) === 2 ? keys.forEach((k) => AL.sel.delete(k)) : keys.forEach((k) => AL.sel.add(k)); draw(); }, list.length > 1 ? () => { AL.group = g; AL.screen = "sub"; draw(); } : null));
    });
    left.append(card);
    right.append(hint("파일 형식"));
    const seg = h("div", { class: "alseg" }, [["jpg", "이미지(JPG)"], ["pdf", "PDF"], ["both", "JPG + PDF"], ["viewer", "단독실행"]].map(([v, t]) => h("button", { type: "button", class: AL.format === v ? "on" : "", onclick: () => { AL.format = v; savePref(); draw(); } }, t)));
    const sw = (t, key) => h("label", { class: "alsw" }, h("span", {}, t), h("input", { type: "checkbox", checked: AL[key], onchange: (e) => { AL[key] = e.target.checked; savePref(); } }));
    right.append(seg, h("div", { class: "alcard" }, sw("이름 가운데 글자 가리기", "maskName"), sw("연락처 가운데 4자리 가리기", "maskPhone"), sw("선택 항목 PDF 한 파일로 합치기", "mergePdf")));
    right.append(h("div", { class: "alnote" }, "※ 파일은 이 컴퓨터로 내려받아요. 전체 선택 시 JPG는 ‘전체_날짜’ 폴더가 든 ZIP으로, PDF는 대분류(회원현황/기록현황/장부현황/회비현황/락카현황) 순서로 묶은 한 파일로 만들고 색인쪽과 PDF 책갈피(대분류 › 중분류 › 소분류)를 넣어요."));
    if (AL.format === "viewer") right.append(h("div", { class: "alnote" }, "※ 단독실행: 선택한 항목을 인터넷·앱 없이 열리는 독립뷰어 HTML 파일 1개로 만들어요. 표지(클럽명·연도·총 쪽수), 분류별 색인(누르면 해당 쪽 이동), 쪽 목록, 전체화면 보기(이전/다음·확대)가 들어 있어요."));
    return [h("div", { class: "alcols" }, left, right), h("div", { class: "albar" }, abtn(AL.sel.size ? `선택 항목 ${AL.sel.size}개 만들기` : "항목을 선택하세요", () => { AL.confirm = new Set(AL.sel); AL.screen = "confirm"; draw(); }, "pri", !AL.sel.size))];
  }
  function renderSub() {
    const g = AL.group, list = gi(g), keys = list.map((i) => i.key), left = h("div", { class: "alcol" }), right = h("div", { class: "alcol" });
    left.append(allBar("전체 선택", stateOf(keys), `${keys.filter((k) => AL.sel.has(k)).length} / ${keys.length} 선택`, () => { stateOf(keys) === 2 ? keys.forEach((k) => AL.sel.delete(k)) : keys.forEach((k) => AL.sel.add(k)); draw(); }));
    if (g === G_LEDGER) {
      const months = list.filter((i) => i.key.startsWith("LEDGER_M_"));
      left.append(h("div", { class: "alcard" }, list.filter((i) => !i.key.startsWith("LEDGER_M_")).map((i) => itemRow(i))));
      right.append(hint(`월별 상세 (${S.year}년)`, "최근 3개월 선택", () => { months.forEach((i) => AL.sel.delete(i.key)); months.slice(-3).forEach((i) => AL.sel.add(i.key)); draw(); }), h("div", { class: "alcard alscroll" }, months.map((i) => itemRow(i))));
    } else if (g === G_GAME) {
      const meets = list.filter((i) => i.key.startsWith("GAME_MEET_")), mk = meets.map((i) => i.key);
      left.append(h("div", { class: "alcard" }, list.filter((i) => !i.key.startsWith("GAME_MEET_")).map((i) => itemRow(i))), quarterPicker());
      right.append(hint("모임기록 (일자별)", `${mk.filter((k) => AL.sel.has(k)).length} / ${mk.length}`),
        h("div", { class: "alcard alscroll" }, meets.length ? [checkRow(stateOf(mk), "모임기록 전체", `${meets.length}회`, null, () => { stateOf(mk) === 2 ? mk.forEach((k) => AL.sel.delete(k)) : mk.forEach((k) => AL.sel.add(k)); draw(); }), ...meets.map((i) => itemRow(i, true))] : h("div", { class: "alnote" }, "올해 모임기록이 없습니다.")));
    } else left.append(h("div", { class: "alcard" }, list.map((i) => itemRow(i))));
    return [h("div", { class: "alcols" }, left, right), h("div", { class: "albar" }, abtn("해제", () => { keys.forEach((k) => AL.sel.delete(k)); draw(); }), abtn(`${keys.filter((k) => AL.sel.has(k)).length}개 선택 완료`, () => { AL.screen = "main"; draw(); }, "pri"))];
  }
  function renderConfirm() {
    const list = orderedSel(AL.sel), n = AL.confirm.size, isAll = n === AL.items.length, f = AL.format;
    const chips = []; if (f === "viewer") chips.push(`독립뷰어 HTML 1개(${n}항목)`); if (f === "jpg" || f === "both") chips.push(`JPG ${n}장`); if (f === "pdf" || f === "both") chips.push(isAll || (AL.mergePdf && n > 1) ? "PDF 1개(책갈피 색인)" : `PDF ${n}개`);
    if (AL.maskPhone) chips.push("연락처 가림"); if (AL.maskName) chips.push("이름 가림");
    const left = h("div", { class: "alcol" }, hint("만들 항목 (체크 해제 시 제외)", `${n}개`), h("div", { class: "alcard alscroll" }, list.map((it) => checkRow(AL.confirm.has(it.key) ? 2 : 0, `${pathOf(it)[1]} ${pathOf(it)[2] || ""}`.trim() === it.title ? it.title : `${it.group} · ${it.title}`, null, null, () => { AL.confirm.has(it.key) ? AL.confirm.delete(it.key) : AL.confirm.add(it.key); draw(); }))));
    const right = h("div", { class: "alcol" }, h("div", { class: "alcard" }, h("div", { class: "alchips" }, chips.join("   ·   ")), h("div", { class: "alnote" }, "저장: 내려받기 폴더(브라우저 설정)" + (isAll && (f === "jpg" || f === "both") ? "\n전체 선택: JPG는 ZIP 안 ‘전체_날짜’ 폴더에 담겨요." : ""))));
    return [h("div", { class: "alcols" }, left, right), h("div", { class: "albar" }, abtn("취소", () => { AL.screen = "main"; draw(); }), abtn("실행", run, "pri", n === 0))];
  }
  let resultBox = null;
  function paintResult() {
    if (!resultBox || !resultBox.isConnected) return;
    resultBox.textContent = "";
    resultBox.append(h("div", { class: "alstatus" + (AL.failed ? " bad" : "") }, AL.status), h("div", { class: "alprog" }, h("i", { style: `width:${AL.progress}%` })));
    if (!AL.running) {
      AL.outputs.forEach((o) => resultBox.append(h("div", { class: "alout" }, h("div", {}, h("b", {}, o.name), h("small", {}, o.note + " · " + (o.blob.size / 1048576).toFixed(1) + "MB")), abtn("내려받기", () => download(o), "pri"))));
      resultBox.append(h("div", { class: "albar" }, abtn("처음으로", () => { AL.screen = "main"; AL.failed = false; draw(); })));
    }
  }
  function renderResult() { resultBox = h("div", { class: "alresult" }); setTimeout(paintResult, 0); return [resultBox]; }

  function draw() {
    AL.items = buildItems();
    const valid = new Set(AL.items.map((i) => i.key)); [...AL.sel].forEach((k) => { if (!valid.has(k)) AL.sel.delete(k); });
    // 같은 화면에서 항목을 선택·해제할 때 목록이 맨 위로 올라가지 않도록 스크롤 위치를 기억했다가 되돌린다
    const scrollSel = ".alscroll,.alcol,.alcard", sameScr = AL._scr === AL.screen + "|" + (AL.group || "");
    const keep = sameScr ? [...view.querySelectorAll(scrollSel)].map((e) => e.scrollTop) : null, keepY = sameScr ? window.scrollY : 0, phone = document.body.classList.contains("phmode");
    AL._scr = AL.screen + "|" + (AL.group || "");
    const parts = AL.screen === "sub" ? renderSub() : AL.screen === "confirm" ? renderConfirm() : AL.screen === "result" ? renderResult() : renderMain();
    const title = AL.screen === "sub" ? `${AL.group} 세부항목` : AL.screen === "confirm" ? "기록앨범 만들기 확인" : "기록앨범 만들기";
    const root = h("div", { class: "tbroot alroot" }, h("div", { class: "altitle" }, title, h("small", {}, `${clubName()} · ${S.year}년 자료`)), ...parts);
    view.textContent = ""; view.append(root);
    const nav = $("bnav"), navTop = nav && !nav.hidden && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : window.innerHeight;
    if (phone) { root.style.height = ""; document.documentElement.classList.remove("fitpage"); window.scrollTo(0, keepY); } // 세로(폰): 한 화면 고정 없이 길면 화면 전체가 위·아래로 스크롤
    else { window.scrollTo(0, 0); root.style.height = Math.max(420, navTop - root.getBoundingClientRect().top - 6) + "px"; document.documentElement.classList.add("fitpage"); }
    if (window.tbSqueeze) window.tbSqueeze(); // 목록이 잘리지 않게 줄 간격 자동 조절
    if (keep) { const els = [...root.querySelectorAll(scrollSel)]; if (els.length === keep.length) els.forEach((e, i) => { if (keep[i] > 0) e.scrollTop = keep[i]; }); }
  }
  /* ---------- 홈 화면 '기록앨범' 박스 (albumbox.html 안에서만 사용) ----------
     홈이 같은 출처 iframe 으로 이 화면을 끼워 넣고 AlbumBox.groups() / show() 를 불러요.
     분류(기록현황·장부현황·회비현황·락카현황·회원현황)별로 항목을 묶어 드롭메뉴에 보여 줘요.
       meet 최근 모임 / quarter 분기에버(분기가 끝나 책정에버가 결정된 뒤에만) / annual 1년결산 / summary 월별 요약 / month 이번 달 월별 장부 상세
       fee 회비 납부 현황 / locker 락카 현황 / member 회원 목록(연락처 가운데 4자리 가림) */
  const boxPick = (kind) => {
    const curMonth = () => { const months = [...new Set(ledgerAll().map((l) => mn(l.date)))].sort((a, b) => a - b); return months.length ? (months.includes(mn(today())) ? mn(today()) : months[months.length - 1]) : 0; };
    if (kind === "meet") { const ms = meetings(); const mt = ms[ms.length - 1]; return mt ? { label: `최근 모임 (${mn(mt.date)}/${dn(mt.date)} ${mt.type})`, make: () => pageMeeting(mt) } : null; }
    if (kind === "quarter") {
      const y = Y(), q = Math.floor((mn(today()) - 1) / 3) + 1;
      if (!activeMembers().some((m) => S.sq[`${m.memberId}|${y}|${q}`] != null)) return null; // 이번 분기 책정에버가 아직 결정되지 않았으면 표시하지 않음
      const [sy, sq, ty, tq] = spanOf(0);
      return { label: `분기에버 (${sy !== ty ? pad2(sy % 100) + "년 " : ""}${sq}→${tq}분기)`, make: () => pageQuarter(0) };
    }
    if (kind === "annual") return ledgerAll().length ? { label: `1년결산 (${S.year}년)`, make: () => pageLedgerAnnual() } : null;
    if (kind === "summary") { const m = curMonth(); return m ? { label: `월별 요약 (${m}월 기준)`, make: () => pageLedgerSummary() } : null; }
    if (kind === "month") { const m = curMonth(); return m ? { label: `${m}월 장부 상세`, make: () => pageLedgerMonth(m) } : null; }
    if (kind === "fee") return { label: "회비 납부 현황", make: () => pageFee() };
    if (kind === "locker") return lockersShown().length ? { label: "락카 현황", make: () => pageLocker() } : null;
    if (kind === "member") return { label: "회원목록", make: () => { const old = AL.maskPhone; AL.maskPhone = true; try { return pageMembers(false); } finally { AL.maskPhone = old; } } };
    return null;
  };
  const BOX_GROUPS = [["기록현황", ["meet", "quarter"]], ["장부현황", ["annual", "summary", "month"]], ["회비현황", ["fee"]], ["락카현황", ["locker"]], ["회원현황", ["member"]]];
  window.AlbumBox = {
    // [[분류, [[kind, 라벨], …]], …] — 표시할 수 있는 항목만
    async groups() { await window.__albumData; return BOX_GROUPS.map(([g, ks]) => [g, ks.map((k) => { const p = boxPick(k); return p ? [k, p.label] : null; }).filter(Boolean)]).filter(([, l]) => l.length); },
    // W·H: 쓸 수 있는 폭·높이(px). 1080×1920 한 장을 폭과 높이에 모두 맞춰 스크롤 없이 한 화면에 보이게 줄여서 그려요. 반환: {width, height}
    async show(kind, W, H, pin) {
      await window.__albumData;
      const p = boxPick(kind); view.textContent = "";
      if (!p) { view.append(h("p", { class: "abmsg" }, "표시할 기록이 없어요.")); return { width: W, height: 80 }; }
      const pg = p.make(), root = pg.root || pg, box = h("div", { id: "abox" });
      view.append(box); box.append(root); fit(root);
      // 내용 아래 빈 공간은 잘라서(꼬리말은 바로 아래에 붙임) 같은 화면에서 더 크게 보이게 해요
      const hd = root.querySelector(".alp-head"), bd = root.querySelector(".alp-body"), ft = root.querySelector(".alp-foot");
      const need = Math.min(1920, Math.max(900, hd.offsetHeight + bd.scrollHeight + ft.offsetHeight + 56));
      root.style.height = need + "px";
      if (pin) { // 돋보기(확대) 모드: 폭을 꽉 채우고, 위·아래 스크롤은 이 화면 안에서. 제목부터 첫 표의 필드명 줄까지는 위에 고정(스크롤해도 안 움직임)
        const top0 = root.getBoundingClientRect().top, th = root.querySelector("thead");
        let fixPx = th ? th.getBoundingClientRect().bottom - top0 + 4 : hd.getBoundingClientRect().bottom - top0 + 4;
        if (fixPx > need * 0.5 || (H > 0 && fixPx * (W / 1080) > H * 0.5)) fixPx = hd.getBoundingClientRect().bottom - top0 + 4; // 고정 영역이 화면의 절반을 넘으면(그래프가 있는 월별 요약 등) 제목부만 고정
        const apin = h("div", { id: "apin" }), ain = h("div", { id: "ain" }), clone = root.cloneNode(true);
        box.textContent = ""; box.classList.add("pin"); box.append(apin, ain); ain.append(root); apin.append(clone);
        const apply = (kk) => {
          const sw = Math.floor(1080 * kk), sh = Math.floor(need * kk), fp = Math.floor(fixPx * kk);
          root.style.transform = clone.style.transform = `scale(${kk})`;
          apin.style.width = sw + "px"; apin.style.height = fp + "px"; ain.style.width = sw + "px"; ain.style.height = sh + "px"; ain.style.marginTop = -fp + "px";
          box.style.width = W + "px"; box.style.height = Math.min(H > 0 ? H : sh, sh) + "px";
          return sh;
        };
        let kk = Math.max(0.1, W / 1080); apply(kk);
        const sb = box.offsetWidth - box.clientWidth; // 스크롤바가 생기면 그 폭만큼 줄여서 다시
        if (sb > 0) { kk = Math.max(0.1, (W - sb) / 1080); apply(kk); }
        return { width: W, height: parseInt(box.style.height, 10) };
      }
      const k = Math.max(0.1, Math.min(W / 1080, H > 0 ? H / need : 1));
      root.style.transform = `scale(${k})`;
      const wd = Math.floor(1080 * k), hgt = Math.floor(need * k); box.style.width = wd + "px"; box.style.height = hgt + "px";
      return { width: wd, height: hgt };
    },
  };
  window.ClubAlbum = { render: draw };
  TABS.album = { render: draw };
  TITLES.album = "기록앨범";
})();
