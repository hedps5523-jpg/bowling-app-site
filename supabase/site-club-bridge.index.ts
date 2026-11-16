import { createClient } from "npm:@supabase/supabase-js@2";

// 홈페이지(bowlapp) 관리자·운영진 → 볼링클럽 서버 연결 (v2)
// - 신원: 홈페이지 기기 인증 토큰을 홈페이지 서버(site-whoami)에서 확인 (관리자·운영진만 접근)
// - 권한: 본인이 직접 클럽 아이디/비밀번호로 연결한 "클럽 계정"의 기존 권한(RLS 규칙)을 그대로 적용
// - 읽기: 클럽 자료 / 쓰기: PC와 같은 bowlingclub_atomic_upload (연결 계정으로 실행)
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SITE_FN = "https://dzwsiragcbunekpdtjeo.supabase.co/functions/v1/site-whoami";
const SITE_KEY = "sb_publishable_elQjeIp9DcG4_D9TrCR3hQ_-n1_tMJr";
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_nV6zhjRw7_YEn3ddsfXfow_55v3NP_s";
const MAX_FAILS = 5, LOCK_MIN = 15;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const pub = createClient(Deno.env.get("SUPABASE_URL")!, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const TABLES: [string, string][] = [
  ["members", "member_id"], ["games", "record_id"], ["ledger_entries", "ledger_id"], ["fee_payments", "payment_id"],
  ["lockers", "locker_id"], ["quarter_base_averages", "member_id"], ["app_settings", "setting_key"],
];

async function who(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  try {
    const r = await fetch(SITE_FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: SITE_KEY }, body: JSON.stringify({ token }) });
    if (!r.ok) return { status: r.status };
    const d = await r.json();
    return d && d.ok ? d : null;
  } catch { return null; }
}
async function readAll(table: string, order: string) {
  const out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").order(order).range(from, from + 999);
    if (error) throw new Error(table + ": " + error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const audit = (email: string, uid: string | null, action: string, detail = "") =>
  db.from("site_club_audit").insert({ site_email: email, club_user_id: uid, action, detail }).then(() => {}, () => {});

type Prof = { user_id: string; login_id: string; requested_member_name: string | null; role: string; approved: boolean; can_write: boolean };
function perms(p: Prof) {
  const admin = String(p.role ?? "").toLowerCase() === "admin";
  return { isAdmin: admin, canRead: admin || p.approved === true, canWrite: admin || (p.approved === true && p.can_write === true) };
}
async function linkedProfile(email: string): Promise<Prof | null> {
  const { data: l } = await db.from("site_club_links").select("club_user_id").eq("site_email", email).maybeSingle();
  if (!l) return null;
  const { data: p } = await db.from("user_profiles").select("user_id,login_id,requested_member_name,role,approved,can_write").eq("user_id", l.club_user_id).maybeSingle();
  return (p as Prof) ?? null;
}


// ---- 모바일 볼링클럽 PIN 인증 (bowlingclub-pin-auth 와 같은 규칙, 단 계정을 새로 만들지 않고 확인만 함) ----
const enc = new TextEncoder(), ITER = 180_000, PIN_MAX_FAIL = 5, PIN_LOCK_MIN = 10;
const nm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
const kk = (v: unknown) => nm(v).toLowerCase();
const pinOf = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(0, 6);
const b64 = (a: Uint8Array) => { let s = ""; a.forEach((v) => s += String.fromCharCode(v)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hashPin(value: string, salt64: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt64), iterations: ITER }, k, 256));
  return `pbkdf2_sha256$${ITER}$${salt64}$${b64(bits)}`;
}
async function verifyPin(value: string, stored: string) {
  const p = String(stored ?? "").split("$"); if (p.length !== 4 || p[0] !== "pbkdf2_sha256") return false;
  const got = enc.encode(await hashPin(value, p[2])), want = enc.encode(stored); if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got[i] ^ want[i]; return d === 0;
}
const PCOLS = "user_id,login_id,contact_email,contact_phone,requested_member_name,member_id,role,approved,can_write,must_change_password,created_at,approved_at,last_seen_at,club_name,club_key,member_key,pin_hash,pin_failed_attempts,pin_locked_until";
async function clubList() {
  const { data } = await db.from("user_profiles").select("club_name").not("club_name", "is", null).limit(1000);
  const seen = new Set<string>(), out: string[] = [];
  for (const r of data ?? []) { const c = nm((r as { club_name?: string }).club_name), k = kk(c); if (c && !seen.has(k)) { seen.add(k); out.push(c); } }
  return out.sort((a, c) => a.localeCompare(c, "ko"));
}
// 성공: 프로필 / 실패: {err, remaining?}
async function checkPin(clubIn: unknown, memberIn: unknown, pinIn: unknown): Promise<{ p?: Record<string, unknown>; err?: string; remaining?: number }> {
  const member = nm(memberIn), pv = pinOf(pinIn);
  if (!nm(clubIn) || !member || !/^\d{6}$/.test(pv)) return { err: "invalid" };
  const club = (await clubList()).find((c) => kk(c) === kk(clubIn));
  if (!club) return { err: "invalid" };
  let { data: list } = await db.from("user_profiles").select(PCOLS).eq("club_key", kk(club)).eq("member_key", kk(member)).limit(20);
  if (!list || !list.length) ({ data: list } = await db.from("user_profiles").select(PCOLS).ilike("requested_member_name", member).limit(20));
  const cands = (list ?? []).filter((p: Record<string, unknown>) => kk(p.club_name || club) === kk(club) && kk(p.requested_member_name) === kk(member) && p.pin_hash && p.login_id !== "site_bridge");
  if (!cands.length) return { err: "invalid" };
  const valid: Record<string, unknown>[] = [];
  for (const p of cands) {
    const lock = p.pin_locked_until ? new Date(String(p.pin_locked_until)).getTime() : 0; if (lock > Date.now()) continue;
    if (await verifyPin(pv, String(p.pin_hash))) valid.push(p);
  }
  if (valid.length === 1) { await db.from("user_profiles").update({ pin_failed_attempts: 0, pin_locked_until: null }).eq("user_id", valid[0].user_id); return { p: valid[0] }; }
  if (valid.length > 1) return { err: "ambiguous" };
  const t = cands[0], lock = t.pin_locked_until ? new Date(String(t.pin_locked_until)).getTime() : 0;
  if (lock > Date.now()) return { err: "locked" };
  const next = Number(t.pin_failed_attempts ?? 0) + 1;
  if (next >= PIN_MAX_FAIL) { await db.from("user_profiles").update({ pin_failed_attempts: 0, pin_locked_until: new Date(Date.now() + PIN_LOCK_MIN * 60000).toISOString() }).eq("user_id", t.user_id); return { err: "locked" }; }
  await db.from("user_profiles").update({ pin_failed_attempts: next }).eq("user_id", t.user_id);
  return { err: "invalid", remaining: PIN_MAX_FAIL - next };
}
function cleanProfile(p: Record<string, unknown>) { const c = { ...p }; delete c.pin_hash; delete c.pin_failed_attempts; delete c.pin_locked_until; return c; }
async function issueSession(p: Record<string, unknown>) {
  const { data: u } = await db.auth.admin.getUserById(String(p.user_id)); const email = u?.user?.email ?? "";
  if (!email) throw new Error("인증 계정 정보를 확인하지 못했어요.");
  const { data: link } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const token = (link as { properties?: { hashed_token?: string } })?.properties?.hashed_token ?? "";
  const { data: s, error } = await pub.auth.verifyOtp({ type: "magiclink", token_hash: token });
  if (error || !s.session) throw new Error("인증 세션을 발급하지 못했어요.");
  return { access_token: s.session.access_token, refresh_token: s.session.refresh_token, profile: cleanProfile(p) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const act0 = String(b.action ?? "");
  try {
    if (act0 === "list_clubs") return json({ ok: true, clubs: await clubList() });
    if (act0 === "pin_login") {
      const r = await checkPin(b.club_name, b.member_name, b.pin);
      if (!r.p) return json({ error: r.err, remaining: r.remaining }, r.err === "locked" ? 429 : 401);
      return json({ ok: true, ...(await issueSession(r.p)) });
    }
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
  const w = await who(String(b.token ?? ""));
  if (!w || !("ok" in w)) return json({ error: (w as { status?: number })?.status === 403 ? "not_member" : "expired" }, 401);
  const action0b = String(b.action ?? "");
  // 구글(홈페이지) 로그인만으로 조회 전용 열람: 회원 연락처·락카 자료는 내보내지 않음
  if (action0b === "view_whoami") return json({ ok: true, viewer: { name: w.name, role: w.role, email: w.email } });
  if (action0b === "view_snapshot") {
    try {
      const out: Record<string, unknown> = {};
      for (const [t, o] of TABLES) {
        if (t === "lockers") continue;
        let rows = await readAll(t, o);
        if (t === "members") rows = (rows as Record<string, unknown>[]).map((r) => { const c = { ...r }; delete c.phone; return c; });
        out[t] = rows;
      }
      const { data: meta } = await db.from("club_data_meta").select("data_version").eq("id", 1).maybeSingle();
      return json({ dataVersion: meta?.data_version ?? 0, tables: out, viewOnly: true });
    } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
  }
  if (w.role !== "admin" && w.role !== "staff") return json({ error: "forbidden", role: w.role }, 403);
  const email = String(w.email).toLowerCase();
  const site = { name: w.name, role: w.role, email: w.email };
  const action = String(b.action ?? "");
  try {
    const prof = await linkedProfile(email);
    const club = prof ? { loginId: prof.login_id, name: prof.requested_member_name || prof.login_id, role: prof.role, ...perms(prof) } : null;

    if (action === "whoami" || action === "status") {
      if (!club) return json({ linked: false, site });
      if (!club.canRead) return json({ linked: true, club, site, error: "not_approved" }, 200);
      return json({ linked: true, club, site, me: { ...site, loginId: club.loginId, name: club.name, role: club.role, isAdmin: club.isAdmin, canRead: club.canRead, canWrite: club.canWrite, source: "site", siteName: w.name, siteRole: w.role } });
    }

    if (action === "link") {
      const { data: att } = await db.from("site_club_link_attempts").select("fails,locked_until").eq("site_email", email).maybeSingle();
      if (att?.locked_until && new Date(att.locked_until).getTime() > Date.now()) return json({ error: "locked" }, 429);
      const fail = async (detail: string, remaining?: number) => {
        const fails = (att?.fails ?? 0) + 1;
        await db.from("site_club_link_attempts").upsert({ site_email: email, fails: fails >= MAX_FAILS ? 0 : fails, locked_until: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null });
        await audit(email, null, "link_fail", detail);
        return json({ error: "invalid_credentials", remaining }, 401);
      };
      let p: Prof;
      if (b.pin != null) {
        const r = await checkPin(b.club_name, b.member_name, b.pin);
        if (!r.p) { if (r.err === "locked") return json({ error: "pin_locked" }, 429); if (r.err === "ambiguous") return json({ error: "ambiguous" }, 409); return await fail("pin:" + nm(b.member_name), r.remaining); }
        p = r.p as unknown as Prof;
      } else {
        const loginId = String(b.login_id ?? "").trim().toLowerCase(), password = String(b.password ?? "");
        if (!/^[a-z0-9_]{4,20}$/.test(loginId) || !password) return await fail("id:" + loginId);
        const { data: ps } = await db.from("user_profiles").select("user_id,login_id,requested_member_name,role,approved,can_write").ilike("login_id", loginId).limit(2);
        if (!ps || ps.length !== 1) return await fail("id:" + loginId);
        p = ps[0] as Prof;
        const { data: u } = await db.auth.admin.getUserById(p.user_id);
        const authEmail = u?.user?.email?.trim().toLowerCase() ?? "";
        if (!authEmail || p.login_id === "site_bridge") return await fail("id:" + loginId);
        const { data: sg, error: se } = await pub.auth.signInWithPassword({ email: authEmail, password });
        if (se || !sg.session) return await fail("id:" + loginId);
      }
      if (!perms(p).canRead) return json({ error: "not_approved" }, 403);
      const { data: other } = await db.from("site_club_links").select("site_email").eq("club_user_id", p.user_id).maybeSingle();
      if (other && other.site_email !== email) return json({ error: "already_linked" }, 409);
      const { error: le } = await db.from("site_club_links").upsert({ site_email: email, club_user_id: p.user_id, linked_at: new Date().toISOString() });
      if (le) throw new Error(le.message);
      await db.from("site_club_link_attempts").delete().eq("site_email", email);
      await audit(email, p.user_id, "link", String(p.login_id));
      const c = { loginId: p.login_id, name: p.requested_member_name || p.login_id, role: p.role, ...perms(p) };
      return json({ ok: true, linked: true, club: c });
    }

    if (action === "unlink") {
      await db.from("site_club_links").delete().eq("site_email", email);
      await audit(email, prof?.user_id ?? null, "unlink");
      return json({ ok: true });
    }

    if (!prof || !club) return json({ error: "not_linked" }, 403);
    if (action === "snapshot") {
      if (!club.canRead) return json({ error: "not_approved" }, 403);
      const out: Record<string, unknown> = {};
      for (const [t, o] of TABLES) out[t] = await readAll(t, o);
      const { data: meta } = await db.from("club_data_meta").select("data_version").eq("id", 1).maybeSingle();
      return json({ dataVersion: meta?.data_version ?? 0, tables: out });
    }
    if (action === "upload") {
      if (!club.canWrite) return json({ error: "permission denied", code: "42501" }, 403);
      const ops = b.operations;
      if (!Array.isArray(ops) || !ops.length || ops.length > 500) return json({ error: "invalid operations" }, 400);
      const { data, error } = await db.rpc("bowlingclub_site_bridge_upload", {
        p_actor: prof.user_id, p_batch_id: String(b.batch_id ?? ""), p_expected_data_version: b.expected_data_version ?? null, p_operations: ops,
      });
      if (error) return json({ error: error.message, code: error.code }, error.code === "40001" ? 409 : error.code === "42501" ? 403 : 400);
      await db.from("site_club_links").update({ last_used_at: new Date().toISOString() }).eq("site_email", email);
      await audit(email, prof.user_id, "upload", `${ops.length} ops`);
      return json({ ok: true, result: data });
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
  return json({ error: "unknown action" }, 400);
});
