// Pruebas del backend (Code.gs) contra una Google Sheet simulada en memoria.
const fs=require('fs'), vm=require('vm');
class Range{constructor(sh,r,c,nr,nc){Object.assign(this,{sh,r,c,nr,nc})}
 setValues(v){v.forEach((row,i)=>row.forEach((x,j)=>this.sh.set(this.r+i,this.c+j,x)));return this}
 setValue(x){this.sh.set(this.r,this.c,x);return this} getValues(){return this.sh.get(this.r,this.c,this.nr,this.nc)}
 setFontWeight(){return this} setNumberFormat(){return this}}
class Sheet{constructor(n){this.name=n;this.d=[]}
 set(r,c,x){while(this.d.length<r)this.d.push([]);this.d[r-1][c-1]=x}
 width(){return Math.max(1,...this.d.map(r=>r.length))}
 get(r,c,nr,nc){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const v=(this.d[r-1+i]||[])[c-1+j];row.push(v===undefined?'':v)}o.push(row)}return o}
 getLastRow(){return this.d.length} getLastColumn(){return this.width()} getMaxRows(){return 1000}
 getRange(a,b,c,d){return typeof a==='string'?new Range(this,1,1,1,1):new Range(this,a,b,c||1,d||1)}
 getDataRange(){return new Range(this,1,1,this.d.length,this.width())} setFrozenRows(){}
 appendRow(row){this.d.push(row.map(x=>typeof x==='boolean'?String(x).toUpperCase():x))} deleteRow(i){this.d.splice(i-1,1)}}
const sheets={}; const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet(n)),getSheets:()=>Object.values(sheets),deleteSheet:s=>delete sheets[s.name]};
const props={ADMIN_KEY:'K'}; let NOW='2026-10-04';
const ctx={SpreadsheetApp:{getActiveSpreadsheet:()=>ss},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})},
 Logger:{log:m=>{}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{formatDate:(d,tz)=>NOW},
 ContentService:{MimeType:{JSON:1},createTextOutput:t=>({t,setMimeType(){return this}})},console};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','apps-script','Code.gs'),'utf8'),ctx);
const call=(action,p={})=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action,...p})}}).t);
const assert=(c,m)=>{if(!c){console.log('FAIL',m);process.exitCode=1}else console.log('ok  ',m)};
const key='K';

// ---- Hoja en el formato ANTERIOR, con datos reales ----
const mk=(n,rows)=>{const s=ss.insertSheet(n); rows.forEach(r=>s.d.push(r));};
mk('Categorias',[['id','nombre'],...Array.from({length:9},(_,i)=>[i+1,'Cat '+(i+1)])]);
const cat=[['id','categoria','letra','variante','nombre','video','activo']];
for(let c=1;c<=9;c++)'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(l=>cat.push([c+l,String(c),l,'','','','TRUE']));
cat.push(['1Ñ','1','Ñ','','Ñandú','','TRUE']); cat.push(['4E1','4','E','1','Al pecho','','TRUE']);
mk('Catalogo',cat);
mk('Usuarios',[['codigo','nombre','activo'],['ANA222','Ana','TRUE'],['LUIS33','Luis','TRUE']]);
mk('Asignaciones',[['id','codigo','ejercicioId','cantidad','unidad','series','x2','orden','activo'],
  ['A1','ANA222','4E1',10,'reps',3,'TRUE',1,'TRUE'],['A2','ANA222','1A',5,'min',1,'FALSE',2,'TRUE'],['A3','ANA222','2B',8,'reps',2,'FALSE',3,'FALSE']]);
mk('Registro',[['fecha','codigo','asignacionId','ejercicioId','serie','timestamp'],
  ['2026-10-02','ANA222','A1','4E1',1,''],['2026-10-02','ANA222','A1','4E1',2,''],['2026-10-03','ANA222','A2','1A',1,'']]);

// ---- Antes de migrar, la app no debe romperse del todo ----
call("getPlan",{codigo:"ANA222"}); assert(props.SCHEMA_VERSION==="3","la primera petición migra sola y guarda la versión"); call("getPlan",{codigo:"ANA222"});
assert(sheets.Catalogo.d.length===cat.length,'setup no duplica el catálogo existente');
assert(sheets.Asignaciones.d[0].includes('planId') && sheets.Registro.d[0].includes('x2'),'columnas nuevas añadidas al final');
assert(sheets.Asignaciones.d.length===4 && sheets.Registro.d.length===4,'no se pierde ninguna fila');
let planes=call('adminData',{key}).data.planes;
assert(planes.length===1 && planes[0].codigo==='ANA222' && planes[0].nombre==='Planificación inicial','una planificación inicial por usuario con asignaciones');
assert(planes[0].inicio==='2026-10-02','empieza el primer día con registro');
let plan=call('getPlan',{codigo:'ana222'}).data;
assert(plan.plan && plan.plan.nombre==='Planificación inicial' && plan.ejercicios.length===2,'el plan vigente sigue igual tras migrar');
// ---- histórico de lo migrado ----
let h=call('getHistory',{codigo:'ANA222'}).data;
assert(h.length===1 && h[0].dias.length===2 && h[0].dias[0].fecha==='2026-10-03','histórico: días con registro, el más reciente primero');
const d2=h[0].dias[1]; assert(d2.items[0].ejercicioId==='4E1' && d2.items[0].hechas===2 && d2.items[0].series===3 && d2.items[0].x2===true,'registros antiguos usan lo de la asignación (2/3 x2)');
assert(h[0].seriesPorDia===4,'series por día del plan (3+1)');

// ---- serie nueva guarda lo prescrito ----
NOW='2026-10-04';
call('logSet',{codigo:'ANA222',asignacionId:'A1',serie:1});
const head=sheets.Registro.d[0], last=sheets.Registro.d.at(-1), col=n=>last[head.indexOf(n)];
assert(col('planId')===planes[0].id && col('cantidad')===10 && col('series')===3 && col('x2')==='TRUE','la serie guarda plan y lo prescrito');
// editar después no cambia el histórico de ese día
call('updateAssignment',{key,id:'A1',cantidad:15,unidad:'reps',series:4,x2:false});
h=call('getHistory',{codigo:'ANA222'}).data;
const hoyItem=h[0].dias[0].items.find(i=>i.ejercicioId==='4E1');
assert(hoyItem.cantidad===10 && hoyItem.series===3 && hoyItem.x2===true,'editar la asignación no reescribe el día ya registrado');

// ---- nueva planificación copiando ----
NOW='2026-11-01';
const np=call('newPlan',{key,codigo:'ANA222',nombre:'Noviembre',copiar:true}).data;
assert(np.copiados===2,'nueva planificación copia los 2 ejercicios activos (no el quitado)');
planes=call('adminData',{key}).data.planes.filter(p=>p.codigo==='ANA222');
const vieja=planes.find(p=>p.nombre==='Planificación inicial');
assert(vieja.fin==='2026-10-31' && planes.find(p=>p.nombre==='Noviembre').fin==='','la anterior termina el día antes y la nueva queda sin fecha de fin');
let ad=call('adminData',{key}).data;
assert(ad.asignaciones.filter(a=>a.codigo==='ANA222').every(a=>a.planId===np.id) && ad.asignaciones.filter(a=>a.codigo==='ANA222').length===2,'admin solo ve las asignaciones de la vigente');
plan=call('getPlan',{codigo:'ANA222'}).data;
assert(plan.plan.nombre==='Noviembre' && plan.ejercicios.length===2 && plan.ejercicios.every(e=>e.hechas.length===0),'el usuario ve la nueva, sin series hechas');
// el mismo ejercicio puede repetirse en otra planificación pero no dos veces en la misma
assert(!call('addAssignment',{key,codigo:'ANA222',ejercicioId:'4E1',cantidad:1,unidad:'reps',series:1}).ok,'no se repite dentro de la planificación');
const nueva=plan.ejercicios.find(e=>e.ejercicioId==='4E1');
call('updateAssignment',{key,id:nueva.asignacionId,cantidad:20,unidad:'seg',series:2,x2:false});
h=call('getHistory',{codigo:'ANA222'}).data;
assert(h[0].nombre==='Noviembre' && h[1].nombre==='Planificación inicial','histórico: planificaciones de la más reciente a la más antigua');
const ej4=h[1].ejercicios.find(e=>e.ejercicioId==='4E1');
assert(ej4.cantidad===15 && ej4.series===4,'editar la nueva no toca la planificación cerrada');
// marcar series en la nueva
call('logSet',{codigo:'ANA222',asignacionId:nueva.asignacionId,serie:1});
h=call('getHistory',{codigo:'ANA222'}).data;
assert(h[0].dias.length===1 && h[0].dias[0].items[0].unidad==='seg','la serie nueva cuenta en la nueva planificación');
// nueva sin copiar
NOW='2026-12-01';
const np2=call('newPlan',{key,codigo:'ANA222',nombre:'',copiar:false}).data;
assert(np2.copiados===0 && np2.nombre==='Planificación 01/12/2026','nueva vacía con nombre por defecto');
assert(call('getPlan',{codigo:'ANA222'}).data.ejercicios.length===0,'vacía para el usuario');
// usuario sin plan al asignar se crea uno
const lp=call('addAssignment',{key,codigo:'LUIS33',ejercicioId:'1Ñ',cantidad:5,unidad:'reps',series:2}).data;
assert(lp.planId && call('getPlan',{codigo:'LUIS33'}).data.plan.nombre==='Planificación 01/12/2026','usuario sin planificación: se crea al asignarle algo');
assert(call('renamePlan',{key,id:lp.planId,nombre:'Diciembre'}).ok && call('getPlan',{codigo:'LUIS33'}).data.plan.nombre==='Diciembre','renombrar planificación');
// seguridad
assert(!call('getHistory',{codigo:'XXXXXX'}).ok,'histórico con código falso rechazado');
assert(!call('adminHistory',{key:'mal',codigo:'ANA222'}).ok,'histórico admin sin clave rechazado');
assert(!call('newPlan',{key:'mal',codigo:'ANA222'}).ok,'nueva planificación sin clave rechazada');
// variante eliminada sigue en el histórico
NOW='2026-12-02';
assert(call('removeAssignment',{key,id:'A1'}).ok,'');
h=call('getHistory',{codigo:'ANA222'}).data;
assert(h[2].dias.find(d=>d.fecha==='2026-10-02').items[0].nombre!==undefined,'histórico antiguo sigue legible');
// Ñ en orden dentro del histórico
call('addAssignment',{key,codigo:'LUIS33',ejercicioId:'1O',cantidad:5,unidad:'reps',series:2});
call('addAssignment',{key,codigo:'LUIS33',ejercicioId:'1N',cantidad:5,unidad:'reps',series:2});
assert(call('getHistory',{codigo:'LUIS33'}).data[0].ejercicios.map(e=>e.letra).join('')==='NÑO','orden español en el histórico');
