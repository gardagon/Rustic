// Pruebas del backend (Code.gs) contra una Google Sheet simulada en memoria.
const fs=require('fs'), vm=require('vm');
// --- Mock mínimo de los servicios de Google ---
class Range{constructor(sh,r,c,nr,nc){Object.assign(this,{sh,r,c,nr,nc})}
 setValues(v){v.forEach((row,i)=>row.forEach((x,j)=>this.sh.set(this.r+i,this.c+j,x)));return this}
 setValue(x){this.sh.set(this.r,this.c,x);return this} getValues(){return this.sh.get(this.r,this.c,this.nr,this.nc)}
 setFontWeight(){return this} setNumberFormat(){return this}}
class Sheet{constructor(n){this.name=n;this.d=[]}
 set(r,c,x){while(this.d.length<r)this.d.push([]);this.d[r-1][c-1]=x}
 width(){return Math.max(1,...this.d.map(r=>r.length))}
 get(r,c,nr,nc){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const v=(this.d[r-1+i]||[])[c-1+j];row.push(v===undefined?'':v)}o.push(row)}return o}
 getLastRow(){return this.d.length} getLastColumn(){return this.width()} getMaxRows(){return 1000} getRange(a,b,c,d){return typeof a==='string'?new Range(this,1,1,1,1):new Range(this,a,b,c||1,d||1)}
 getDataRange(){return new Range(this,1,1,this.d.length,this.width())} setFrozenRows(){}
 appendRow(row){this.d.push(row.map(x=>typeof x==='boolean'?String(x).toUpperCase():x))} deleteRow(i){this.d.splice(i-1,1)}}
const sheets={}; const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet(n)),getSheets:()=>Object.values(sheets),deleteSheet:s=>delete sheets[s.name]};
const props={};
const ctx={SpreadsheetApp:{getActiveSpreadsheet:()=>ss},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})},
 Logger:{log:()=>{}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{formatDate:(d,tz)=>d.toLocaleDateString('sv-SE',{timeZone:tz})},
 ContentService:{MimeType:{JSON:1},createTextOutput:t=>({t,setMimeType(){return this}})},console};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','apps-script','Code.gs'),'utf8'),ctx);
const call=(action,p={})=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action,...p})}}).t);
const assert=(c,m)=>{if(!c){console.log('FAIL',m);process.exitCode=1}else console.log('ok  ',m)};

ctx.setup(); ctx.setup();
const key=props.ADMIN_KEY;
assert(sheets.Catalogo.d.length===244,'243 ejercicios base (con Ñ) creados una sola vez');
let ad=call('adminData',{key}).data;
assert(ad.catalogo[0].id==='1A'&&ad.catalogo[242].id==='9Z','IDs 1A … 9Z');
assert(!('variantes' in ad),'sin lista de variantes genérica');
assert(call('updateExercise',{key,id:'4e',nombre:'Remo anillas',video:'https://youtu.be/base'}).ok,'nombrar 4E (id en minúscula aceptado)');
const v1=call('addVariant',{key,baseId:'4E',nombre:'Anilla al pecho',video:'https://youtu.be/v1'}).data;
const v2=call('addVariant',{key,baseId:'4E',nombre:'Anilla a la cadera'}).data;
assert(v1.id==='4E1'&&v2.id==='4E2','variantes 4E1 y 4E2');
assert(!call('addVariant',{key,baseId:'4E1',nombre:'x'}).ok,'no se crean variantes de variantes');
assert(call('updateExercise',{key,id:'4E2',nombre:'Anilla a la cadera',video:'https://youtu.be/v2'}).ok,'editar variante');
const u=call('addUser',{key,nombre:'Ana'}).data;
call('addAssignment',{key,codigo:u.codigo,ejercicioId:'4E1',cantidad:10,unidad:'reps',series:3});
call('addAssignment',{key,codigo:u.codigo,ejercicioId:'1A',cantidad:5,unidad:'min',series:1});
call('addAssignment',{key,codigo:u.codigo,ejercicioId:'4E',cantidad:8,unidad:'reps',series:2});
let pl=call('getPlan',{codigo:u.codigo}).data.ejercicios;
assert(pl.map(e=>e.ejercicioId).join()==='1A,4E,4E1','orden por categoría, letra y variante');
assert(pl[0].nombre===''&&pl[0].video==='','1A sin nombre (se explica en clase)');
assert(pl[2].nombre==='Remo anillas'&&pl[2].varianteNombre==='Anilla al pecho'&&pl[2].video==='https://youtu.be/v1','variante con nombre base, su nombre y su vídeo');
call('updateExercise',{key,id:'4E1',nombre:'Anilla al pecho',video:''});
pl=call('getPlan',{codigo:u.codigo}).data.ejercicios;
assert(pl[2].video==='https://youtu.be/base','variante sin vídeo usa el del base');
assert(!call('removeVariant',{key,id:'4E1'}).ok,'no se elimina variante asignada');
assert(!call('removeVariant',{key,id:'4E'}).ok,'no se elimina un ejercicio base');
const aid=pl[2].asignacionId;
assert(call('updateAssignment',{key,id:aid,ejercicioId:'4E2',cantidad:12,unidad:'reps',series:4}).ok,'cambiar de variante en la asignación');
pl=call('getPlan',{codigo:u.codigo}).data.ejercicios;
assert(pl[2].ejercicioId==='4E2'&&pl[2].series===4,'plan refleja variante nueva');
assert(call('removeVariant',{key,id:'4E1'}).ok,'eliminar variante ya sin asignar');
const v3=call('addVariant',{key,baseId:'4E',nombre:'Otra'}).data;
assert(v3.id==='4E3','no se reutiliza el número de una variante eliminada');
call('logSet',{codigo:u.codigo,asignacionId:aid,serie:1});
assert(sheets.Registro.d[1][3]==='4E2','registro guarda la variante hecha');
assert(!call('addAssignment',{key,codigo:u.codigo,ejercicioId:'4E1',cantidad:1,unidad:'reps',series:1}).ok,'no se asigna una variante eliminada');
assert(!call('updateExercise',{key:'mal',id:'4E',nombre:'x'}).ok,'editar sin clave rechazado');
// --- x2 y duplicados ---
const u3=call('addUser',{key,nombre:'Eva'}).data;
assert(call('addAssignment',{key,codigo:u3.codigo,ejercicioId:'5A',cantidad:8,unidad:'reps',series:3,x2:true}).ok,'asignar con x2');
let r=call('addAssignment',{key,codigo:u3.codigo,ejercicioId:'5a',cantidad:8,unidad:'reps',series:3});
assert(!r.ok && /ya está en este plan/.test(r.error),'no se repite el mismo ejercicio (aunque venga en minúscula)');
assert(call('addAssignment',{key,codigo:u2b=u.codigo,ejercicioId:'5A',cantidad:8,unidad:'reps',series:3}).ok,'el mismo ejercicio sí en el plan de otro usuario');
call('addAssignment',{key,codigo:u3.codigo,ejercicioId:'4E2',cantidad:8,unidad:'reps',series:3});
const a4=call('addAssignment',{key,codigo:u3.codigo,ejercicioId:'4E3',cantidad:8,unidad:'reps',series:3}).data.id;
assert(!call('updateAssignment',{key,id:a4,ejercicioId:'4E2',cantidad:8,unidad:'reps',series:3}).ok,'no se cambia a una variante que ya está en el plan');
assert(call('updateAssignment',{key,id:a4,ejercicioId:'4E3',cantidad:9,unidad:'reps',series:3,x2:true}).ok,'editar manteniendo su propio ejercicio');
let pe=call('getPlan',{codigo:u3.codigo}).data.ejercicios;
assert(pe.find(e=>e.ejercicioId==='5A').x2===true && pe.find(e=>e.ejercicioId==='4E2').x2===false && pe.find(e=>e.ejercicioId==='4E3').x2===true,'x2 llega al plan');
const ax=pe.find(e=>e.ejercicioId==='5A').asignacionId;
call('removeAssignment',{key,id:ax});
assert(call('addAssignment',{key,codigo:u3.codigo,ejercicioId:'5A',cantidad:8,unidad:'reps',series:3}).ok,'tras quitarlo, se puede volver a asignar');
const ord=call('adminData',{key}).data.catalogo.filter(e=>e.categoria===2&&!e.variante).map(e=>e.letra).join('');
assert(ord==='ABCDEFGHIJKLMNÑOPQRSTUVWXYZ','orden español en catálogo: '+ord);
// Ñ añadida a mano en la hoja (como hizo el usuario), al final de la tabla
sheets.Catalogo.d=sheets.Catalogo.d.filter(r=>r[0]!=='3Ñ'); sheets.Catalogo.d.push(['3Ñ','3','Ñ','','Ñandú','','TRUE']);
const o3=call('adminData',{key}).data.catalogo.filter(e=>e.categoria===3&&!e.variante).map(e=>e.letra).join('');
assert(o3==='ABCDEFGHIJKLMNÑOPQRSTUVWXYZ','Ñ añadida al final de la hoja sale en su sitio');
const vñ=call('addVariant',{key,baseId:'3ñ',nombre:'x'}).data; assert(vñ.id==='3Ñ1','variante de la Ñ (3Ñ1), aunque se escriba en minúscula');
// fila Ñ escrita a mano sin letra ni variante y con Ñ descompuesta (N + tilde combinada)
sheets.Catalogo.d.push(['5Ñ','5','','','Ñ a mano','','']);
sheets.Catalogo.d=sheets.Catalogo.d.filter(r=>r[0]!=='5Ñ');
const o5=call('adminData',{key}).data.catalogo.filter(e=>e.categoria===5&&!e.variante).map(e=>e.letra).join('');
assert(o5==='ABCDEFGHIJKLMNÑOPQRSTUVWXYZ','fila a mano sin letra y con Ñ descompuesta sale en su sitio: '+o5);
