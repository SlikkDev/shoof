import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadReport } from '../src/tenant.mjs';
export async function startPreview({env=process.env,port=Number(env.REPORTING_PORT||4327)}={}) {
  if (!Number.isInteger(port)||port<0||port>65535) throw new Error('Invalid local port');
  const report=JSON.stringify(await loadReport(env));
  const routes=new Map([['/',['index.html','text/html']],['/styles.css',['styles.css','text/css']],['/app.mjs',['app.mjs','text/javascript']]]);
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(path==='/api/report'){res.setHeader('Content-Type','application/json; charset=utf-8');res.end(req.method==='HEAD'?undefined:report);return;}
    if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const route=routes.get(path);if(!route){res.writeHead(404);res.end();return;}
    try{const bytes=await readFile(new URL('../web/'+route[0],import.meta.url));res.setHeader('Content-Type',route[1]+'; charset=utf-8');res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(500);res.end('Preview unavailable');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}
if(process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]) {
  try{const server=await startPreview();console.log(`Local reporting preview: http://127.0.0.1:${server.address().port}`);}catch{console.error('Preview could not start. Verify external input configuration and the local port.');process.exitCode=1;}
}
