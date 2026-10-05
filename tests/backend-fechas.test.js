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

// ---- Planificaciones con fecha de inicio y de fin ----
ctx.setup();
const u=call('addUser',{key,nombre:'Eva'}).data.codigo;
const planesU=()=>call('adminData',{key}).data.planes.filter(p=>p.codigo===u);
NOW='2026-10-05';
// sin datos: desde hoy y sin fecha de fin (como antes)
const p1=call('newPlan',{key,codigo:u,nombre:'Octubre'}).data;
assert(p1.inicio==='2026-10-05' && p1.fin==='','por defecto: desde hoy, sin fecha de fin');
call('addAssignment',{key,codigo:u,ejercicioId:'1A',cantidad:5,unidad:'reps',series:2});
// validaciones
assert(!call('newPlan',{key,codigo:u,inicio:'2026-10-04'}).ok,'no puede empezar antes de hoy');
assert(!call('newPlan',{key,codigo:u,inicio:'2026-10-10',fin:'2026-10-09'}).ok,'fin anterior al inicio rechazado');
assert(!call('newPlan',{key,codigo:u,inicio:'10/10/2026'}).ok,'fecha con formato no válido rechazada');
// editar: poner fecha de fin a la vigente
assert(call('updatePlan',{key,id:p1.id,nombre:'Octubre',inicio:'2026-10-05',fin:'2026-10-31'}).ok,'se le pone fecha de fin');
assert(call('getPlan',{codigo:u}).data.plan.fin==='2026-10-31','el usuario ve la fecha de fin');
assert(!call('updatePlan',{key,id:p1.id,fin:'2026-10-04'}).ok,'fin anterior a hoy rechazado');
// el último día sigue en curso; al día siguiente ya no
NOW='2026-10-31';
assert(call('getPlan',{codigo:u}).data.plan.id===p1.id,'el último día sigue en curso');
NOW='2026-11-01';
let g=call('getPlan',{codigo:u}).data;
assert(g.plan===null && g.ejercicios.length===0,'terminada: el usuario no ve ejercicios');
assert(!call('updatePlan',{key,id:p1.id,fin:'2026-11-30'}).ok,'una terminada no se puede editar');
assert(call('adminData',{key}).data.asignaciones.every(a=>a.codigo!==u),'admin no ve las asignaciones de una terminada');
// nueva que empieza más adelante, con fin; la terminada no se toca
const p2=call('newPlan',{key,codigo:u,nombre:'Bloque 2',inicio:'2026-11-03',fin:'2026-11-30'}).data;
assert(planesU().find(p=>p.id===p1.id).fin==='2026-10-31','la terminada conserva su fin');
g=call('getPlan',{codigo:u}).data;
assert(g.plan===null && g.proxima && g.proxima.inicio==='2026-11-03','antes de empezar: sin plan, con aviso de la próxima');
NOW='2026-11-03';
assert(call('getPlan',{codigo:u}).data.plan.id===p2.id,'el día de inicio ya está en curso');
// nueva antes de que acabe la actual: la actual termina el día antes
NOW='2026-11-10';
const p3=call('newPlan',{key,codigo:u,nombre:'Bloque 3',inicio:'2026-11-17',copiar:true}).data;
assert(planesU().find(p=>p.id===p2.id).fin==='2026-11-16' && p3.fin==='','la actual termina el día antes de la nueva');
assert(call('getPlan',{codigo:u}).data.plan.id===p2.id,'hasta entonces el usuario sigue con la actual');
assert(!call('updatePlan',{key,id:p2.id,fin:'2026-11-20'}).ok,'no se puede alargar encima de la siguiente');
assert(!call('updatePlan',{key,id:p3.id,inicio:'2026-11-12'}).ok,'no se puede adelantar encima de la anterior');
assert(call('updatePlan',{key,id:p3.id,inicio:'2026-11-20'}).ok,'se puede retrasar el inicio');
// la que edita el administrador es la más reciente: asignar va a la que empieza más adelante
const as=call('addAssignment',{key,codigo:u,ejercicioId:'2B',cantidad:5,unidad:'reps',series:2}).data;
assert(as.planId===p3.id,'asignar va a la planificación más reciente');
NOW='2026-11-20';
g=call('getPlan',{codigo:u}).data;
assert(g.plan.id===p3.id && g.ejercicios.length===1,'el día de inicio el usuario ve la nueva');
// misma fecha de inicio que la actual: la actual queda en un solo día y gana la creada después
const p4=call('newPlan',{key,codigo:u,nombre:'Rehecha',inicio:'2026-11-20'}).data;
assert(planesU().find(p=>p.id===p3.id).fin==='2026-11-20' && call('getPlan',{codigo:u}).data.plan.id===p4.id,'misma fecha de inicio: gana la creada después');
assert(!call('updatePlan',{key:'mal',id:p4.id,nombre:'x'}).ok,'editar sin clave rechazado');
assert(call('renamePlan',{key,id:p4.id,nombre:'Renombrada'}).ok && call('getPlan',{codigo:u}).data.plan.nombre==='Renombrada','renamePlan sigue funcionando');
// copiar de una planificación terminada (o de cualquiera), con fechas de hoy a hoy
NOW='2026-12-10';
const viejos=call('getHistory',{codigo:u}).data.find(p=>p.id===p3.id).ejercicios.length;
const p5=call('newPlan',{key,codigo:u,nombre:'Copia de Bloque 2',inicio:'2026-12-10',fin:'2026-12-10',copiar:true,desdeId:p3.id}).data;
assert(planesU().find(p=>p.id===p3.id).fin==='2026-11-20','la terminada de origen no se toca');
assert(p5.copiados===viejos && viejos>0 && p5.inicio==='2026-12-10' && p5.fin==='2026-12-10','copia los ejercicios de una terminada, de hoy a hoy');
assert(call('getPlan',{codigo:u}).data.ejercicios.length===viejos,'el usuario ve los copiados');
assert(!call('newPlan',{key,codigo:u,inicio:'2026-12-10',fin:'2026-12-10',copiar:true,desdeId:'PNOEXISTE'}).ok,'origen inexistente rechazado');
const otro=call('addUser',{key,nombre:'Otro'}).data.codigo;
assert(!call('newPlan',{key,codigo:otro,inicio:'2026-12-10',copiar:true,desdeId:p3.id}).ok,'no se copia de la planificación de otro usuario');
