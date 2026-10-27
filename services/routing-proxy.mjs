// Fixed upstream only. Route coordinates must never enter a shared cache or logs.
const UPSTREAM='https://138.2.184.1/route';
const MAX_BYTES=8*1024*1024;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const error=(status,detail,extra={})=>new Response(JSON.stringify({detail}),{status,headers:{...headers,...extra}});

export async function handleRouting(request,{fetchImpl=fetch,timeoutMs=12000}={}) {
 if(request.method!=='GET')return error(405,'Method not allowed',{Allow:'GET'});
 const query=new URL(request.url).searchParams;
 const allowed=new Set(['start_lon','start_lat','end_lon','end_lat','profile','max_snap_m','include_segments']);
 for(const key of query.keys())if(!allowed.has(key)||query.getAll(key).length!==1)return error(400,'Invalid routing parameters');
 const upstream=new URL(UPSTREAM);
 for(const key of ['start_lon','start_lat','end_lon','end_lat']){
  const raw=query.get(key),value=Number(raw),longitude=key.endsWith('_lon');
  if(raw===null||raw.trim()===''||!Number.isFinite(value)||value<(longitude?8.9:48.6)||value>(longitude?9.5:49))return error(400,'Coordinates must be in the Stuttgart area');
  upstream.searchParams.set(key,String(value));
 }
 if((query.get('profile')??'shortest')!=='shortest'||(query.get('include_segments')??'true')!=='true')return error(400,'Unsupported routing contract');
 const snap=Number(query.get('max_snap_m')??50);
 if(!Number.isFinite(snap)||snap<=0||snap>50)return error(400,'Invalid snap radius');
 upstream.searchParams.set('profile','shortest');upstream.searchParams.set('max_snap_m',String(snap));upstream.searchParams.set('include_segments','true');
 const controller=new AbortController(),cancel=()=>controller.abort();
 let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 request.signal.addEventListener('abort',cancel,{once:true});
 if(request.signal.aborted)controller.abort();
 try{
  const response=await fetchImpl(upstream,{method:'GET',headers:{Accept:'application/json'},signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.headers.get('Content-Type')?.toLowerCase().includes('application/json'))return error(502,'Routing service unavailable');
  if(Number(response.headers.get('Content-Length'))>MAX_BYTES){await response.body?.cancel();return error(502,'Routing response too large');}
  const reader=response.body?.getReader();if(!reader)return error(502,'Routing service unavailable');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return error(502,'Routing response too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const data=JSON.parse(new TextDecoder().decode(bytes));
  if(!response.ok){
   if(response.status===404)return error(404,typeof data.detail==='string'&&data.detail.includes('within')?'No walkable edge within search radius':'No pedestrian connection between the snapped points');
   if(response.status===429)return error(429,'Routing service busy',{'Retry-After':'5'});
   return error(response.status===503?503:502,'Routing service unavailable');
  }
  if(data?.type!=='FeatureCollection'||data.properties?.profile!=='shortest'||data.properties?.segment_metadata_version!==1||!Array.isArray(data.properties.segments))return error(502,'Invalid routing response');
  return new Response(bytes,{status:200,headers});
 }catch{return error(timedOut?504:502,timedOut?'Routing service timed out':'Routing service unavailable');}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
}
