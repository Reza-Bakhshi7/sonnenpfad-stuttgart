// Platform contract (services/platform.mjs): privacy-friendly counts, fail-closed admin access with a real
// RS256 JWT check, CSRF-protected settings and the runtime switches, on an in-memory SQLite standing in for D1.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handlePlatform,handleEvent,rollup,verifyAccess,cleanEvents,agentFamily,berlinDay,resetSettingsCache} from '../services/platform.mjs';
import {usageAllowed,districtAt} from './usage.mjs';

// Minimal D1 stand-in with the subset of the API platform.mjs uses.
function d1(){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../migrations/0001_platform.sql',import.meta.url),'utf8'));
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

// 5. Admin access: fail closed, then a real RS256 token from a test key.
let response=await handlePlatform(new Request('https://sonnenpfad-stuttgart.de/admin/'),env);assert.equal(response.status,503,'not configured: closed');
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',keys.publicKey)),kid:'test-key'},fakeCerts=async()=>new Response(JSON.stringify({keys:[jwk]}));
const enc=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
async function token(claims){const head=enc({alg:'RS256',kid:'test-key'}),body=enc(claims),signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(head+'.'+body));return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;}
const access={ACCESS_TEAM_DOMAIN:'sonnenpfad.cloudflareaccess.com',ACCESS_AUD:'aud-123',ADMIN_EMAIL:'owner@example.org'},good={aud:['aud-123'],iss:'https://sonnenpfad.cloudflareaccess.com',email:'owner@example.org',exp:Math.floor(Date.now()/1000)+600};
const check=async claims=>(await verifyAccess(new Request('https://x/admin/',{headers:{'Cf-Access-Jwt-Assertion':await token(claims)}}),access,fakeCerts)).reason||'ok';
assert.equal(await check(good),'ok');
assert.equal(await check({...good,email:'someone@example.org'}),'email');
assert.equal(await check({...good,aud:['other']}),'audience');
assert.equal(await check({...good,exp:Math.floor(Date.now()/1000)-5}),'expired');
assert.equal(await check({...good,iss:'https://evil.example'}),'issuer');
const tampered=(await token(good)).replace(/\.([^.]+)\./,(m,body)=>'.'+enc({...good,email:'owner@example.org',aud:['aud-123'],x:1})+'.');
assert.equal((await verifyAccess(new Request('https://x/',{headers:{'Cf-Access-Jwt-Assertion':tampered}}),access,fakeCerts)).reason,'signature');
response=await handlePlatform(new Request('https://sonnenpfad-stuttgart.de/api/admin/summary'),{...env,...access});assert.equal(response.status,403,'no token: denied');
assert(DB.raw.prepare("SELECT COUNT(*) AS n FROM security WHERE kind LIKE 'admin-denied%'").get().n>=1,'denied access is logged');

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
console.log('Platform verified: no storage without D1, validated events, salted daily visitor hashes rolled up and deleted, no IP or user agent stored, RS256 admin token checked (email, audience, issuer, expiry, signature), denied access logged, emergency switch and maintenance page.');
