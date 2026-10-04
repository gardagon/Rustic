/**
 * Rustic — backend en Google Apps Script.
 *
 * La Google Sheet es la base de datos. Este script se publica como
 * "Aplicación web" y la PWA le habla por HTTP (POST con JSON).
 *
 * Pestañas (las crea setup()):
 *   Categorias   id | nombre                       (9 filas, editables)
 *   Variantes    nombre                            (lista de valores permitidos)
 *   Catalogo     id | categoria | nombre | video | activo
 *   Usuarios     codigo | nombre | activo
 *   Asignaciones id | codigo | ejercicioId | cantidad | unidad | series | variante | orden | activo
 *   Registro     fecha | codigo | asignacionId | ejercicioId | serie | timestamp
 *
 * Puesta en marcha: ver README.md del repositorio.
 */

var NUM_CATEGORIAS = 9;
var UNIDADES = ['reps', 'seg', 'min'];
var TZ = 'Europe/Madrid';

var HEADERS = {
  Categorias: ['id', 'nombre'],
  Variantes: ['nombre'],
  Catalogo: ['id', 'categoria', 'nombre', 'video', 'activo'],
  Usuarios: ['codigo', 'nombre', 'activo'],
  Asignaciones: ['id', 'codigo', 'ejercicioId', 'cantidad', 'unidad', 'series', 'variante', 'orden', 'activo'],
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

  var cat = ss.getSheetByName('Categorias');
  if (cat.getLastRow() < 2) {
    var rows = [];
    for (var i = 1; i <= NUM_CATEGORIAS; i++) rows.push([i, 'Categoría ' + i]);
    cat.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  var vari = ss.getSheetByName('Variantes');
  if (vari.getLastRow() < 2) {
    vari.getRange(2, 1, 3, 1).setValues([['Normal'], ['Variante A'], ['Variante B']]);
  }

  // IDs y códigos como texto, para que Sheets no los convierta en números o fechas.
  ['Catalogo', 'Usuarios', 'Asignaciones', 'Registro'].forEach(function (n) {
    ss.getSheetByName(n).getRange('A:C').setNumberFormat('@');
  });

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
  addExercise: function (r) { requireAdmin_(r.key); return withLock_(function () { return addExercise_(r.categoria, r.nombre, r.video); }); },
  updateExercise: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateRow_('Catalogo', 'id', r.id, r.cambios); }); },
  renameCategory: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateRow_('Categorias', 'id', r.id, { nombre: r.nombre }); }); },
  addAssignment: function (r) { requireAdmin_(r.key); return withLock_(function () { return addAssignment_(r); }); },
  removeAssignment: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateRow_('Asignaciones', 'id', r.id, { activo: false }); }); }
};

/* ------------------------------------------------------------------ */
/*  LÓGICA DE USUARIO                                                  */
/* ------------------------------------------------------------------ */

function getPlan_(codigo) {
  codigo = normCode_(codigo);
  var user = readTable_('Usuarios').filter(function (u) {
    return normCode_(u.codigo) === codigo && isActive_(u.activo);
  })[0];
  if (!user) throw new Error('Código no válido');

  var catalogo = indexBy_(readTable_('Catalogo'), 'id');
  var asignaciones = readTable_('Asignaciones').filter(function (a) {
    return normCode_(a.codigo) === codigo && isActive_(a.activo) && catalogo[a.ejercicioId];
  });

  var hoy = today_();
  var hechas = {};
  readTable_('Registro').forEach(function (r) {
    if (normCode_(r.codigo) === codigo && fmtDate_(r.fecha) === hoy) {
      (hechas[r.asignacionId] = hechas[r.asignacionId] || []).push(Number(r.serie));
    }
  });

  return {
    nombre: user.nombre,
    fecha: hoy,
    categorias: readTable_('Categorias').map(function (c) { return { id: Number(c.id), nombre: c.nombre }; }),
    ejercicios: asignaciones.map(function (a) {
      var ej = catalogo[a.ejercicioId];
      return {
        asignacionId: a.id,
        ejercicioId: a.ejercicioId,
        categoria: Number(ej.categoria),
        nombre: ej.nombre,
        video: ej.video || '',
        cantidad: Number(a.cantidad),
        unidad: a.unidad,
        series: Number(a.series),
        variante: a.variante || '',
        orden: Number(a.orden) || 0,
        hechas: hechas[a.id] || []
      };
    }).sort(function (x, y) { return x.categoria - y.categoria || x.orden - y.orden; })
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
    sheet_('Registro').appendRow([hoy, normCode_(codigo), asignacionId, a.ejercicioId, serie, new Date()]);
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
    variantes: readTable_('Variantes').map(function (v) { return v.nombre; }).filter(String),
    unidades: UNIDADES,
    catalogo: readTable_('Catalogo').filter(function (e) { return isActive_(e.activo); }).map(function (e) {
      return { id: e.id, categoria: Number(e.categoria), nombre: e.nombre, video: e.video || '' };
    }),
    usuarios: readTable_('Usuarios').filter(function (u) { return isActive_(u.activo); }).map(function (u) {
      return { codigo: u.codigo, nombre: u.nombre };
    }),
    asignaciones: readTable_('Asignaciones').filter(function (a) { return isActive_(a.activo); }).map(function (a) {
      return {
        id: a.id, codigo: a.codigo, ejercicioId: a.ejercicioId, cantidad: Number(a.cantidad),
        unidad: a.unidad, series: Number(a.series), variante: a.variante, orden: Number(a.orden) || 0
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

function addExercise_(categoria, nombre, video) {
  categoria = Number(categoria);
  nombre = String(nombre || '').trim();
  if (!(categoria >= 1 && categoria <= NUM_CATEGORIAS)) throw new Error('Categoría no válida');
  if (!nombre) throw new Error('Falta el nombre del ejercicio');
  // ID: número de categoría + "-" + correlativo de 3 cifras. Ej: 3-007.
  // Solo dígitos y guion: no depende de mayúsculas/minúsculas.
  var max = 0;
  readTable_('Catalogo').forEach(function (e) {
    var p = String(e.id).split('-');
    if (Number(p[0]) === categoria) max = Math.max(max, Number(p[1]) || 0);
  });
  var id = categoria + '-' + ('00' + (max + 1)).slice(-3);
  sheet_('Catalogo').appendRow([id, categoria, nombre, String(video || '').trim(), true]);
  return { id: id, categoria: categoria, nombre: nombre, video: video || '' };
}

function addAssignment_(r) {
  var codigo = normCode_(r.codigo);
  if (!readTable_('Usuarios').some(function (u) { return normCode_(u.codigo) === codigo; })) throw new Error('Usuario no encontrado');
  if (!readTable_('Catalogo').some(function (e) { return e.id === r.ejercicioId; })) throw new Error('Ejercicio no encontrado');
  if (UNIDADES.indexOf(r.unidad) < 0) throw new Error('Unidad no válida');
  var cantidad = Number(r.cantidad), series = Number(r.series);
  if (!(cantidad > 0) || !(series >= 1 && series <= 20)) throw new Error('Cantidad o series no válidas');
  var orden = readTable_('Asignaciones').filter(function (a) { return normCode_(a.codigo) === codigo; }).length + 1;
  var id = 'A' + Date.now().toString(36).toUpperCase();
  sheet_('Asignaciones').appendRow([id, codigo, r.ejercicioId, cantidad, r.unidad, series, r.variante || '', orden, true]);
  return { id: id };
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
    if (String(values[i][k]) === String(keyVal)) {
      Object.keys(cambios || {}).forEach(function (col) {
        var c = head.indexOf(col);
        if (c >= 0 && col !== keyCol) sh.getRange(i + 1, c + 1).setValue(cambios[col]);
      });
      return true;
    }
  }
  throw new Error('No encontrado: ' + keyVal);
}

function indexBy_(arr, key) {
  var o = {};
  arr.forEach(function (x) { if (isActive_(x.activo)) o[x[key]] = x; });
  return o;
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
