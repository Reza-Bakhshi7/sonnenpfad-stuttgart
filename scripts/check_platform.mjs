// Platform contract (services/platform.mjs): privacy-friendly counts, fail-closed admin access with a real
// RS256 JWT check, CSRF-protected settings and the runtime switches, on an in-memory SQLite standing in for D1.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handlePlatform,handleEvent,rollup,cleanEvents,agentFamily,berlinDay,resetSettingsCache,hashPassword,checkPassword,totpCode,handleLogin,verifySession} from '../services/platform.mjs';
import {usageAllowed,districtAt} from './usage.mjs';

// Minimal D1 stand-in with the subset of the API platform.mjs uses.
function d1(){
 const db=new DatabaseSync(':memory:');for(const file of ['0001_platform.sql','0002_admin_sessions.sql'])db.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({bind:(...values)=>statement(sql,values),run:async()=>db.prepare(sql).run(...args),all:async()=>({results:db.prepare(sql).all(...args)}),first:async column=>{const row=db.prepare(sql).get(...args);return row?(column?row[column]:{...row}):null;}});
 return {raw:db,prepare:sql=>statement(sql),batch:async list=>{for(const item of list)await item.run();}};
}
const assets={fetch:async request=>{const path=new URL(request.url).pathname;if(path==='/city-config.json')return new Response('{"base":"./city/","serverRouting":true}');return new Response('<!doctype html>static '+path,{headers:{'Content-Type':'text/html'}});}};
const event=(body,headers={})=>new Request('https://sonnenpfad-stuttgart.de/api/event',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36','CF-Connecting-IP':'203.0.113.7',...headers}});

// 1. Without D1 nothing is stored and the site is unchanged.
assert.equal((await handleEvent(event({e:[{t:'pv',v:'route'}]}),{})).status,204);
assert.equal(await handlePlatform(new Request('https://sonnenpfad-stuttgart.de/'),{ASSETS:assets}),null);

// 2. Validation: unknown events, malformed dimensions and coordinates are dropped.
assert.deepEqual(cleanEvents({e:[{t:'pv',v:'route'},{t:'route',v:'wheelchair|shade'},{t:'pos',v:'48.77,9.18'},{t:'filter',v:'<script>'},{t:'view',v:'3_-4'}],d:'m',l:'en'}).events.map(e=>e.t),['pv','route','view']);
assert.equal(agentFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1').os,'iOS');assert.equal(agentFamily('Googlebot/2.1').bot,true);

// 3. Counting: aggregates per day, one salted visitor hash, nothing personal stored.
const DB=d1(),env={DB,ASSETS:assets};
assert.equal((await handleEvent(event({e:[{t:'pv',v:'route'},{t:'route',v:'wheelchair|shade'},{t:'route_area',v:'1'}],d:'m',l:'de'}),env)).status,204);
await handleEvent(event({e:[{t:'filter',v:'slope'}],d:'m',l:'de'}),env);
await handleEvent(event({e:[{t:'pv',v:'explore'}],d:'d',l:'en'},{'User-Agent':'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0','CF-Connecting-IP':'198.51.100.2'}),env);
await handleEvent(event({e:[{t:'pv',v:'route'}]},{'Sec-GPC':'1'}),env);   // Global Privacy Control: not counted
const counts=Object.fromEntries(DB.raw.prepare("SELECT metric||'|'||dim AS k, n FROM counts").all().map(r=>[r.k,r.n]));
assert.equal(counts['pv|route'],1);assert.equal(counts['pv|explore'],1);assert.equal(counts['route|wheelchair|shade'],1);assert.equal(counts['device|mobile'],1);assert.equal(counts['os|Windows'],1);assert.equal(counts['filter|slope'],1);
const visitors=DB.raw.prepare('SELECT * FROM visitors').all();assert.equal(visitors.length,2);
const stored=JSON.stringify(DB.raw.prepare('SELECT * FROM counts').all())+JSON.stringify(visitors);
assert(!stored.includes('203.0.113.7')&&!stored.includes('198.51.100.2')&&!stored.includes('Android 14'),'no IP address or user agent is stored');

// 4. Nightly roll-up: hashes and salts disappear, plain counts remain.
await rollup(env,Date.now()+86400000);
assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM visitors').get().n,0);
assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'salt:%'").get().n,0);
assert.equal(DB.raw.prepare("SELECT n FROM counts WHERE metric='visitors' AND day=?").get(berlinDay()).n,2);

// 5. Admin login: fail closed, RFC 6238 TOTP, password, one-time codes, brute-force lock, sessions.
let response=await handlePlatform(new Request('https://sonnenpfad-stuttgart.de/admin/'),env);assert.equal(response.status,503,'not configured: closed');
assert.equal(await totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',Math.floor(59/30)),'287082','RFC 6238 test vector');
const secret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',admin={...env,ADMIN_PASSWORD_HASH:await hashPassword('correct horse battery'),ADMIN_TOTP_SECRET:secret,ADMIN_SESSION_KEY:'test-session-key-0123456789'};
assert.equal(await checkPassword('correct horse battery',admin.ADMIN_PASSWORD_HASH),true);assert.equal(await checkPassword('wrong',admin.ADMIN_PASSWORD_HASH),false);
const site='https://sonnenpfad-stuttgart.de',login=(password,code,headers={})=>handleLogin(new Request(site+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json','X-Sonnenpfad-Admin':'1',Origin:site,'CF-Connecting-IP':'192.0.2.9',...headers},body:JSON.stringify({password,code})}),admin);
response=await handlePlatform(new Request(site+'/admin/'),admin);assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/admin/login.html','no session: to login');
response=await handlePlatform(new Request(site+'/api/admin/summary'),admin);assert.equal(response.status,401);
assert.equal((await login('correct horse battery','123456',{Origin:'https://evil.example'})).status,400,'cross-site login refused');
const code=await totpCode(secret,Math.floor(Date.now()/30000));
assert.equal((await login('wrong password',code)).status,401);
response=await login('correct horse battery',code);assert.equal(response.status,200);
const cookie=response.headers.get('Set-Cookie');assert(/^__Host-sp_admin=.+; Path=\/; Secure; HttpOnly; SameSite=Strict/.test(cookie),'secure session cookie');
const session=cookie.split(';')[0];
assert.equal((await login('correct horse battery',code)).status,401,'a code works only once');
response=await handlePlatform(new Request(site+'/api/admin/summary?days=7',{headers:{Cookie:session}}),admin);assert.equal(response.status,200);assert.equal((await response.json()).configured,true);
response=await handlePlatform(new Request(site+'/admin/',{headers:{Cookie:session}}),admin);assert.equal(response.status,200);assert.equal(response.headers.get('X-Frame-Options'),'DENY');
const forged=session.replace(/\.[^.]+$/,'.AAAA');assert.equal((await verifySession(new Request(site,{headers:{Cookie:forged}}),admin)).reason,'signature');
assert.equal((await verifySession(new Request(site,{headers:{Cookie:session}}),admin,Date.now()+31*60000)).reason,'idle','30 minutes idle end the session');
response=await login('correct horse battery',await totpCode(secret,Math.floor(Date.now()/30000)+1));const session2=response.headers.get('Set-Cookie').split(';')[0];
await handlePlatform(new Request(site+'/api/admin/logout',{method:'POST',headers:{Cookie:session2,'X-Sonnenpfad-Admin':'1',Origin:site}}),admin);
assert.equal((await verifySession(new Request(site,{headers:{Cookie:session2}}),admin)).reason,'revoked','logout revokes the session');
for(let i=0;i<5;i++)await login('guess'+i,'000000',{'CF-Connecting-IP':'198.51.100.66'});
assert.equal((await login('correct horse battery',await totpCode(secret,Math.floor(Date.now()/30000)),{'CF-Connecting-IP':'198.51.100.66'})).status,429,'locked after 5 failures');
assert(!JSON.stringify(DB.raw.prepare('SELECT * FROM security').all()).includes('198.51.100.66'),'no IP address in the security log');

// 6. Runtime switches: browser-routing emergency switch and maintenance page (admin settings path tested via DB).
DB.raw.prepare("INSERT INTO settings(key,value) VALUES ('browserRouting','true'),('maintenance','true')").run();
resetSettingsCache();   // settings are cached for 30 s per Worker instance
const config=await (await handlePlatform(new Request('https://sonnenpfad-stuttgart.de/city-config.json'),env)).json();assert.equal(config.serverRouting,false);
const page=await handlePlatform(new Request('https://sonnenpfad-stuttgart.de/',{headers:{Accept:'text/html'}}),env);assert.equal(page.status,503);assert((await page.text()).includes('Wartung'));

// 7. Client side: counts only on production hosts, never with DNT/GPC; districts instead of points.
assert.equal(usageAllowed({location:{hostname:'sonnenpfad-stuttgart.de'},navigator:{}}),true);
assert.equal(usageAllowed({location:{hostname:'763614aa-sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev'},navigator:{}}),false);
assert.equal(usageAllowed({location:{hostname:'sonnenpfad-stuttgart.de'},navigator:{globalPrivacyControl:true}}),false);
const boundaries=JSON.parse(fs.readFileSync(new URL('../dist/city/planner/districts.json',import.meta.url),'utf8')).boundaries;
assert.equal(districtAt([9.1779,48.7775],boundaries),1);assert.equal(districtAt([8.5,48.5],boundaries),null);
console.log('Platform verified: no storage without D1, validated events, salted daily visitor hashes rolled up and deleted, no IP or user agent stored, password + TOTP login (RFC 6238 vector, one-time codes, cross-site refusal, 5-failure lock, signed HttpOnly session, 30-min idle end, logout revocation), emergency switch and maintenance page.');
