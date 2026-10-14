export const WEATHER_ENDPOINT='https://api.open-meteo.com/v1/forecast';
export const WEATHER_CACHE_KEY='sonnenpfad.weather.stuttgart.v2';
export const WEATHER_CACHE_MS=10*60*1000;
export const WEATHER_STALE_MS=48*60*60*1000;
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;

export function weatherUrl({dwd=false}={}){
 const url=new URL(dwd?'https://api.open-meteo.com/v1/dwd-icon':WEATHER_ENDPOINT);
 url.search=new URLSearchParams({latitude:'48.778',longitude:'9.180',timezone:'Europe/Berlin',past_days:'1',forecast_days:dwd?'5':'7',hourly:['temperature_2m','apparent_temperature','weather_code','cloud_cover','wind_speed_10m','wind_direction_10m','wind_gusts_10m','direct_radiation','shortwave_radiation','terrestrial_radiation'].join(',')});return url;
}

export function normalizeWeather(payload,retrievedAt=Date.now()){
 if(payload?.version===2&&Array.isArray(payload.rows)){
  if(!payload.rows.some(row=>/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(row.time)&&Number.isFinite(row.temperature))||!Number.isFinite(payload.retrievedAt))throw Error('weather-contract');return payload;
 }
 const hourly=payload?.hourly,times=hourly?.time;if(!Array.isArray(times)||!times.length)throw Error('weather-contract');
 const rows=times.map((time,index)=>({time,temperature:number(hourly.temperature_2m?.[index]),apparentTemperature:number(hourly.apparent_temperature?.[index]),weatherCode:number(hourly.weather_code?.[index]),cloudCover:number(hourly.cloud_cover?.[index]),windSpeed:number(hourly.wind_speed_10m?.[index]),windDirection:number(hourly.wind_direction_10m?.[index]),windGust:number(hourly.wind_gusts_10m?.[index]),directRadiation:number(hourly.direct_radiation?.[index]),shortwaveRadiation:number(hourly.shortwave_radiation?.[index]),terrestrialRadiation:number(hourly.terrestrial_radiation?.[index])})).filter(row=>Number.isFinite(row.temperature));
 if(!rows.length)throw Error('weather-contract');return {version:2,retrievedAt,source:'Open-Meteo',licence:'CC BY 4.0',radiationBasis:'model',resolutionMinutes:60,latitude:payload.latitude,longitude:payload.longitude,elevation:payload.elevation,timezone:payload.timezone||'Europe/Berlin',rows};
}

export function normalizeMetWeather(payload,retrievedAt=Date.now()) {
 const times=payload?.properties?.timeseries;if(!Array.isArray(times)||!times.length)throw Error('met-weather-contract');
 const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const code=symbol=>symbol?.includes('thunder')?95:symbol?.includes('snow')||symbol?.includes('sleet')?73:symbol?.includes('rain')?63:symbol?.includes('fog')?45:symbol?.includes('partlycloudy')?2:symbol?.includes('fair')?1:symbol?.includes('clearsky')?0:3;
 const rows=times.map(item=>{const d=item.data?.instant?.details||{},symbol=(item.data?.next_1_hours||item.data?.next_6_hours||item.data?.next_12_hours)?.summary?.symbol_code;
  return {time:formatter.format(new Date(item.time)).replace(' ','T'),temperature:number(d.air_temperature),apparentTemperature:null,weatherCode:code(symbol),cloudCover:number(d.cloud_area_fraction),windSpeed:number(d.wind_speed)===null?null:d.wind_speed*3.6,windDirection:number(d.wind_from_direction),windGust:null,directRadiation:null,shortwaveRadiation:null,terrestrialRadiation:null};
 }).filter(row=>Number.isFinite(row.temperature));
 if(!rows.length)throw Error('met-weather-contract');return {version:2,retrievedAt,source:'MET Norway',licence:'CC BY 4.0',radiationBasis:'cloud-estimate',resolutionMinutes:180,latitude:48.778,longitude:9.18,timezone:'Europe/Berlin',rows};
}

export function usableWeatherCache(model,now=Date.now()) {
 return model?.version===2&&Number.isFinite(model.retrievedAt)&&now-model.retrievedAt>=-300000&&now-model.retrievedAt<WEATHER_STALE_MS&&Array.isArray(model.rows)&&model.rows.some(row=>Number.isFinite(row.temperature));
}

export async function requestWeatherModel({baseURL,fetchImpl=fetch}={}) {
 const urls=[new URL('/api/weather',baseURL),weatherUrl(),weatherUrl({dwd:true})];
 for(const url of urls){try{const response=await fetchImpl(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(url.pathname==='/api/weather'?11000:6500)});if(!response.ok)throw Error('weather-'+response.status);return normalizeWeather(await response.json());}catch(error){if(url===urls.at(-1))throw error;}}
}

export function weatherAt(model,day,minutes){
 if(!model?.rows?.length||!/^\d{4}-\d\d-\d\d$/.test(day))return null;
 const target=Date.parse(`${day}T00:00:00Z`)+Math.max(0,Math.min(1439,Number(minutes)||0))*60000;
 let best=null,distance=Infinity;for(const row of model.rows){const value=Date.parse(row.time.slice(0,16)+':00Z'),next=Math.abs(value-target);if(Number.isFinite(row.temperature)&&next<distance){best=row;distance=next;}}
 if(!best||distance>(model.resolutionMinutes===180?91:31)*60000)return null;
 const direct=number(best.directRadiation),solarWeight=direct!==null?clamp((direct-40)/450):number(best.cloudCover)!==null?clamp((1-clamp(best.cloudCover/100))**1.5):1;
 return {...best,solarWeight,radiationEstimated:direct===null,forecastDistanceMinutes:Math.round(distance/60000)};
}

export function weatherCodeGroup(code){
 if(code===0)return 'clear';if([1,2].includes(code))return 'partlyCloudy';if(code===3)return 'overcast';if([45,48].includes(code))return 'fog';if([51,53,55,56,57].includes(code))return 'drizzle';if([61,63,65,66,67,80,81,82].includes(code))return 'rain';if([71,73,75,77,85,86].includes(code))return 'snow';if([95,96,99].includes(code))return 'thunderstorm';return 'unknown';
}
