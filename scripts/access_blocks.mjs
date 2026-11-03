// Browser access blocks taken from the audited server graph (routing.walk_edges).
//   node scripts/access_blocks.mjs points <out.txt>   edge midpoints as "index lon lat"
//   node scripts/access_blocks.mjs apply <blocks.json> bitset + manifest entry
// blocks.json comes from scripts/export_access_blocks.py (read-only, on the VM).
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../dist/city'),manifestPath=path.join(root,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),net=manifest.network;
const [mode,file]=process.argv.slice(2);

if(mode==='points'){
 const read=files=>Buffer.concat(files.map(name=>fs.readFileSync(path.join(root,name))));
 const nodes=read(net.nodes),edges=read(net.edges),lines=[];
 const lonlat=i=>[manifest.origin[0]+nodes.readFloatLE(i*8)/manifest.scale[0],manifest.origin[1]+nodes.readFloatLE(i*8+4)/manifest.scale[1]];
 for(let i=0;i<net.edgeCount;i++){
  const a=lonlat(edges.readUInt32LE(i*net.edgeStride)),b=lonlat(edges.readUInt32LE(i*net.edgeStride+4));
  lines.push(`${i} ${((a[0]+b[0])/2).toFixed(9)} ${((a[1]+b[1])/2).toFixed(9)}`);
 }
 fs.writeFileSync(file,lines.join('\n')+'\n');
 console.log(`${lines.length} edge midpoints written to ${file}`);
}else if(mode==='apply'){
 const blocks=JSON.parse(fs.readFileSync(file,'utf8'));
 if(blocks.edgeCount!==net.edgeCount)throw Error(`Edge count mismatch: ${blocks.edgeCount} vs ${net.edgeCount}`);
 const bits=new Uint8Array(Math.ceil(net.edgeCount/8));
 for(const i of blocks.blocked){if(!Number.isInteger(i)||i<0||i>=net.edgeCount)throw Error(`Invalid edge ${i}`);bits[i>>3]|=1<<(i&7);}
 fs.writeFileSync(path.join(root,'network/access-blocked.bin'),bits);
 // Insert one line instead of re-serialising: JS would reorder the manifest's numeric keys.
 const entry=JSON.stringify({file:'network/access-blocked.bin',count:blocks.blocked.length,ambiguousKeptOpen:blocks.ambiguous,source:blocks.source});
 const text=fs.readFileSync(manifestPath,'utf8').replace(/\n {4}"accessBlocked": .*,\n/,'\n'),anchor='\n  "network": {\n';
 if(text.split(anchor).length!==2)throw Error('Unexpected manifest layout');
 fs.writeFileSync(manifestPath,text.replace(anchor,`${anchor}    "accessBlocked": ${entry},\n`));
 console.log(`${blocks.blocked.length} edges blocked, ${blocks.ambiguous} ambiguous kept open`);
}else throw Error('Usage: access_blocks.mjs points <out.txt> | apply <blocks.json>');
