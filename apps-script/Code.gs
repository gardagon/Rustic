/**
 * Rustic — backend en Google Apps Script.
 *
 * La Google Sheet es la base de datos. Este script se publica como
 * "Aplicación web" y la PWA le habla por HTTP (POST con JSON).
 *
 * Nomenclatura de ejercicios (la del entrenador):
 *   - Ejercicio base: número de categoría + letra A–Z.   Ej: 4E
 *   - Variante:       ejercicio base + número 1, 2, …     Ej: 4E1, 4E2
 *   setup() crea los 9 × 26 = 234 ejercicios base sin nombre; las variantes las añade el administrador.
 *   El nombre puede quedar vacío (p. ej. A, B y C, que el entrenador explica en clase).
 *
 * Pestañas (las crea setup()):
 *   Categorias   id | nombre
 *   Catalogo     id | categoria | letra | variante | nombre | video | activo
 *                (variante vacía = ejercicio base; 1, 2… = variante)
 *   Usuarios     codigo | nombre | activo
 *   Asignaciones id | codigo | ejercicioId | cantidad | unidad | series | orden | activo
 *                (ejercicioId puede ser un base, 4E, o una variante, 4E1)
 *   Registro     fecha | codigo | asignacionId | ejercicioId | serie | timestamp
 *
 * Puesta en marcha: ver README.md del repositorio.
 */

var NUM_CATEGORIAS = 9;
var LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
var UNIDADES = ['reps', 'seg', 'min'];
var TZ = 'Europe/Madrid';

var HEADERS = {
  Categorias: ['id', 'nombre'],
  Catalogo: ['id', 'categoria', 'letra', 'variante', 'nombre', 'video', 'activo'],
  Usuarios: ['codigo', 'nombre', 'activo'],
  Asignaciones: ['id', 'codigo', 'ejercicioId', 'cantidad', 'unidad', 'series', 'orden', 'activo'],
  Registro: ['fecha', 'codigo', 'asignacionId', 'ejercicioId', 'serie', 'timestamp']
};

/* ------------------------------------------------------------------ */
/*  SETUP: ejecutar UNA vez desde el editor de Apps Script             */
/* ------------------------------------------------------------------ */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });

  // IDs, códigos y fechas como texto, para que Sheets no los convierta en números o fechas.
  ss.getSheetByName('Catalogo').getRange('A:D').setNumberFormat('@');
  ['Usuarios', 'Asignaciones', 'Registro'].forEach(function (n) {
    ss.getSheetByName(n).getRange('A:C').setNumberFormat('@');
  });

  var cat = ss.getSheetByName('Categorias');
  if (cat.getLastRow() < 2) {
    var rows = [];
    for (var i = 1; i <= NUM_CATEGORIAS; i++) rows.push([i, 'Categoría ' + i]);
    cat.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  var catalogo = ss.getSheetByName('Catalogo');
  if (catalogo.getLastRow() < 2) {
    var ej = [];
    for (var c = 1; c <= NUM_CATEGORIAS; c++) {
      for (var l = 0; l < LETRAS.length; l++) {
        ej.push([c + LETRAS[l], String(c), LETRAS[l], '', '', '', 'TRUE']);
      }
    }
    catalogo.getRange(2, 1, ej.length, ej[0].length).setValues(ej);
  }

  // Quitar la "Hoja 1" vacía si existe.
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', randomCode_(10));
  }
  Logger.log('CLAVE DE ADMINISTRADOR: ' + props.getProperty('ADMIN_KEY'));
  Logger.log('Guárdala. Para cambiarla: Configuración del proyecto > Propiedades del script > ADMIN_KEY');
}

/* ------------------------------------------------------------------ */
/*  ENTRADA HTTP                                                       */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, app: 'rustic', mensaje: 'Backend activo' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    var fn = ACTIONS[req.action];
    if (!fn) throw new Error('Acción desconocida: ' + req.action);
    return json_({ ok: true, data: fn(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

var ACTIONS = {
  // --- Usuario ---
  getPlan: function (r) { return getPlan_(r.codigo); },
  logSet: function (r) { return withLock_(function () { return logSet_(r.codigo, r.asignacionId, r.serie); }); },
  unlogSet: function (r) { return withLock_(function () { return unlogSet_(r.codigo, r.asignacionId, r.serie); }); },

  // --- Administrador (todas exigen r.key) ---
  adminLogin: function (r) { requireAdmin_(r.key); return true; },
  adminData: function (r) { requireAdmin_(r.key); return adminData_(); },
  addUser: function (r) { requireAdmin_(r.key); return withLock_(function () { return addUser_(r.nombre); }); },
  updateExercise: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateExercise_(r.id, r.nombre, r.video); }); },
  addVariant: function (r) { requireAdmin_(r.key); return withLock_(function () { return addVariant_(r.baseId, r.nombre, r.video); }); },
  removeVariant: function (r) { requireAdmin_(r.key); return withLock_(function () { return removeVariant_(r.id); }); },
  renameCategory: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateRow_('Categorias', 'id', r.id, { nombre: r.nombre }); }); },
  addAssignment: function (r) { requireAdmin_(r.key); return withLock_(function () { return addAssignment_(r); }); },
  updateAssignment: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateAssignment_(r); }); },
  removeAssignment: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateRow_('Asignaciones', 'id', r.id, { activo: false }); }); }
};

/* ------------------------------------------------------------------ */
/*  CATÁLOGO                                                           */
/* ------------------------------------------------------------------ */

function readCatalog_() {
  return readTable_('Catalogo').filter(function (e) { return isActive_(e.activo); }).map(function (e) {
    return {
      id: normId_(e.id),
      categoria: Number(e.categoria),
      letra: String(e.letra).toUpperCase(),
      variante: e.variante === '' ? 0 : Number(e.variante),
      nombre: e.nombre || '',
      video: e.video || ''
    };
  });
}

// Describe un ejercicio o variante tal como lo ve el usuario.
function describe_(id, byId) {
  var e = byId[id];
  if (!e) return null;
  var base = e.variante ? byId[e.categoria + e.letra] : e;
  return {
    ejercicioId: e.id,
    categoria: e.categoria,
    letra: e.letra,
    variante: e.variante,
    nombre: base ? base.nombre : '',
    varianteNombre: e.variante ? e.nombre : '',
    // Una variante sin vídeo propio usa el del ejercicio base.
    video: e.video || (base ? base.video : '')
  };
}

function updateExercise_(id, nombre, video) {
  id = normId_(id);
  if (!readCatalog_().some(function (e) { return e.id === id; })) throw new Error('Ejercicio no encontrado: ' + id);
  // El nombre puede quedar vacío a propósito (ejercicios que se explican en clase).
  return updateRow_('Catalogo', 'id', id, { nombre: String(nombre || '').trim(), video: String(video || '').trim() });
}

function addVariant_(baseId, nombre, video) {
  baseId = normId_(baseId);
  var cat = readCatalog_();
  var base = cat.filter(function (e) { return e.id === baseId && !e.variante; })[0];
  if (!base) throw new Error('Ejercicio base no encontrado: ' + baseId);
  // Se cuentan también las variantes eliminadas para no reutilizar su número.
  var max = 0;
  readTable_('Catalogo').forEach(function (e) {
    if (Number(e.categoria) === base.categoria && String(e.letra).toUpperCase() === base.letra && e.variante !== '') {
      max = Math.max(max, Number(e.variante));
    }
  });
  var n = max + 1;
  var id = baseId + n;
  sheet_('Catalogo').appendRow([id, String(base.categoria), base.letra, String(n), String(nombre || '').trim(), String(video || '').trim(), 'TRUE']);
  return { id: id, categoria: base.categoria, letra: base.letra, variante: n, nombre: String(nombre || '').trim(), video: String(video || '').trim() };
}

function removeVariant_(id) {
  id = normId_(id);
  var v = readCatalog_().filter(function (e) { return e.id === id; })[0];
  if (!v || !v.variante) throw new Error('Solo se pueden eliminar variantes');
  var enUso = readTable_('Asignaciones').some(function (a) { return normId_(a.ejercicioId) === id && isActive_(a.activo); });
  if (enUso) throw new Error('Está asignada a algún usuario. Quítala de sus planes antes de eliminarla.');
  return updateRow_('Catalogo', 'id', id, { activo: false });
}

/* ------------------------------------------------------------------ */
/*  LÓGICA DE USUARIO                                                  */
/* ------------------------------------------------------------------ */

function getPlan_(codigo) {
  codigo = normCode_(codigo);
  var user = readTable_('Usuarios').filter(function (u) {
    return normCode_(u.codigo) === codigo && isActive_(u.activo);
  })[0];
  if (!user) throw new Error('Código no válido');

  var byId = indexById_(readCatalog_());
  var hoy = today_();
  var hechas = {};
  readTable_('Registro').forEach(function (r) {
    if (normCode_(r.codigo) === codigo && fmtDate_(r.fecha) === hoy) {
      (hechas[r.asignacionId] = hechas[r.asignacionId] || []).push(Number(r.serie));
    }
  });

  var ejercicios = [];
  readTable_('Asignaciones').forEach(function (a) {
    if (normCode_(a.codigo) !== codigo || !isActive_(a.activo)) return;
    var d = describe_(normId_(a.ejercicioId), byId);
    if (!d) return;
    d.asignacionId = a.id;
    d.cantidad = Number(a.cantidad);
    d.unidad = a.unidad;
    d.series = Number(a.series);
    d.hechas = hechas[a.id] || [];
    ejercicios.push(d);
  });
  ejercicios.sort(sortEj_);

  return {
    nombre: user.nombre,
    fecha: hoy,
    categorias: readTable_('Categorias').map(function (c) { return { id: Number(c.id), nombre: c.nombre }; }),
    ejercicios: ejercicios
  };
}

function logSet_(codigo, asignacionId, serie) {
  var a = findAssignmentFor_(codigo, asignacionId);
  serie = Number(serie);
  if (!(serie >= 1 && serie <= Number(a.series))) throw new Error('Serie fuera de rango');
  var hoy = today_();
  var ya = readTable_('Registro').some(function (r) {
    return r.asignacionId === asignacionId && fmtDate_(r.fecha) === hoy && Number(r.serie) === serie;
  });
  if (!ya) {
    sheet_('Registro').appendRow([hoy, normCode_(codigo), asignacionId, normId_(a.ejercicioId), serie, new Date()]);
  }
  return true;
}

function unlogSet_(codigo, asignacionId, serie) {
  findAssignmentFor_(codigo, asignacionId);
  var sh = sheet_('Registro');
  var values = sh.getDataRange().getValues();
  var hoy = today_();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][2] === asignacionId && fmtDate_(values[i][0]) === hoy && Number(values[i][4]) === Number(serie)) {
      sh.deleteRow(i + 1);
    }
  }
  return true;
}

function findAssignmentFor_(codigo, asignacionId) {
  var a = readTable_('Asignaciones').filter(function (x) { return x.id === asignacionId; })[0];
  if (!a || normCode_(a.codigo) !== normCode_(codigo)) throw new Error('Asignación no encontrada');
  return a;
}

/* ------------------------------------------------------------------ */
/*  LÓGICA DE ADMINISTRADOR                                            */
/* ------------------------------------------------------------------ */

function adminData_() {
  return {
    categorias: readTable_('Categorias').map(function (c) { return { id: Number(c.id), nombre: c.nombre }; }),
    unidades: UNIDADES,
    catalogo: readCatalog_().sort(sortEj_),
    usuarios: readTable_('Usuarios').filter(function (u) { return isActive_(u.activo); }).map(function (u) {
      return { codigo: u.codigo, nombre: u.nombre };
    }),
    asignaciones: readTable_('Asignaciones').filter(function (a) { return isActive_(a.activo); }).map(function (a) {
      return {
        id: a.id, codigo: a.codigo, ejercicioId: normId_(a.ejercicioId), cantidad: Number(a.cantidad),
        unidad: a.unidad, series: Number(a.series), orden: Number(a.orden) || 0
      };
    })
  };
}

function addUser_(nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre');
  var existentes = readTable_('Usuarios').map(function (u) { return normCode_(u.codigo); });
  var codigo;
  do { codigo = randomCode_(6); } while (existentes.indexOf(codigo) >= 0);
  sheet_('Usuarios').appendRow([codigo, nombre, true]);
  return { codigo: codigo, nombre: nombre };
}

function validateDose_(r) {
  if (UNIDADES.indexOf(r.unidad) < 0) throw new Error('Unidad no válida');
  var cantidad = Number(r.cantidad), series = Number(r.series);
  if (!(cantidad > 0) || !(series >= 1 && series <= 20)) throw new Error('Cantidad o series no válidas');
  return { cantidad: cantidad, series: series };
}

function addAssignment_(r) {
  var codigo = normCode_(r.codigo);
  var ejercicioId = normId_(r.ejercicioId);
  if (!readTable_('Usuarios').some(function (u) { return normCode_(u.codigo) === codigo; })) throw new Error('Usuario no encontrado');
  if (!readCatalog_().some(function (e) { return e.id === ejercicioId; })) throw new Error('Ejercicio no encontrado');
  var d = validateDose_(r);
  var orden = readTable_('Asignaciones').filter(function (a) { return normCode_(a.codigo) === codigo; }).length + 1;
  var id = 'A' + Date.now().toString(36).toUpperCase() + randomCode_(3);
  sheet_('Asignaciones').appendRow([id, codigo, ejercicioId, d.cantidad, r.unidad, d.series, orden, true]);
  return { id: id };
}

function updateAssignment_(r) {
  var d = validateDose_(r);
  var cambios = { cantidad: d.cantidad, unidad: r.unidad, series: d.series };
  if (r.ejercicioId) {
    // Permite cambiar de variante (4E → 4E2) sin quitar y volver a asignar.
    var nuevo = normId_(r.ejercicioId);
    if (!readCatalog_().some(function (e) { return e.id === nuevo; })) throw new Error('Ejercicio no encontrado');
    cambios.ejercicioId = nuevo;
  }
  return updateRow_('Asignaciones', 'id', r.id, cambios);
}

/* ------------------------------------------------------------------ */
/*  UTILIDADES                                                         */
/* ------------------------------------------------------------------ */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Falta la pestaña ' + name + '. Ejecuta setup().');
  return sh;
}

function readTable_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var head = values.shift();
  return values.filter(function (row) { return row.join('') !== ''; }).map(function (row) {
    var o = {};
    head.forEach(function (h, i) { o[h] = typeof row[i] === 'string' ? row[i].trim() : row[i]; });
    return o;
  });
}

function updateRow_(name, keyCol, keyVal, cambios) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var k = head.indexOf(keyCol);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][k]).toUpperCase() === String(keyVal).toUpperCase()) {
      Object.keys(cambios || {}).forEach(function (col) {
        var c = head.indexOf(col);
        if (c >= 0 && col !== keyCol) sh.getRange(i + 1, c + 1).setValue(cambios[col]);
      });
      return true;
    }
  }
  throw new Error('No encontrado: ' + keyVal);
}

function indexById_(arr) {
  var o = {};
  arr.forEach(function (x) { o[x.id] = x; });
  return o;
}

function sortEj_(a, b) {
  return a.categoria - b.categoria || (a.letra < b.letra ? -1 : a.letra > b.letra ? 1 : 0) || a.variante - b.variante;
}

function requireAdmin_(key) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!real || key !== real) throw new Error('Clave de administrador incorrecta');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function isActive_(v) { return v === '' || v === true || String(v).toUpperCase() === 'TRUE'; }
function normCode_(c) { return String(c || '').trim().toUpperCase(); }
function normId_(c) { return String(c || '').trim().toUpperCase(); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v); }

function randomCode_(n) {
  // Sin 0/O ni 1/I para que no se confundan al teclearlos.
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
