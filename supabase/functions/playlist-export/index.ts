// Edge Function "playlist-export": apoio para criar playlists do Soundee no Spotify, Apple Music e Deezer.
// Segredos (Supabase → Edge Functions → Secrets), todos opcionais; o serviço sem segredo aparece como indisponível:
//   SPOTIFY_CLIENT_ID                         (público; app criado em developer.spotify.com)
//   DEEZER_APP_ID                             (público; app criado em developers.deezer.com)
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY   (Apple Developer: chave MusicKit .p8)
// Ações: { action: 'config' } | { action: 'apple-token' } | { action: 'deezer', token, name, tracks: [{t,a}] }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const env = (k: string) => (Deno.env.get(k) || '').trim();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64s = (s: string) => b64u(new TextEncoder().encode(s));

async function appleToken(): Promise<string | null> {
  const team = env('APPLE_TEAM_ID'), kid = env('APPLE_KEY_ID'), pem = env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (!team || !kid || !pem) return null;
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = b64s(JSON.stringify({ alg: 'ES256', kid })), body = b64s(JSON.stringify({ iss: team, iat: now, exp: now + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}

async function deezer(token: string, name: string, tracks: { t: string; a: string }[]) {
  const api = 'https://api.deezer.com';
  const ids: string[] = [], missing: string[] = [];
  for (const x of tracks.slice(0, 60)) {
    const q = encodeURIComponent(`track:"${x.t.replace(/"/g, '')}" artist:"${x.a.replace(/"/g, '')}"`);
    const r = await fetch(`${api}/search/track?q=${q}&limit=1`).then((r) => r.json()).catch(() => null);
    const id = r?.data?.[0]?.id;
    if (id) ids.push(String(id)); else missing.push(`${x.t} — ${x.a}`);
  }
  if (!ids.length) return { error: 'Nenhuma faixa encontrada no Deezer.', missing };
  const c = await fetch(`${api}/user/me/playlists?title=${encodeURIComponent(name.slice(0, 120))}&access_token=${encodeURIComponent(token)}`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
  if (!c?.id) return { error: c?.error?.message === 'Invalid OAuth access token.' ? 'expired' : (c?.error?.message || 'Não foi possível criar a playlist no Deezer.'), missing };
  const a = await fetch(`${api}/playlist/${c.id}/tracks?songs=${ids.join(',')}&access_token=${encodeURIComponent(token)}`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
  if (a !== true && !a?.id && a !== 1) return { error: a?.error?.message || 'A playlist foi criada, mas não foi possível adicionar as faixas.', url: `https://www.deezer.com/playlist/${c.id}`, missing };
  return { url: `https://www.deezer.com/playlist/${c.id}`, added: ids.length, missing };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === 'config') return json({ spotify: env('SPOTIFY_CLIENT_ID') || null, deezer: env('DEEZER_APP_ID') || null, apple: !!(env('APPLE_TEAM_ID') && env('APPLE_KEY_ID') && env('APPLE_PRIVATE_KEY')) });
    if (b.action === 'apple-token') { const t = await appleToken(); return t ? json({ token: t }) : json({ error: 'Apple Music não configurado' }, 501); }
    if (b.action === 'deezer') {
      if (!b.token || !Array.isArray(b.tracks)) return json({ error: 'dados inválidos' }, 400);
      return json(await deezer(String(b.token), String(b.name || 'Playlist Soundee'), b.tracks.map((x: any) => ({ t: String(x.t || ''), a: String(x.a || '') }))));
    }
    return json({ error: 'ação inválida' }, 400);
  } catch (e) { console.error(e); return json({ error: 'erro interno' }, 500); }
});
