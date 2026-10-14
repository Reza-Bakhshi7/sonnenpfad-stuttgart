export function treeKey(tree){return tree.p.map(value=>Number(value).toFixed(2)).join(':');}
export function stableTreeSelection(trees,previousKeys,center,cap=1200){
 const available=new Map(trees.map(tree=>[treeKey(tree),tree])),selected=[];
 // Retain existing crowns across zoom-band and tile refreshes. Replace only
 // trees that have genuinely left the loaded area, not the whole population.
 for(const key of previousKeys){if(available.has(key)&&selected.length<cap){selected.push(available.get(key));available.delete(key);}}
 const remaining=[...available.values()].sort((a,b)=>Math.hypot(a.p[0]-center[0],a.p[1]-center[1])-Math.hypot(b.p[0]-center[0],b.p[1]-center[1])||treeKey(a).localeCompare(treeKey(b)));
 selected.push(...remaining.slice(0,cap-selected.length));
 return {trees:selected,keys:selected.map(treeKey)};
}
