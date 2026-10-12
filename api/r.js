// Página de prévia para links compartilhados (WhatsApp, X etc.): mostra a capa do álbum e a nota
// nas tags Open Graph e leva a pessoa para o app. Não lê banco de dados: tudo vem da própria URL.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => String(s || '').slice(0, n);
module.exports = (req, res) => {
  const q = req.query || {};
  const one = k => clip(Array.isArray(q[k]) ? q[k][0] : q[k], 200);
  const t = one('t') || 'Uma review no Soundee', a = one('a'), u = one('u');
  const n = one('n').replace(/[^0-9,]/g, '').slice(0, 4);
  let img = one('i');
  try { const x = new URL(img); if (x.protocol !== 'https:') img = ''; } catch (e) { img = ''; }
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'soundee-seven.vercel.app');
  const origin = 'https://' + host;
  if (!img) img = origin + '/icon-512.png';
  const title = n ? `${t}: nota ${n}` : t;
  const desc = `${u ? u + ' avaliou' : 'Avaliação de'} ${t}${a ? ' (' + a + ')' : ''}${n ? ' com nota ' + n : ''}. Veja e avalie no Soundee.`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="website"><meta property="og:site_name" content="Soundee">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:alt" content="Capa de ${esc(t)}">
<meta property="og:url" content="${esc(origin + req.url)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=/"></head><body><p><a href="/">Abrir o Soundee</a></p><script>location.replace('/')</script></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=300');
  res.status(200).send(html);
};
