import { createHash } from 'node:crypto';
import { normalizeObservationPage } from './read-contract.mjs';
export function parseManualObservations(text,context) {
  if(typeof text!=='string'||Buffer.byteLength(text)>5_000_000)throw new Error('Bounded JSON aggregate export required');
  const input=JSON.parse(text);
  if(input.schemaVersion!==1||input.origin!=='manual'||typeof input.exportedAt!=='string'||!Number.isFinite(Date.parse(input.exportedAt))||input.period?.start!==context.period.start||input.period?.endExclusive!==context.period.endExclusive||input.nextCursor!==null)throw new Error('Manual export provenance/period missing');
  if(!context.metricKeys.every(key=>typeof input.units?.[key]==='string'&&input.units[key].trim()&&input.units[key].length<=100))throw new Error('Explicit source units required');
  const page=normalizeObservationPage(input,context),seen=new Set();
  for(const row of page.rows){const key=`${row.accountId}:${row.key}`;if(seen.has(key))throw new Error('Duplicate source identity');seen.add(key);}
  return {origin:'manual',tenantId:context.tenantId,sourceId:context.sourceId,period:{start:context.period.start,endExclusive:context.period.endExclusive},timezone:context.timezone,exportedAt:input.exportedAt,units:Object.fromEntries(context.metricKeys.map(k=>[k,input.units[k]])),exportHash:createHash('sha256').update(text).digest('hex'),rows:page.rows,coverage:'unverified'};
}
