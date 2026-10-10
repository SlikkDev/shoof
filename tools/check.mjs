import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const dir of ['src','tools','test','web'])for(const name of await readdir(new URL('../'+dir+'/',import.meta.url))){if(!name.endsWith('.mjs'))continue;const run=spawnSync(process.execPath,['--check',new URL('../'+dir+'/'+name,import.meta.url).pathname],{stdio:'inherit'});if(run.status!==0)process.exit(run.status||1);}console.log('JavaScript syntax checked.');
