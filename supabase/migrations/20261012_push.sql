-- Aplicado no projeto via Supabase: tabelas das notificações push.
create table if not exists public.push_keys (id int primary key check (id = 1), pub text not null, priv text not null);
alter table public.push_keys enable row level security; -- sem políticas: só a Edge Function (service role) lê
revoke all on public.push_keys from anon, authenticated;
-- push_subs: ver migração "push_subs" (RLS: cada pessoa só mexe nas próprias inscrições)
