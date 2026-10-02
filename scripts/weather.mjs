export const WEATHER_ENDPOINT='https://api.open-meteo.com/v1/forecast';
export const WEATHER_CACHE_KEY='sonnenpfad.weather.stuttgart.v1';
export const WEATHER_CACHE_MS=10*60*1000;
export const WEATHER_STALE_MS=6*60*60*1000;

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));

export function weatherUrl(){
 const url=new URL(WEATHER_ENDPOINT);
 url.search=new URLSearchParams({
  latitude:'48.778',longitude:'9.180',timezone:'Europe/Berlin',past_days:'1',forecast_days:'7',
  hourly:['temperature_2m','apparent_temperature','weather_code','cloud_cover','wind_speed_10m','wind_direction_10m','wind_gusts_10m','direct_radiation','shortwave_radiation','terrestrial_radiation'].join(','),
 });
 return url;
}

export function normalizeWeather(payload,retrievedAt=Date.now()){
 const hourly=payload?.hourly,times=hourly?.time;
 if(!Array.isArray(times)||!times.length)throw Error('weather-contract');
 const rows=times.map((time,index)=>({
  time,
  temperature:hourly.temperature_2m?.[index],
  apparentTemperature:hourly.apparent_temperature?.[index],
  weatherCode:hourly.weather_code?.[index],
  cloudCover:hourly.cloud_cover?.[index],
  windSpeed:hourly.wind_speed_10m?.[index],
  windDirection:hourly.wind_direction_10m?.[index],
  windGust:hourly.wind_gusts_10m?.[index],
  directRadiation:hourly.direct_radiation?.[index],
  shortwaveRadiation:hourly.shortwave_radiation?.[index],
  terrestrialRadiation:hourly.terrestrial_radiation?.[index],
 }));
 return {retrievedAt,latitude:payload.latitude,longitude:payload.longitude,elevation:payload.elevation,timezone:payload.timezone||'Europe/Berlin',rows};
}

export function weatherAt(model,day,minutes){
 if(!model?.rows?.length||!/^\d{4}-\d\d-\d\d$/.test(day))return null;
 const target=Date.parse(`${day}T00:00:00Z`)+Math.max(0,Math.min(1439,Number(minutes)||0))*60000;
 let best=null,distance=Infinity;
 for(const row of model.rows){const value=Date.parse(`${row.time}:00Z`),next=Math.abs(value-target);if(next<distance){best=row;distance=next;}}
 if(!best||distance>31*60*1000)return null;
 const direct=Math.max(0,Number(best.directRadiation)||0);
 // Below 40 W/m² there is effectively no useful direct-sun contrast for routing.
 // From there to 490 W/m² the optional sun/shade preference increases smoothly.
 // Weather never weakens mobility or safety criteria.
 return {...best,solarWeight:clamp((direct-40)/450),forecastDistanceMinutes:Math.round(distance/60000)};
}

export function weatherCodeGroup(code){
 if(code===0)return 'clear';
 if([1,2].includes(code))return 'partlyCloudy';
 if(code===3)return 'overcast';
 if([45,48].includes(code))return 'fog';
 if([51,53,55,56,57].includes(code))return 'drizzle';
 if([61,63,65,66,67,80,81,82].includes(code))return 'rain';
 if([71,73,75,77,85,86].includes(code))return 'snow';
 if([95,96,99].includes(code))return 'thunderstorm';
 return 'unknown';
}
