import { mkdir,copyFile,writeFile } from 'node:fs/promises';
import { loadReport } from '../src/tenant.mjs';
if(process.env.REPORTING_TENANT_FILE||process.env.REPORTING_SNAPSHOT_FILE) throw new Error('Build refused: clear private runtime inputs. Only fictional demos may be built.');
const output=new URL('../dist/',import.meta.url);await mkdir(new URL('api/',output),{recursive:true});
for(const name of ['index.html','styles.css','app.mjs'])await copyFile(new URL('../web/'+name,import.meta.url),new URL(name,output));
const report=await loadReport({});if(report.mode!=='demo')throw new Error('Fictional demo required');
await writeFile(new URL('api/report',output),JSON.stringify(report,null,2)+'\n');
console.log('Built fictional static demo. No private inputs were read.');
