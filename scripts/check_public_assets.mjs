import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const files=[];const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else files.push(file);}};walk('dist');
const blocked=/(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?|\.git)(?:$|\/)|\.(?:pem|key|p12|sqlite|gpkg|qgz|map)$/i;
const secret=/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for(const file of files){assert(!blocked.test(file),`Forbidden public artifact: ${file}`);if(/\.(?:mjs|js|json|html|css|txt)$/.test(file))assert(!secret.test(fs.readFileSync(file,'utf8')),`Credential signature detected in ${file}`);}
const headers=fs.readFileSync('dist/_headers','utf8');for(const rule of ["object-src 'none'","frame-ancestors 'none'","base-uri 'self'","script-src 'self'","worker-src 'self' blob:",'X-Content-Type-Options: nosniff','Permissions-Policy: camera=(), microphone=(), geolocation=(self)'])assert(headers.includes(rule));
assert(!headers.includes("script-src 'self' 'unsafe-eval'"));assert(!headers.includes("script-src 'self' 'unsafe-inline'"));
console.log(`Public-artifact checks passed: ${files.length} files, no secret signatures, private files or source maps; explicit CSP, framing and device-permission restrictions.`);
