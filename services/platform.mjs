// Platform services of the Sonnenpfad Worker: privacy-friendly usage counts, the protected admin API
// and runtime switches (maintenance page, browser-routing emergency switch).
// Without a D1 binding (env.DB) every part stays off and the site behaves exactly as before.
// Privacy: no cookies, nothing stored on the visitor's device, no IP addresses or coordinates stored.
// A visitor is counted per day by a hash of IP + browser with a random salt that is deleted after the day.

const DAY_MS = 86400000;
const SESSION_GAP_MS = 30 * 60000;
const MAX_EVENTS_PER_VISITOR_DAY = 400;
// Allowed events and the exact shape of their single dimension (anything else is dropped).
export const EVENT_RULES = {
  pv: /^(route|explore)$/,                    // page view, start mode
  mode: /^(route|explore)$/,                  // switch between modes
  route: /^[a-zA-Z]{3,20}\|(balanced|shade|sun)$/, // profile|preference of a calculated route
  route_fail: /^[a-zA-Z]{3,30}$/,             // error code of a failed route
  route_area: /^\d{1,2}$/,                    // district of a route start or destination
  filter: /^[a-zA-Z]{2,20}$/,                 // analysis filter attribute added
  district: /^\d{1,2}$/,                      // district selected in the analysis
  layer: /^[a-zA-Z0-9]{1,20}$/,               // theme or place layer switched on
  view3d: /^(on)$/,
  shade: /^(on)$/,                            // 2D shade layer switched on
  export: /^(csv|geojson)$/,
  nav: /^(start|reroute|arrive)$/,            // live navigation
  view: /^-?\d{1,3}_-?\d{1,3}$/,              // explored 1 km map cell (aggregated heat map)
  lang: /^(de|en)$/,
};

export function berlinDay(time = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(time));
}
function berlinClock(time = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Berlin', hour: '2-digit', weekday: 'short', hourCycle: 'h23'}).formatToParts(new Date(time)).map(p => [p.type, p.value]));
  return {hour: Number(parts.hour), weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday)};
}
// Coarse browser and system family only (no versions, no fingerprint).
export function agentFamily(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const bot = /bot|crawl|spider|slurp|headless|lighthouse|preview/i.test(ua);
  return {browser, os, bot};
}
// Validated batch from the app: [{t, v}] plus device class and language.
export function cleanEvents(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.e)) return null;
  const device = body.d === 'm' ? 'mobile' : body.d === 'd' ? 'desktop' : null, lang = body.l === 'en' ? 'en' : body.l === 'de' ? 'de' : null;
  const events = body.e.slice(0, 20).filter(e => e && typeof e.t === 'string' && typeof e.v === 'string' && EVENT_RULES[e.t]?.test(e.v)).map(e => ({t: e.t, v: e.v}));
  return {device, lang, events};
}
async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra}});

// ---- Settings (cached 30 s per Worker instance) -----------------------------------------------
let settingsCache = null, settingsAt = 0;
export function resetSettingsCache() { settingsCache = null; }
export const DEFAULT_SETTINGS = {maintenance: false, browserRouting: false, retentionDays: 760};
async function readSettings(env) {
  if (!env.DB) return {...DEFAULT_SETTINGS};
  if (settingsCache && Date.now() - settingsAt < 30000) return settingsCache;
  try {
    const {results} = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('maintenance','browserRouting','retentionDays')").all();
    const stored = Object.fromEntries(results.map(r => [r.key, JSON.parse(r.value)]));
    settingsCache = {...DEFAULT_SETTINGS, ...stored};
  } catch { settingsCache = {...DEFAULT_SETTINGS}; }
  settingsAt = Date.now();
  return settingsCache;
}

// ---- Usage counts ------------------------------------------------------------------------------
export async function handleEvent(request, env) {
  if (request.method !== 'POST') return new Response(null, {status: 405, headers: {Allow: 'POST'}});
  if (!env.DB || request.headers.get('Sec-GPC') === '1' || request.headers.get('DNT') === '1') return new Response(null, {status: 204});
  const text = await request.text();
  if (text.length > 4096) return new Response(null, {status: 413});
  let body; try { body = JSON.parse(text); } catch { return new Response(null, {status: 400}); }
  const clean = cleanEvents(body);
  const ua = request.headers.get('User-Agent') || '', family = agentFamily(ua);
  if (!clean || !clean.events.length || family.bot) return new Response(null, {status: 204});
  const now = Date.now(), day = berlinDay(now), {hour, weekday} = berlinClock(now);
  await env.DB.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)').bind('salt:' + day, JSON.stringify(crypto.randomUUID())).run();
  const salt = JSON.parse((await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('salt:' + day).first('value')) || '""');
  const hash = (await sha256(salt + '|' + (request.headers.get('CF-Connecting-IP') || '') + '|' + ua)).slice(0, 24);
  const visitor = await env.DB.prepare('SELECT last, events FROM visitors WHERE day = ? AND hash = ?').bind(day, hash).first();
  if (visitor && visitor.events >= MAX_EVENTS_PER_VISITOR_DAY) return new Response(null, {status: 204});
  const statements = [];
  if (!visitor) statements.push(env.DB.prepare('INSERT INTO visitors(day, hash, first, last, sessions, duration, events) VALUES (?, ?, ?, ?, 1, 0, ?)').bind(day, hash, now, now, clean.events.length));
  else {
    const gap = now - visitor.last, newSession = gap > SESSION_GAP_MS ? 1 : 0;
    statements.push(env.DB.prepare('UPDATE visitors SET last = ?, sessions = sessions + ?, duration = duration + ?, events = events + ? WHERE day = ? AND hash = ?').bind(now, newSession, newSession ? 0 : gap, clean.events.length, day, hash));
  }
  const count = (metric, dim) => statements.push(env.DB.prepare('INSERT INTO counts(day, metric, dim, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, metric, dim) DO UPDATE SET n = n + 1').bind(day, metric, dim));
  for (const event of clean.events) {
    count(event.t, event.v);
    if (event.t === 'pv') {
      if (clean.device) count('device', clean.device);
      if (clean.lang) count('lang', clean.lang);
      count('browser', family.browser);
      count('os', family.os);
      count('hour', String(hour));
      count('weekday', String(weekday));
    }
  }
  await env.DB.batch(statements);
  return new Response(null, {status: 204});
}

// Daily: turn yesterday's visitor hashes into plain numbers, then delete hashes, salts and old counts.
export async function rollup(env, now = Date.now()) {
  if (!env.DB) return;
  const today = berlinDay(now), settings = await readSettings(env);
  const {results} = await env.DB.prepare('SELECT day, COUNT(*) AS visitors, SUM(sessions) AS sessions, SUM(duration) AS duration FROM visitors WHERE day < ? GROUP BY day').bind(today).all();
  const statements = [];
  for (const row of results) {
    for (const [metric, value] of [['visitors', row.visitors], ['sessions', row.sessions], ['duration_s', Math.round((row.duration || 0) / 1000)]])
      statements.push(env.DB.prepare('INSERT INTO counts(day, metric, dim, n) VALUES (?, ?, ?, ?) ON CONFLICT(day, metric, dim) DO UPDATE SET n = excluded.n').bind(row.day, metric, '', value));
  }
  statements.push(env.DB.prepare('DELETE FROM visitors WHERE day < ?').bind(today));
  statements.push(env.DB.prepare("DELETE FROM settings WHERE key LIKE 'salt:%' AND key < ?").bind('salt:' + today));
  statements.push(env.DB.prepare('DELETE FROM counts WHERE day < ?').bind(berlinDay(now - settings.retentionDays * DAY_MS)));
  statements.push(env.DB.prepare('DELETE FROM security WHERE ts < ?').bind(now - 180 * DAY_MS));
  await env.DB.batch(statements);
}

// ---- Admin access: Cloudflare Access JWT, verified here again (fail closed) ----------------------
let certs = null, certsAt = 0;
const b64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), c => c.charCodeAt(0));
export async function verifyAccess(request, env, fetchImpl = fetch, now = Date.now()) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAIL) return {ok: false, reason: 'not-configured'};
  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie;
  if (!token) return {ok: false, reason: 'no-token'};
  const [head, payload, signature] = token.split('.');
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(head))), claims = JSON.parse(new TextDecoder().decode(b64url(payload)));
    if (header.alg !== 'RS256') return {ok: false, reason: 'algorithm'};
    if (!certs || now - certsAt > 3600000) {
      const response = await fetchImpl(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      if (!response.ok) return {ok: false, reason: 'certs'};
      certs = (await response.json()).keys; certsAt = now;
    }
    const jwk = certs.find(key => key.kid === header.kid);
    if (!jwk) return {ok: false, reason: 'key'};
    const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(signature), new TextEncoder().encode(head + '.' + payload));
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!valid) return {ok: false, reason: 'signature'};
    if (!audience.includes(env.ACCESS_AUD)) return {ok: false, reason: 'audience'};
    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return {ok: false, reason: 'issuer'};
    if (!(claims.exp * 1000 > now)) return {ok: false, reason: 'expired'};
    if (String(claims.email || '').toLowerCase() !== String(env.ADMIN_EMAIL).toLowerCase()) return {ok: false, reason: 'email'};
    return {ok: true, email: claims.email};
  } catch { return {ok: false, reason: 'malformed'}; }
}
async function logSecurity(env, request, kind) {
  if (!env.DB) return;
  try {
    const ip = request.headers.get('CF-Connecting-IP') || '', hash = (await sha256('security|' + berlinDay() + '|' + ip)).slice(0, 16);
    await env.DB.prepare('INSERT INTO security(ts, kind, detail) VALUES (?, ?, ?)').bind(Date.now(), kind, `${new URL(request.url).pathname} ${hash}`).run();
  } catch {}
}
const ADMIN_HEADERS = {'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store'};
function denied(reason) {
  const configured = reason !== 'not-configured';
  return new Response(configured ? 'Access denied.' : 'The admin area is not configured yet (Cloudflare Access).', {status: configured ? 403 : 503, headers: {'Content-Type': 'text/plain; charset=utf-8', ...ADMIN_HEADERS}});
}

async function adminSummary(env, url) {
  if (!env.DB) return json({configured: false});
  const days = Math.min(760, Math.max(1, Number(url.searchParams.get('days')) || 30)), since = berlinDay(Date.now() - (days - 1) * DAY_MS), today = berlinDay();
  const {results} = await env.DB.prepare('SELECT day, metric, dim, n FROM counts WHERE day >= ? ORDER BY day').bind(since).all();
  const live = await env.DB.prepare('SELECT COUNT(*) AS visitors, SUM(sessions) AS sessions, SUM(duration) AS duration, SUM(CASE WHEN last > ? THEN 1 ELSE 0 END) AS active FROM visitors WHERE day = ?').bind(Date.now() - 5 * 60000, today).first();
  const security = (await env.DB.prepare('SELECT ts, kind, detail FROM security ORDER BY ts DESC LIMIT 50').all()).results;
  return json({configured: true, days, since, today, rows: results, live, security, settings: await readSettings(env)});
}
async function adminServer(env) {
  if (!env.OPS_URL || !env.OPS_TOKEN) return json({configured: false});
  try {
    const started = Date.now(), response = await fetch(env.OPS_URL, {headers: {'X-Ops-Token': env.OPS_TOKEN, Accept: 'application/json'}, signal: AbortSignal.timeout(8000)});
    if (!response.ok) return json({configured: true, reachable: false, status: response.status});
    return json({configured: true, reachable: true, fetchMs: Date.now() - started, metrics: await response.json()});
  } catch (error) { return json({configured: true, reachable: false, error: String(error?.name || error)}); }
}
async function adminSettings(request, env) {
  if (!env.DB) return json({configured: false}, 503);
  if (request.method === 'GET') return json(await readSettings(env));
  // CSRF: same-origin JSON with a custom header only (a cross-site form can send neither).
  const origin = request.headers.get('Origin');
  if (request.method !== 'POST' || request.headers.get('X-Sonnenpfad-Admin') !== '1' || !String(request.headers.get('Content-Type')).startsWith('application/json') || (origin && origin !== new URL(request.url).origin)) return json({error: 'bad-request'}, 400);
  let body; try { body = await request.json(); } catch { return json({error: 'bad-json'}, 400); }
  const next = {};
  if (typeof body.maintenance === 'boolean') next.maintenance = body.maintenance;
  if (typeof body.browserRouting === 'boolean') next.browserRouting = body.browserRouting;
  if (Number.isInteger(body.retentionDays) && body.retentionDays >= 30 && body.retentionDays <= 760) next.retentionDays = body.retentionDays;
  const statements = Object.entries(next).map(([key, value]) => env.DB.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(value)));
  statements.push(env.DB.prepare('INSERT INTO security(ts, kind, detail) VALUES (?, ?, ?)').bind(Date.now(), 'settings-changed', JSON.stringify(next)));
  await env.DB.batch(statements);
  settingsCache = null;
  return json(await readSettings(env));
}

const MAINTENANCE_PAGE = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sonnenpfad — Wartung</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#edf1f2;color:#143959}main{max-width:520px;padding:24px}h1{font-size:22px}</style><main><h1>Sonnenpfad wird gerade gewartet</h1><p>Bitte versuche es in Kürze erneut.</p><h1 lang="en">Sonnenpfad is under maintenance</h1><p lang="en">Please try again shortly.</p></main></html>`;

// Returns a Response for platform paths, or null to let the static site answer.
export async function handlePlatform(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/event') return handleEvent(request, env);
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/')) {
    const access = await verifyAccess(request, env);
    if (!access.ok) { if (access.reason !== 'not-configured') await logSecurity(env, request, 'admin-denied:' + access.reason); return denied(access.reason); }
    if (path === '/api/admin/summary') return adminSummary(env, url);
    if (path === '/api/admin/server') return adminServer(env);
    if (path === '/api/admin/settings') return adminSettings(request, env);
    if (path.startsWith('/api/admin/')) return json({error: 'not-found'}, 404);
    const page = await env.ASSETS.fetch(new Request(new URL(path === '/admin' ? '/admin/' : path, url), request));
    const response = new Response(page.body, page);
    for (const [key, value] of Object.entries(ADMIN_HEADERS)) response.headers.set(key, value);
    return response;
  }
  const settings = await readSettings(env);
  if (path === '/city-config.json') {
    // Emergency switch from the admin area: routes in the browser without a Git change.
    const asset = await env.ASSETS.fetch(request), config = await asset.json();
    if (settings.browserRouting) config.serverRouting = false;
    return json(config);
  }
  if (settings.maintenance && (request.headers.get('Accept') || '').includes('text/html'))
    return new Response(MAINTENANCE_PAGE, {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '600', 'Cache-Control': 'no-store'}});
  return null;
}
