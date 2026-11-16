-- 홈페이지 계정 ↔ 클럽 계정 연결 (신원=홈페이지, 권한=클럽 계정 기존 권한)
create table if not exists public.site_club_links (site_email text primary key, club_user_id uuid not null unique references auth.users(id) on delete cascade, linked_at timestamptz not null default now(), last_used_at timestamptz);
create table if not exists public.site_club_link_attempts (site_email text primary key, fails int not null default 0, locked_until timestamptz);
create table if not exists public.site_club_audit (id bigint generated always as identity primary key, at timestamptz not null default now(), site_email text, club_user_id uuid, action text not null, detail text);
alter table public.site_club_links enable row level security; alter table public.site_club_link_attempts enable row level security; alter table public.site_club_audit enable row level security;
revoke all on public.site_club_links, public.site_club_link_attempts, public.site_club_audit from anon, authenticated;
-- bowlingclub_site_bridge_upload: 연결된 클럽 계정(관리자 또는 승인+입력권한)만 실행, service_role 전용
