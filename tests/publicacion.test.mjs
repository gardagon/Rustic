import { extractCode, exchange, publish, replaceSource, verify, authUrl } from '../.github/scripts/google.mjs';
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m); if(!c) process.exitCode=1;};
const R=(status,body)=>({ok:status<300,status,json:async()=>body,text:async()=>JSON.stringify(body)});
ok(extractCode('http://localhost/?code=4/0AVMBsJ%2Fabc&scope=x')==='4/0AVMBsJ/abc','extrae el código de la URL de localhost');
ok(extractCode('  4/0AXYZ  ')==='4/0AXYZ','acepta el código suelto');
ok(authUrl().includes('access_type=offline')&&authUrl().includes('prompt=consent')&&!authUrl().includes('cloud-platform'),'enlace con permisos mínimos y credencial permanente');
// canje
let calls=[]; const f1=async(u,o)=>{calls.push([u,o]); return R(200,{access_token:'at',refresh_token:'RT'});};
ok(await exchange('C',f1)==='RT' && String(calls[0][1].body).includes('redirect_uri=http%3A%2F%2Flocalhost'),'canje devuelve credencial');
try{ await exchange('C',async()=>R(400,{error:'invalid_grant'})); ok(false,'');}catch(e){ ok(/caducado/.test(e.message),'código caducado: mensaje claro'); }
// publicar
const log=[]; let content={files:[{name:'Código',type:'SERVER_JS',source:'viejo'},{name:'appsscript',type:'JSON',source:'{"webapp":{"access":"ANYONE_ANONYMOUS"}}'}]};
const f2=async(u,o={})=>{ const m=o.method||'GET'; log.push(m+' '+u.replace('https://script.googleapis.com/v1','')); 
  if(u.includes('oauth2')) return R(200,{access_token:'AT'});
  if(m==='GET'&&u.endsWith('/content')) return R(200,content);
  if(m==='PUT'&&u.endsWith('/content')) { content=JSON.parse(o.body); return R(200,content);} 
  if(m==='POST'&&u.endsWith('/versions')) return R(200,{versionNumber:7});
  if(m==='PUT'&&u.includes('/deployments/')) { ok(JSON.parse(o.body).deploymentConfig.versionNumber===7,'la implementación apunta a la versión nueva'); return R(200,{}); }
  return R(500,{}); };
const n=await publish({refreshToken:'RT',scriptId:'SID',deploymentId:'DID',source:'nuevo',descripcion:'d'},f2);
ok(n===7,'publica la versión 7');
ok(content.files.find(x=>x.name==='Código').source==='nuevo' && content.files.find(x=>x.name==='appsscript').source.includes('ANYONE_ANONYMOUS'),'sustituye el código y conserva el manifiesto y el nombre del archivo');
ok(log.join(',').includes('GET /projects/SID/content,PUT /projects/SID/content,POST /projects/SID/versions,PUT /projects/SID/deployments/DID'),'orden: leer, subir, versión, implementación');
// API desactivada
try{ await publish({refreshToken:'RT',scriptId:'SID',deploymentId:'DID',source:'x'},async(u)=>u.includes('oauth2')?R(200,{access_token:'AT'}):R(403,{error:{message:'User has not enabled the Apps Script API. Enable it by visiting ...'}})); ok(false,''); }
catch(e){ ok(/usersettings/.test(e.message),'API desactivada: dice dónde activarla'); }
// varios archivos
try{ replaceSource([{name:'A',type:'SERVER_JS'},{name:'B',type:'SERVER_JS'}],'x'); ok(false,''); }catch(e){ ok(/varios archivos/.test(e.message),'varios archivos de código: avisa'); }
ok(replaceSource([{name:'Code',type:'SERVER_JS'},{name:'Util',type:'SERVER_JS'}],'x')[0].source==='x','con varios, elige Code/Código');
// verificación
const v=await verify('DID',async()=>({text:async()=>'{"ok":true,"esquema":2}'})); ok(v.esquema===2,'verifica la app web publicada');
