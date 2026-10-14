// Small local style: no external style JSON in the application's start-up path.
// Geometry for display is independent from the Atlas calculation geometry.
export function createBasemapStyle() {
 const source='openmaptiles',name=['coalesce',['get','name'],['get','name:en'],''];
 const line=(id,color,width,filter,minzoom=0)=>({id,type:'line',source,'source-layer':'transportation',minzoom,filter,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':width}});
 return {version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',light:{anchor:'viewport',color:'#fff8e8',intensity:.28,position:[1.15,210,45]},sources:{[source]:{type:'vector',url:'https://tiles.openfreemap.org/planet/latest',attribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>'}},layers:[
  {id:'background',type:'background',paint:{'background-color':'#f5f3ed'}},
  {id:'landcover',type:'fill',source,'source-layer':'landcover',paint:{'fill-color':['match',['get','class'],'wood','#dce7cf','grass','#e5eddc','farmland','#ecebd7','#eeeae1'],'fill-opacity':.8}},
  {id:'landuse',type:'fill',source,'source-layer':'landuse',paint:{'fill-color':['match',['get','class'],'park','#dce9d1','cemetery','#e0e8d9','industrial','#eae7df','residential','#f0eee7','#f3f0e8'],'fill-opacity':.7}},
  {id:'parks',type:'fill',source,'source-layer':'park',paint:{'fill-color':'#dce9d1','fill-opacity':.75}},
  {id:'water',type:'fill',source,'source-layer':'water',paint:{'fill-color':'#b8dbe2'}},
  {id:'waterway',type:'line',source,'source-layer':'waterway',paint:{'line-color':'#b8dbe2','line-width':['interpolate',['linear'],['zoom'],12,.7,17,3]}},
  {id:'building-footprint',type:'fill',source,'source-layer':'building',minzoom:13,paint:{'fill-color':'#e7d6b6','fill-outline-color':'#d6c39e'}},
  line('roads-casing','#e2ddd1',['interpolate',['linear'],['zoom'],12,1.8,15,6,18,20],['in',['get','class'],['literal',['motorway','trunk','primary','secondary','tertiary','minor','service']]]),
  line('roads','#ffffff',['interpolate',['linear'],['zoom'],12,.8,15,4.5,18,17],['in',['get','class'],['literal',['primary','secondary','tertiary','minor','service']]]),
  line('major-roads','#f0dba3',['interpolate',['linear'],['zoom'],12,1.6,15,5,18,18],['in',['get','class'],['literal',['motorway','trunk']]]),
  line('paths','#d7c9a7',['interpolate',['linear'],['zoom'],13,.5,16,1.2,18,2.5],['in',['get','class'],['literal',['path','track']]],13),
  {...line('rail','#c7cbd0',['interpolate',['linear'],['zoom'],12,.6,18,2],['==',['get','class'],'rail']),paint:{'line-color':'#c7cbd0','line-width':['interpolate',['linear'],['zoom'],12,.6,18,2],'line-dasharray':[3,3]}},
  {id:'road-labels',type:'symbol',source,'source-layer':'transportation_name',minzoom:14,layout:{'symbol-placement':'line','text-field':name,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],14,10,18,12],'text-max-angle':35,'text-padding':4},paint:{'text-color':'#68706c','text-halo-color':'#ffffff','text-halo-width':1.3}},
  {id:'place-labels',type:'symbol',source,'source-layer':'place',filter:['in',['get','class'],['literal',['city','town','village','suburb','neighbourhood']]],layout:{'text-field':name,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],11,13,15,16],'text-max-width':9},paint:{'text-color':'#56655e','text-halo-color':'#ffffff','text-halo-width':1.4}},
 ]};
}

export function buildingDisplayLayer() {
 return {id:'city-buildings-3d',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',minzoom:13,filter:['!=',['get','hide_3d'],true],layout:{visibility:'none'},paint:{'fill-extrusion-color':'#e7cc97','fill-extrusion-height':['max',2,['coalesce',['get','render_height'],8]],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':false}};
}
