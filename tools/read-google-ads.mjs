import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPrivateJson } from '../src/runtime-config.mjs';
import { validateTenant } from '../src/tenant.mjs';
import { createObservationStore } from '../src/observation-store.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { createGoogleAdsTransport, googleAdsPeriod, runGoogleAdsRead } from '../src/google-ads-reader.mjs';

// Explicit opt-in only; secret contents never appear in argv, output or the web.
try {
  if (process.env.REPORTING_GOOGLE_ADS_ENABLED !== 'true') throw new Error('Not enabled');
  const tenantPath = process.env.REPORTING_TENANT_FILE;
  const fingerprint = () => createHash('sha256').update(readFileSync(tenantPath)).digest('hex');
  const before = fingerprint(), tenant = validateTenant(await readPrivateJson(tenantPath));
  if (tenant.mode !== 'private' || fingerprint() !== before) throw new Error('Tenant changed');
  const config = await readPrivateJson(process.env.REPORTING_GOOGLE_ADS_CONFIG_FILE);
  const keys=['origin','workspaceId','customerId','currency','sourceTimezone','jobId','intervalMs','staleAfterMs'];
  const windowKey=Object.hasOwn(config,'period')?'period':'completedDays';
  if (Object.keys(config).length!==keys.length+1 || !keys.every(key=>Object.hasOwn(config,key)) || !Object.hasOwn(config,windowKey) || config.workspaceId!==tenant.workspaceId) throw new Error('Invalid private reader configuration');
  const secret = await readPrivateJson(process.env.REPORTING_GOOGLE_ADS_TOKEN_FILE);
  if (Object.keys(secret).length!==1 || typeof secret.token!=='string') throw new Error('Invalid private token file');
  const context={tenantId:tenant.tenantId,workspaceId:config.workspaceId,customerId:config.customerId,currency:config.currency,sourceTimezone:config.sourceTimezone,period:googleAdsPeriod(config)};
  const store = await createObservationStore(process.env.REPORTING_STATE_DIR);
  const data = await createRuntimeData({tenant,directory:process.env.REPORTING_STATE_DIR});
  // Confirm an accepted report before making any source request.
  await data.read();
  const result=await runGoogleAdsRead({enabled:true,context,jobId:config.jobId,intervalMs:config.intervalMs,staleAfterMs:config.staleAfterMs,store,data,
    currentTenantId:()=>fingerprint()===before?tenant.tenantId:null,transport:createGoogleAdsTransport({origin:config.origin,token:secret.token,context})});
  console.log(JSON.stringify(result));
  if (!['success','not-due'].includes(result.status)) process.exitCode=1;
} catch { console.error('Google Ads reader stopped; inspect private state. Previous evidence is retained on read failure.'); process.exitCode=1; }
