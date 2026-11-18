// One-time setup of the admin area, run by the owner in their own terminal:  npm run admin-setup
// Creates the free D1 database, applies the migrations and stores the login secrets as Cloudflare Worker
// secrets. Password and TOTP key are entered/shown only here; nothing is written to the repository or logs.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import {hashPassword,totpCode} from '../services/platform.mjs';

const wrangler=(args,input)=>spawnSync('npx',['--yes','wrangler',...args],{input,encoding:'utf8',shell:process.platform==='win32',stdio:[input===undefined?'inherit':'pipe','pipe','pipe']});
const say=text=>process.stdout.write(text+'\n');
function ask(question,hidden=false){
 return new Promise(resolve=>{
  const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
  if(hidden)rl._writeToOutput=text=>{if(text.includes(question))process.stdout.write(question);};
  rl.question(question,answer=>{rl.close();if(hidden)process.stdout.write('\n');resolve(answer.trim());});
 });
}
function base32(bytes){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
function putSecret(name,value){const result=wrangler(['secret','put',name],value);if(result.status!==0){say(`Fehler beim Speichern von ${name}:\n${result.stderr.slice(-400)}`);process.exit(1);}say(`✓ ${name} gespeichert`);}

say('Sonnenpfad · Einrichtung der Verwaltung\n');
const who=wrangler(['whoami']);
if(!/You are logged in|associated with the email/i.test(who.stdout+who.stderr)){say('Bitte zuerst bei Cloudflare anmelden:  npx wrangler login\nDanach dieses Skript erneut starten.');process.exit(1);}

// 1. Database (free D1) with the binding "DB".
const configFile=new URL('../wrangler.jsonc',import.meta.url);let config=fs.readFileSync(configFile,'utf8');
if(!config.includes('"d1_databases"')){
 say('Lege die kostenlose Datenbank „sonnenpfad-platform“ an …');
 const created=wrangler(['d1','create','sonnenpfad-platform']);const id=(created.stdout+created.stderr).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
 if(!id){say('Datenbank konnte nicht angelegt werden:\n'+(created.stdout+created.stderr).slice(-600));process.exit(1);}
 config=config.replace(/\n}\s*$/,`,\n  "d1_databases": [{"binding": "DB", "database_name": "sonnenpfad-platform", "database_id": "${id}", "migrations_dir": "migrations"}],\n  "vars": {"OPS_URL": "https://138.2.184.1/ops/metrics"}\n}\n`);
 fs.writeFileSync(configFile,config);say('✓ Datenbank angelegt, wrangler.jsonc ergänzt');
}
const migrated=wrangler(['d1','migrations','apply','sonnenpfad-platform','--remote'],'y\n');
if(migrated.status!==0){say('Tabellen konnten nicht angelegt werden:\n'+migrated.stderr.slice(-600));process.exit(1);}
say('✓ Tabellen angelegt');

// 2. Password (min. 12 characters), hashed here; only the hash leaves this computer.
let password='';
for(;;){password=await ask('Neues Admin-Passwort (mind. 12 Zeichen): ',true);const again=await ask('Passwort wiederholen: ',true);if(password.length>=12&&password===again)break;say('Passwörter stimmen nicht überein oder sind zu kurz. Bitte erneut.');}
const passwordHash=await hashPassword(password);password='';

// 3. TOTP key for the authenticator app, confirmed with a current code before it is stored.
const secret=base32(crypto.getRandomValues(new Uint8Array(20)));
say('\nIn der Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator, 2FAS, Aegis) einen neuen Eintrag');
say('„Schlüssel manuell eingeben“ anlegen:\n');
say('  Name:      Sonnenpfad Verwaltung');
say('  Schlüssel: '+secret.match(/.{1,4}/g).join(' '));
say('  Typ:       zeitbasiert, 6 Ziffern, 30 Sekunden\n');
say('(oder als Link: otpauth://totp/Sonnenpfad:Verwaltung?secret='+secret+'&issuer=Sonnenpfad)\n');
for(;;){const code=await ask('Aktuellen 6-stelligen Code aus der App eingeben: ');const step=Math.floor(Date.now()/30000);if([step,step-1,step+1].length&&(await Promise.all([step,step-1,step+1].map(s=>totpCode(secret,s)))).includes(code))break;say('Code passt nicht. Bitte den aktuellen Code eingeben.');}
console.clear?.();say('✓ Authenticator-App bestätigt');

// 4. Store the secrets in Cloudflare (never shown again).
putSecret('ADMIN_PASSWORD_HASH',passwordHash);
putSecret('ADMIN_TOTP_SECRET',secret);
putSecret('ADMIN_SESSION_KEY',Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
const token=spawnSync('ssh',['-o','BatchMode=yes','sonnenpfad-vm','sudo -n cat /etc/sonnenpfad-ops/token'],{encoding:'utf8'});
if(token.status===0&&/^[0-9a-f]{32}\s*$/.test(token.stdout))putSecret('OPS_TOKEN',token.stdout.trim());else say('Hinweis: OPS_TOKEN nicht gesetzt (Server nicht erreichbar). Später erneut starten.');
say('\nFertig. Sag Claude Bescheid: „Admin eingerichtet“. Danach wird die geänderte wrangler.jsonc veröffentlicht.');
