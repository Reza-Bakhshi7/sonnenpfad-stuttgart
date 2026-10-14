import {weatherUrl,normalizeWeather,normalizeMetWeather,usableWeatherCache,WEATHER_CACHE_MS} from '../scripts/weather.mjs';

const inFlight=new Map();
const metURL='https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=48.778&lon=9.180';
const agent='Sonnenpfad-Stuttgart/0.12 (https://sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev; https://github.com/Reza-Bakhshi7)';
const json=(model,cacheState)=>new Response(JSON.stringify(model),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Weather-Cache':cacheState,'X-Content-Type-Options':'nosniff'}});

export async function fetchProviderWeather({fetchImpl=fetch,now=Date.now,hedgeMs=1800}={}) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9500);let hedgeTimer,startSecondary;
 const load=async(url,met=false)=>{const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json',...(met?{'User-Agent':agent}:{})}});if(!response.ok){const error=Error('weather-provider-'+response.status);error.status=response.status;throw error;}const payload=await response.json(),model=met?normalizeMetWeather(payload,now()):normalizeWeather(payload,now());const expires=Date.parse(response.headers?.get('Expires')||'');if(met&&Number.isFinite(expires))model.freshUntil=expires;return model;};
 try{
  const secondary=new Promise(resolve=>{startSecondary=resolve;hedgeTimer=setTimeout(resolve,hedgeMs);}).then(()=>load(metURL,true));
  const primary=load(weatherUrl()).catch(error=>{startSecondary();if([403,429].includes(error.status))throw error;return load(weatherUrl({dwd:true}));});
  return await Promise.any([primary,secondary]);
 }finally{clearTimeout(timer);clearTimeout(hedgeTimer);controller.abort();}
}

export async function handleWeather(request,{cache,fetchImpl=fetch,now=Date.now,waitUntil=()=>{},hedgeMs}={}) {
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
 const url=new URL(request.url),key=new Request(new URL('/api/weather/cache-v2',url.origin));let cached=null;
 try{const hit=await cache?.match(key);if(hit)cached=normalizeWeather(await hit.json());}catch{}
 const current=now(),usable=usableWeatherCache(cached,current),fresh=usable&&current<Math.max(cached.retrievedAt+WEATHER_CACHE_MS,cached.freshUntil||0);
 const refresh=()=>{
  if(inFlight.has(url.origin))return inFlight.get(url.origin);
  const job=fetchProviderWeather({fetchImpl,now,hedgeMs}).then(async model=>{if(cache)try{await cache.put(key,new Response(JSON.stringify(model),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=172800'}}));}catch{}return model;}).finally(()=>inFlight.delete(url.origin));inFlight.set(url.origin,job);return job;
 };
 if(fresh)return json(cached,'hit');
 if(usable){waitUntil(refresh().catch(()=>{}));return json({...cached,stale:true},'stale');}
 try{return json(await refresh(),'miss');}catch{return new Response(JSON.stringify({error:'weather-refresh',retryAfter:60}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'60'}});}
}

export default {async fetch(request,env,ctx){if(new URL(request.url).pathname==='/api/weather')return handleWeather(request,{cache:caches.default,waitUntil:job=>ctx.waitUntil(job)});return env.ASSETS.fetch(request);}};
