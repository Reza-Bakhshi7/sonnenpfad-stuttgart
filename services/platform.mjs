// Platform services of the Sonnenpfad Worker: privacy-friendly usage counts, the protected admin API
// and runtime switches (maintenance page, browser-routing emergency switch).
// Without a D1 binding (env.DB) every part stays off and the site behaves exactly as before.
// Privacy: no visitor cookies (admin login only), nothing stored on the visitor's device, no IP addresses or coordinates stored.
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

// ---- Admin access: password + TOTP (authenticator app), signed session cookie (fail closed) ----------
// Worker secrets, never in the repository: ADMIN_PASSWORD_HASH ("pbkdf2$<iterations>$<salt>$<hash>"),
// ADMIN_TOTP_SECRET (base32) and ADMIN_SESSION_KEY (random). Set with scripts/admin-setup.mjs.
const SESSION_IDLE_MS = 30 * 60000, SESSION_MAX_MS = 8 * 3600000, LOCK_WINDOW_MS = 15 * 60000, MAX_FAILURES = 5;
const COOKIE = '__Host-sp_admin';
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = text => unb64(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
function equalBytes(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0; }
export function adminConfigured(env) { return Boolean(env.DB && env.ADMIN_PASSWORD_HASH && env.ADMIN_TOTP_SECRET && env.ADMIN_SESSION_KEY); }

// shortcut: 20,000 PBKDF2 iterations keep a login inside the Workers free CPU budget; the TOTP code and the
// login lock are the main defence. Raise the count if the Worker moves to a paid plan.
export async function hashPassword(password, iterations = 20000, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, key, 256);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(bits)}`;
}
export async function checkPassword(password, stored) {
  const [kind, iterations, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  const computed = (await hashPassword(String(password || ''), Number(iterations), unb64(salt))).split('$')[3];
  return equalBytes(unb64(computed), unb64(hash));
}
function base32(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const char of clean) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
// RFC 6238: 30-second steps, 6 digits, HMAC-SHA1 (what every authenticator app uses).
export async function totpCode(secret, step) {
  const key = await crypto.subtle.importKey('raw', base32(secret), {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
  const counter = new Uint8Array(8); let rest = step;
  for (let i = 7; i >= 0; i--) { counter[i] = rest & 255; rest = Math.floor(rest / 256); }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter)), offset = mac[19] & 15;
  const number = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(number % 1000000).padStart(6, '0');
}
// Accepts the current and the neighbouring 30-s step; returns the matching step (to forbid reuse) or null.
export async function checkTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1]) if (await totpCode(secret, candidate) === code) return candidate;
  return null;
}
async function sign(env, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_SESSION_KEY), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}
async function sessionCookie(env, session) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(session)));
  return `${COOKIE}=${payload}.${await sign(env, payload)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.round(SESSION_MAX_MS / 1000)}`;
}
// Valid session: correct signature, not idle > 30 min, not older than 8 h, still listed in D1 (logout revokes).
export async function verifySession(request, env, now = Date.now()) {
  if (!adminConfigured(env)) return {ok: false, reason: 'not-configured'};
  const raw = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  if (!raw) return {ok: false, reason: 'no-session'};
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || !equalBytes(new TextEncoder().encode(await sign(env, payload)), new TextEncoder().encode(signature))) return {ok: false, reason: 'signature'};
  let session; try { session = JSON.parse(new TextDecoder().decode(unb64url(payload))); } catch { return {ok: false, reason: 'malformed'}; }
  if (!(now - session.created < SESSION_MAX_MS)) return {ok: false, reason: 'expired'};
  const row = await env.DB.prepare('SELECT last FROM admin_sessions WHERE id = ?').bind(session.id).first();
  if (!row) return {ok: false, reason: 'revoked'};
  if (now - row.last > SESSION_IDLE_MS) { await env.DB.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(session.id).run(); return {ok: false, reason: 'idle'}; }
  await env.DB.prepare('UPDATE admin_sessions SET last = ? WHERE id = ?').bind(now, session.id).run();
  return {ok: true, session};
}
const sameOrigin = request => { const origin = request.headers.get('Origin'); return !origin || origin === new URL(request.url).origin; };
async function ipHash(request) { return (await sha256('security|' + berlinDay() + '|' + (request.headers.get('CF-Connecting-IP') || ''))).slice(0, 16); }
export async function handleLogin(request, env, now = Date.now()) {
  if (!adminConfigured(env)) return json({error: 'not-configured'}, 503);
  if (request.method !== 'POST' || request.headers.get('X-Sonnenpfad-Admin') !== '1' || !sameOrigin(request) || !String(request.headers.get('Content-Type')).startsWith('application/json')) return json({error: 'bad-request'}, 400);
  const who = await ipHash(request), since = now - LOCK_WINDOW_MS;
  // Brute-force protection: 5 failures per address or 20 overall within 15 minutes lock the login.
  const failures = await env.DB.prepare("SELECT SUM(CASE WHEN detail = ? THEN 1 ELSE 0 END) AS mine, COUNT(*) AS total FROM security WHERE kind = 'login-failed' AND ts > ?").bind(who, since).first();
  if ((failures?.mine || 0) >= MAX_FAILURES || (failures?.total || 0) >= 4 * MAX_FAILURES) return json({error: 'locked', retryAfterMinutes: 15}, 429);
  let body; try { body = JSON.parse((await request.text()).slice(0, 1024)); } catch { return json({error: 'bad-json'}, 400); }
  const passwordOk = await checkPassword(body.password, env.ADMIN_PASSWORD_HASH), step = await checkTotp(env.ADMIN_TOTP_SECRET, String(body.code || ''), now);
  const lastStep = Number(await env.DB.prepare("SELECT value FROM settings WHERE key = 'totpLastStep'").first('value') || 0);
  if (!passwordOk || step === null || step <= lastStep) {
    await env.DB.prepare('INSERT INTO security(ts, kind, detail) VALUES (?, ?, ?)').bind(now, 'login-failed', who).run();
    return json({error: 'invalid'}, 401);
  }
  const session = {id: crypto.randomUUID(), created: now};
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings(key, value) VALUES ('totpLastStep', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(step)),
    env.DB.prepare('INSERT INTO admin_sessions(id, created, last) VALUES (?, ?, ?)').bind(session.id, now, now),
    env.DB.prepare('DELETE FROM admin_sessions WHERE last < ?').bind(now - SESSION_IDLE_MS),
    env.DB.prepare('INSERT INTO security(ts, kind, detail) VALUES (?, ?, ?)').bind(now, 'login-ok', who),
  ]);
  return json({ok: true}, 200, {'Set-Cookie': await sessionCookie(env, session)});
}
async function handleLogout(request, env) {
  if (request.method !== 'POST' || request.headers.get('X-Sonnenpfad-Admin') !== '1' || !sameOrigin(request)) return json({error: 'bad-request'}, 400);
  const check = await verifySession(request, env);
  if (check.ok) await env.DB.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(check.session.id).run();
  return json({ok: true}, 200, {'Set-Cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`});
}
async function logSecurity(env, request, kind) {
  if (!env.DB) return;
  try {
    const ip = request.headers.get('CF-Connecting-IP') || '', hash = (await sha256('security|' + berlinDay() + '|' + ip)).slice(0, 16);
    await env.DB.prepare('INSERT INTO security(ts, kind, detail) VALUES (?, ?, ?)').bind(Date.now(), kind, `${new URL(request.url).pathname} ${hash}`).run();
  } catch {}
}
const ADMIN_HEADERS = {'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store'};
function denied(reason, path) {
  if (reason === 'not-configured') return new Response('The admin area is not configured yet.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8', ...ADMIN_HEADERS}});
  if (path.startsWith('/api/')) return json({error: 'login-required'}, 401, ADMIN_HEADERS);
  return new Response(null, {status: 303, headers: {Location: '/admin/login', ...ADMIN_HEADERS}});
}

async function adminSummary(env, url) {
  if (!env.DB) return json({configured: false});
  const days = Math.min(760, Math.max(1, Number(url.searchParams.get('days')) || 30)), since = berlinDay(Date.now() - (days - 1) * DAY_MS), today = berlinDay();
  const {results} = await env.DB.prepare('SELECT day, metric, dim, n FROM counts WHERE day >= ? ORDER BY day').bind(since).all();
  const live = await env.DB.prepare('SELECT COUNT(*) AS visitors, SUM(sessions) AS sessions, SUM(duration) AS duration, SUM(CASE WHEN last > ? THEN 1 ELSE 0 END) AS active FROM visitors WHERE day = ?').bind(Date.now() - 5 * 60000, today).first();
  const security = (await env.DB.prepare('SELECT ts, kind, detail FROM security ORDER BY ts DESC LIMIT 50').all()).results;
  return json({configured: true, days, since, today, rows: results, live, security, settings: await readSettings(env)});
}
// The server reports itself every 5 minutes: Workers cannot fetch a bare IP address (Cloudflare error 1003).
const OPS_MAX_BYTES = 65536, OPS_STALE_MS = 15 * 60000;
async function handleOpsReport(request, env) {
  if (request.method !== 'POST') return new Response(null, {status: 405, headers: {Allow: 'POST'}});
  if (!env.DB || !env.OPS_TOKEN) return new Response(null, {status: 503});
  const encode = text => new TextEncoder().encode(text);
  if (!equalBytes(encode(request.headers.get('X-Ops-Token') || ''), encode(env.OPS_TOKEN))) return new Response(null, {status: 404});
  const text = await request.text();
  if (text.length > OPS_MAX_BYTES) return new Response(null, {status: 413});
  let metrics; try { metrics = JSON.parse(text); } catch { return new Response(null, {status: 400}); }
  if (!Array.isArray(metrics?.load) || ['mem', 'disk', 'net', 'db', 'api'].some(key => !metrics[key] || typeof metrics[key] !== 'object')) return new Response(null, {status: 400});
  await env.DB.prepare("INSERT INTO settings(key, value) VALUES ('opsReport', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({at: Date.now(), metrics})).run();
  return new Response(null, {status: 204});
}
async function adminServer(env) {
  if (!env.DB || !env.OPS_TOKEN) return json({configured: false});
  const stored = await env.DB.prepare("SELECT value FROM settings WHERE key = 'opsReport'").first('value');
  if (!stored) return json({configured: true, reachable: false, at: null});
  const {at, metrics} = JSON.parse(stored);
  return json({configured: true, reachable: Date.now() - at <= OPS_STALE_MS, at, metrics});
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
  if (path === '/api/ops') return handleOpsReport(request, env);
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/')) {
    // The login page and its files are public; everything else needs a valid session.
    if (['/admin/login', '/admin/login.html', '/admin/login.js', '/admin/admin.css'].includes(path)) {
      if (!adminConfigured(env)) return denied('not-configured', path);
      const page = await env.ASSETS.fetch(request), response = new Response(page.body, page);
      for (const [key, value] of Object.entries(ADMIN_HEADERS)) response.headers.set(key, value);
      return response;
    }
    if (path === '/api/admin/login') return handleLogin(request, env);
    if (path === '/api/admin/logout') return handleLogout(request, env);
    const access = await verifySession(request, env);
    if (!access.ok) { if (!['not-configured', 'no-session'].includes(access.reason)) await logSecurity(env, request, 'admin-denied:' + access.reason); return denied(access.reason, path); }
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
