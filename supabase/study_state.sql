-- 在 MemFire 或 Supabase 的 SQL Editor 里整段执行一次。
-- 每个登录用户只有一行。anon key 可以放进网页；不要把 service_role 放进仓库。

create table if not exists public.study_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  favorites jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.study_state enable row level security;

drop policy if exists "study_state_select_own" on public.study_state;
drop policy if exists "study_state_insert_own" on public.study_state;
drop policy if exists "study_state_update_own" on public.study_state;

create policy "study_state_select_own"
  on public.study_state
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "study_state_insert_own"
  on public.study_state
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "study_state_update_own"
  on public.study_state
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
