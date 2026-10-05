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

// ---- Descripción (comentario) que escribe el usuario en cada ejercicio asignado ----
ctx.setup();
assert(sheets.Asignaciones.d[0].includes('comentario'),'columna comentario en Asignaciones');
const u=call('addUser',{key,nombre:'Eva'}).data.codigo, otro=call('addUser',{key,nombre:'Leo'}).data.codigo;
NOW='2026-10-05';
const a=call('addAssignment',{key,codigo:u,ejercicioId:'1A',cantidad:5,unidad:'reps',series:2}).data.id;
let e=call('getPlan',{codigo:u}).data.ejercicios[0];
assert(e.comentario==='','al asignar, la descripción viene vacía');
assert(call('setComment',{codigo:u,asignacionId:a,comentario:'  Rodillas a 90º, bajar lento  '}).ok,'el usuario la escribe');
e=call('getPlan',{codigo:u}).data.ejercicios[0];
assert(e.comentario==='Rodillas a 90º, bajar lento','se guarda recortada y la ve en su plan');
assert(call('adminData',{key}).data.asignaciones.find(x=>x.id===a).comentario==='Rodillas a 90º, bajar lento','el administrador la ve');
assert(!call('setComment',{codigo:otro,asignacionId:a,comentario:'x'}).ok,'otro usuario no puede cambiarla');
assert(!call('setComment',{codigo:'XXXXXX',asignacionId:a,comentario:'x'}).ok,'código falso rechazado');
assert(!call('setComment',{codigo:u,asignacionId:a,comentario:'x'.repeat(1001)}).ok,'máximo 1000 caracteres');
call('updateAssignment',{key,id:a,cantidad:8,unidad:'reps',series:3,x2:false});
assert(call('getPlan',{codigo:u}).data.ejercicios[0].comentario==='Rodillas a 90º, bajar lento','editar la asignación (admin) no borra la descripción');
call('updateAssignment',{key,id:a,cantidad:8,unidad:'reps',series:3,comentario:'del admin'});
assert(call('getPlan',{codigo:u}).data.ejercicios[0].comentario==='Rodillas a 90º, bajar lento','el administrador no puede cambiarla');
call('setComment',{codigo:u,asignacionId:a,comentario:'=IMPORTXML("x")'});
const head=sheets.Asignaciones.d[0], fila=sheets.Asignaciones.d.find(r=>r[0]===a);
assert(String(fila[head.indexOf('comentario')]).startsWith("'="),'un texto que empieza por = no se guarda como fórmula');
call('setComment',{codigo:u,asignacionId:a,comentario:'Rodillas a 90º'});
// nueva planificación copiando: la descripción viaja con el ejercicio
const np=call('newPlan',{key,codigo:u,inicio:'2026-10-05',fin:'2026-10-31',copiar:true}).data;
e=call('getPlan',{codigo:u}).data.ejercicios[0];
assert(e.asignacionId!==a && e.comentario==='Rodillas a 90º','al copiar la planificación se copia la descripción');
// terminada: solo lectura
NOW='2026-11-01';
assert(!call('setComment',{codigo:u,asignacionId:e.asignacionId,comentario:'tarde'}).ok,'en una planificación terminada no se puede cambiar');
