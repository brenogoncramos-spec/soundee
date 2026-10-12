// Edge Function "notify": envia notificações push (Web Push) do Soundee.
// - { type: 'key' }                         -> devolve a chave pública VAPID (gera uma na primeira vez)
// - { type: 'follow'|'like'|'comment', to } -> valida no banco que a ação aconteceu e avisa a pessoa
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const WINDOW = 120_000;

async function keys() {
  const { data } = await admin.from('push_keys').select('pub,priv').eq('id', 1).maybeSingle();
  if (data) return data as { pub: string; priv: string };
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const j = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array([4, ...fromB64u(j.x!), ...fromB64u(j.y!)]);
  const row = { id: 1, pub: b64u(pub), priv: j.d! };
  await admin.from('push_keys').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  const { data: again } = await admin.from('push_keys').select('pub,priv').eq('id', 1).single();
  return again as { pub: string; priv: string };
}
const doc = async (col: string, id: string) => (await admin.from('docs').select('data').eq('col', col).eq('id', id).maybeSingle()).data?.data ?? null;
const recent = (ts: number) => typeof ts === 'number' && Date.now() - ts < WINDOW && ts - Date.now() < 30_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(token);
    const me = u?.user?.id;
    if (!me) return json({ error: 'não autenticado' }, 401);
    const body = await req.json().catch(() => ({}));
    const k = await keys();
    if (body.type === 'key') return json({ pub: k.pub });

    const to = String(body.to || ''), id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/.test(to) || to === me) return json({ sent: 0 });
    let verb = '';
    if (body.type === 'follow') {
      const f = await doc('follows', me);
      if (!f || !(f.ids || []).includes(to) || !recent(f.at?.[to])) return json({ sent: 0, why: 'não verificado' });
    } else if (body.type === 'like') {
      const l = await doc('likes', me), v = l?.m?.[`${to}|${id}`];
      const ts = typeof v === 'object' && v ? v.ts : v;
      if (!recent(ts)) return json({ sent: 0, why: 'não verificado' });
    } else if (body.type === 'comment') {
      const c = await doc('comments', me), last = (c?.list || []).filter((x: any) => x.rk === `${to}|${id}`).pop();
      if (!last || !recent(last.ts)) return json({ sent: 0, why: 'não verificado' });
    } else return json({ error: 'tipo inválido' }, 400);

    const st = (await doc('settings', to)) || {};
    const flag = body.type === 'follow' ? 'nf' : body.type === 'like' ? 'nl' : 'nc';
    if (st[flag] === 0) return json({ sent: 0, why: 'desativado' });

    const prof = (await doc('profiles', me)) || {};
    const who = `${prof.name || 'Alguém'} (@${prof.handle || '?'})`;
    const cat = body.type === 'follow' ? null : await doc('catalog', id);
    const t = cat?.t ? ` de ${cat.t}` : '';
    const msg = body.type === 'follow'
      ? { title: 'Novo seguidor', body: `${who} começou a seguir você`, url: `/?seg=${me}`, tag: `fol-${me}` }
      : body.type === 'like'
        ? { title: 'Nova reação', body: `${who} reagiu à sua review${t}`, url: '/?notif=1', tag: `lik-${me}-${id}` }
        : { title: 'Novo comentário', body: `${who} comentou na sua review${t}`, url: '/?notif=1', tag: `com-${me}-${id}` };

    webpush.setVapidDetails('https://soundee-seven.vercel.app', k.pub, k.priv);
    const { data: subs } = await admin.from('push_subs').select('endpoint,sub').eq('user_id', to);
    let sent = 0;
    await Promise.all((subs || []).map(async (s: any) => {
      try { await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 86400, urgency: 'normal' }); sent++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_subs').delete().eq('endpoint', s.endpoint); else console.error('push', e?.statusCode, e?.body); }
    }));
    return json({ sent });
  } catch (e) { console.error(e); return json({ error: 'erro interno' }, 500); }
});
