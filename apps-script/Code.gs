/**
 * Rustic — backend en Google Apps Script.
 *
 * La Google Sheet es la base de datos. Este script se publica como
 * "Aplicación web" y la PWA le habla por HTTP (POST con JSON).
 *
 * Nomenclatura de ejercicios (la del entrenador):
 *   - Ejercicio base: número de categoría + letra A–Z (con Ñ).   Ej: 4E
 *   - Variante:       ejercicio base + número 1, 2, …     Ej: 4E1, 4E2
 *   setup() crea los 9 × 27 = 243 ejercicios base sin nombre; las variantes las añade el administrador.
 *   El nombre puede quedar vacío (p. ej. A, B y C, que el entrenador explica en clase).
 *
 * Pestañas (las crea setup()):
 *   Categorias   id | nombre
 *   Catalogo     id | categoria | letra | variante | nombre | video | activo
 *                (variante vacía = ejercicio base; 1, 2… = variante)
 *   Usuarios     codigo | nombre | activo
 *   Planes       id | codigo | nombre | inicio | fin
 *                (una planificación por bloque; fin vacío = la vigente. Solo hay una vigente por usuario.)
 *   Asignaciones id | codigo | ejercicioId | cantidad | unidad | series | x2 | orden | activo | planId
 *                (ejercicioId puede ser un base, 4E, o una variante, 4E1.
 *                 x2 = TRUE: una repetición cuenta al hacerla con ambos lados, o ida y vuelta.
 *                 Un mismo ejercicioId no puede repetirse dentro de una planificación.)
 *   Registro     fecha | codigo | asignacionId | ejercicioId | serie | timestamp | planId | cantidad | unidad | series | x2
 *                (cada serie hecha guarda también lo que estaba prescrito ese día, para que el histórico
 *                 no cambie aunque luego se edite la planificación)
 *
 * Las columnas se localizan por su cabecera, no por su posición: se pueden añadir columnas al final.
 *
 * Puesta en marcha: ver README.md del repositorio.
 */

var NUM_CATEGORIAS = 9;
// Alfabeto español: la Ñ va entre la N y la O. El orden de la app sale de aquí.
var LETRAS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
var UNIDADES = ['reps', 'seg', 'min'];
var TZ = 'Europe/Madrid';

var HEADERS = {
  Categorias: ['id', 'nombre'],
  Catalogo: ['id', 'categoria', 'letra', 'variante', 'nombre', 'video', 'activo'],
  Usuarios: ['codigo', 'nombre', 'activo'],
  Planes: ['id', 'codigo', 'nombre', 'inicio', 'fin'],
  Asignaciones: ['id', 'codigo', 'ejercicioId', 'cantidad', 'unidad', 'series', 'x2', 'orden', 'activo', 'planId'],
  Registro: ['fecha', 'codigo', 'asignacionId', 'ejercicioId', 'serie', 'timestamp', 'planId', 'cantidad', 'unidad', 'series', 'x2']
};

/* ------------------------------------------------------------------ */
/*  SETUP: se puede ejecutar las veces que haga falta.                 */
/*  Solo crea lo que falta y migra datos antiguos; nunca borra nada.   */
/* ------------------------------------------------------------------ */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // Pestaña ya existente: añadir al final las columnas nuevas que falten.
      var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      HEADERS[name].forEach(function (h) {
        if (head.indexOf(h) < 0) {
          head.push(h);
          sh.getRange(1, head.length).setValue(h).setFontWeight('bold');
        }
      });
    }
  });

  // IDs, códigos y fechas como texto, para que Sheets no los convierta en números o fechas.
  textColumns_('Catalogo', ['id', 'categoria', 'letra', 'variante']);
  textColumns_('Usuarios', ['codigo']);
  textColumns_('Planes', ['id', 'codigo', 'inicio', 'fin']);
  textColumns_('Asignaciones', ['id', 'codigo', 'ejercicioId', 'planId']);
  textColumns_('Registro', ['fecha', 'codigo', 'asignacionId', 'ejercicioId', 'planId']);

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

  migrarAPlanes_();

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

function textColumns_(name, cols) {
  var sh = sheet_(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  cols.forEach(function (c) {
    var i = head.indexOf(c);
    if (i >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

// Datos anteriores a las planificaciones: las asignaciones sin planId pasan a una
// "Planificación inicial" por usuario, que empieza el primer día con registro.
function migrarAPlanes_() {
  var asig = readTable_('Asignaciones');
  var sinPlan = asig.filter(function (a) { return !a.planId; });
  if (!sinPlan.length) return;
  var registro = readTable_('Registro');
  var porUsuario = {};
  sinPlan.forEach(function (a) { (porUsuario[normCode_(a.codigo)] = porUsuario[normCode_(a.codigo)] || []).push(a); });
  Object.keys(porUsuario).forEach(function (codigo) {
    var plan = currentPlan_(codigo, false);
    if (!plan) {
      var inicio = today_();
      registro.forEach(function (r) {
        if (normCode_(r.codigo) === codigo && fmtDate_(r.fecha) < inicio) inicio = fmtDate_(r.fecha);
      });
      plan = createPlan_(codigo, 'Planificación inicial', inicio);
    }
    porUsuario[codigo].forEach(function (a) { updateRow_('Asignaciones', 'id', a.id, { planId: plan.id }); });
  });
  Logger.log('Migradas ' + sinPlan.length + ' asignaciones a planificaciones.');
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
  getHistory: function (r) { requireUser_(r.codigo); return getHistory_(r.codigo); },

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
  removeAssignment: function (r) { requireAdmin_(r.key); return withLock_(function () { return updateRow_('Asignaciones', 'id', r.id, { activo: false }); }); },
  newPlan: function (r) { requireAdmin_(r.key); return withLock_(function () { return newPlan_(r.codigo, r.nombre, r.copiar); }); },
  renamePlan: function (r) { requireAdmin_(r.key); return withLock_(function () { return renamePlan_(r.id, r.nombre); }); },
  adminHistory: function (r) { requireAdmin_(r.key); return getHistory_(r.codigo); }
};

/* ------------------------------------------------------------------ */
/*  CATÁLOGO                                                           */
/* ------------------------------------------------------------------ */

// Las partes del ID: 4Ñ1 → categoría 4, letra Ñ, variante 1.
function parseId_(id) {
  var m = normId_(id).match(/^(\d+)([^\d])(\d*)$/);
  return m ? { categoria: Number(m[1]), letra: m[2], variante: m[3] ? Number(m[3]) : 0 } : null;
}

// conInactivos: el histórico necesita también las variantes ya eliminadas.
function readCatalog_(conInactivos) {
  return readTable_('Catalogo').filter(function (e) { return (conInactivos || isActive_(e.activo)) && normId_(e.id); }).map(function (e) {
    // Si una fila se añadió a mano y le falta algún dato, se deduce del ID.
    var p = parseId_(e.id) || {};
    return {
      id: normId_(e.id),
      categoria: Number(e.categoria) || p.categoria,
      letra: normId_(e.letra) || p.letra || '',
      variante: e.variante === '' ? (p.variante || 0) : Number(e.variante),
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
  appendObj_('Catalogo', { id: id, categoria: String(base.categoria), letra: base.letra, variante: String(n),
    nombre: String(nombre || '').trim(), video: String(video || '').trim(), activo: 'TRUE' });
  return { id: id, categoria: base.categoria, letra: base.letra, variante: n, nombre: String(nombre || '').trim(), video: String(video || '').trim() };
}

function removeVariant_(id) {
  id = normId_(id);
  var v = readCatalog_().filter(function (e) { return e.id === id; })[0];
  if (!v || !v.variante) throw new Error('Solo se pueden eliminar variantes');
  var vigentes = vigentPlanIds_();
  var enUso = readTable_('Asignaciones').some(function (a) {
    return normId_(a.ejercicioId) === id && isActive_(a.activo) && vigentes[a.planId];
  });
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

  var plan = currentPlan_(codigo, false);
  var ejercicios = [];
  readTable_('Asignaciones').forEach(function (a) {
    if (!plan || a.planId !== plan.id || !isActive_(a.activo)) return;
    var d = describe_(normId_(a.ejercicioId), byId);
    if (!d) return;
    d.asignacionId = a.id;
    d.cantidad = Number(a.cantidad);
    d.unidad = a.unidad;
    d.series = Number(a.series);
    d.x2 = isTrue_(a.x2);
    d.hechas = hechas[a.id] || [];
    ejercicios.push(d);
  });
  ejercicios.sort(sortEj_);

  return {
    nombre: user.nombre,
    fecha: hoy,
    plan: plan ? { id: plan.id, nombre: plan.nombre, inicio: plan.inicio } : null,
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
    appendObj_('Registro', {
      fecha: hoy, codigo: normCode_(codigo), asignacionId: asignacionId, ejercicioId: normId_(a.ejercicioId),
      serie: serie, timestamp: new Date(),
      // Lo prescrito ese día: el histórico no cambia aunque luego se edite la planificación.
      planId: a.planId, cantidad: Number(a.cantidad), unidad: a.unidad, series: Number(a.series), x2: isTrue_(a.x2)
    });
  }
  return true;
}

function unlogSet_(codigo, asignacionId, serie) {
  findAssignmentFor_(codigo, asignacionId);
  var sh = sheet_('Registro');
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var cA = head.indexOf('asignacionId'), cF = head.indexOf('fecha'), cS = head.indexOf('serie');
  var hoy = today_();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][cA] === asignacionId && fmtDate_(values[i][cF]) === hoy && Number(values[i][cS]) === Number(serie)) {
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
  var vigentes = vigentPlanIds_();
  return {
    categorias: readTable_('Categorias').map(function (c) { return { id: Number(c.id), nombre: c.nombre }; }),
    unidades: UNIDADES,
    catalogo: readCatalog_().sort(sortEj_),
    usuarios: readTable_('Usuarios').filter(function (u) { return isActive_(u.activo); }).map(function (u) {
      return { codigo: u.codigo, nombre: u.nombre };
    }),
    // Solo las de la planificación vigente: las de planificaciones cerradas son histórico.
    asignaciones: readTable_('Asignaciones').filter(function (a) { return isActive_(a.activo) && vigentes[a.planId]; }).map(function (a) {
      return {
        id: a.id, codigo: a.codigo, planId: a.planId, ejercicioId: normId_(a.ejercicioId), cantidad: Number(a.cantidad),
        unidad: a.unidad, series: Number(a.series), x2: isTrue_(a.x2), orden: Number(a.orden) || 0
      };
    }),
    planes: readPlanes_()
  };
}

function addUser_(nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre');
  var existentes = readTable_('Usuarios').map(function (u) { return normCode_(u.codigo); });
  var codigo;
  do { codigo = randomCode_(6); } while (existentes.indexOf(codigo) >= 0);
  appendObj_('Usuarios', { codigo: codigo, nombre: nombre, activo: true });
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
  var plan = currentPlan_(codigo, true);
  checkNotInPlan_(plan.id, ejercicioId, null);
  var orden = readTable_('Asignaciones').filter(function (a) { return a.planId === plan.id; }).length + 1;
  var id = newAssignmentId_();
  appendObj_('Asignaciones', { id: id, codigo: codigo, ejercicioId: ejercicioId, cantidad: d.cantidad, unidad: r.unidad,
    series: d.series, x2: !!r.x2, orden: orden, activo: true, planId: plan.id });
  return { id: id, planId: plan.id };
}

function updateAssignment_(r) {
  var d = validateDose_(r);
  var cambios = { cantidad: d.cantidad, unidad: r.unidad, series: d.series, x2: !!r.x2 };
  if (r.ejercicioId) {
    // Permite cambiar de variante (4E → 4E2) sin quitar y volver a asignar.
    var nuevo = normId_(r.ejercicioId);
    if (!readCatalog_().some(function (e) { return e.id === nuevo; })) throw new Error('Ejercicio no encontrado');
    var actual = readTable_('Asignaciones').filter(function (a) { return a.id === r.id; })[0];
    if (!actual) throw new Error('No encontrado: ' + r.id);
    checkNotInPlan_(actual.planId, nuevo, r.id);
    cambios.ejercicioId = nuevo;
  }
  return updateRow_('Asignaciones', 'id', r.id, cambios);
}

function checkNotInPlan_(planId, ejercicioId, exceptId) {
  var dup = readTable_('Asignaciones').some(function (a) {
    return a.id !== exceptId && isActive_(a.activo) && a.planId === planId && normId_(a.ejercicioId) === ejercicioId;
  });
  if (dup) throw new Error(ejercicioId + ' ya está en este plan. Edítalo en lugar de añadirlo otra vez.');
}

function newAssignmentId_() { return 'A' + Date.now().toString(36).toUpperCase() + randomCode_(3); }

/* ------------------------------------------------------------------ */
/*  PLANIFICACIONES                                                    */
/* ------------------------------------------------------------------ */

function readPlanes_() {
  return readTable_('Planes').map(function (p) {
    return { id: p.id, codigo: normCode_(p.codigo), nombre: p.nombre, inicio: fmtDate_(p.inicio), fin: p.fin ? fmtDate_(p.fin) : '' };
  });
}

function vigentPlanIds_() {
  var o = {};
  readPlanes_().forEach(function (p) { if (!p.fin) o[p.id] = true; });
  return o;
}

// La planificación vigente de un usuario; con crear=true, se crea si no tiene ninguna.
function currentPlan_(codigo, crear) {
  codigo = normCode_(codigo);
  var vig = readPlanes_().filter(function (p) { return p.codigo === codigo && !p.fin; });
  vig.sort(function (a, b) { return a.inicio < b.inicio ? 1 : -1; });
  if (vig[0]) return vig[0];
  return crear ? createPlan_(codigo, 'Planificación ' + fechaCorta_(today_()), today_()) : null;
}

function createPlan_(codigo, nombre, inicio) {
  var p = { id: 'P' + Date.now().toString(36).toUpperCase() + randomCode_(3), codigo: normCode_(codigo),
    nombre: String(nombre || '').trim() || 'Planificación ' + fechaCorta_(inicio), inicio: inicio, fin: '' };
  appendObj_('Planes', p);
  return p;
}

// Cierra la planificación vigente (fin = hoy) y abre una nueva desde hoy.
// copiar=true: la nueva empieza con los mismos ejercicios, para retocar solo lo que cambie.
function newPlan_(codigo, nombre, copiar) {
  codigo = normCode_(codigo);
  if (!readTable_('Usuarios').some(function (u) { return normCode_(u.codigo) === codigo; })) throw new Error('Usuario no encontrado');
  var hoy = today_();
  var anterior = currentPlan_(codigo, false);
  if (anterior) updateRow_('Planes', 'id', anterior.id, { fin: hoy });
  var plan = createPlan_(codigo, nombre, hoy);
  var copiados = 0;
  if (anterior && copiar) {
    readTable_('Asignaciones').forEach(function (a) {
      if (a.planId !== anterior.id || !isActive_(a.activo)) return;
      appendObj_('Asignaciones', { id: newAssignmentId_(), codigo: codigo, ejercicioId: normId_(a.ejercicioId),
        cantidad: Number(a.cantidad), unidad: a.unidad, series: Number(a.series), x2: isTrue_(a.x2),
        orden: Number(a.orden) || 0, activo: true, planId: plan.id });
      copiados++;
    });
  }
  return { id: plan.id, nombre: plan.nombre, inicio: plan.inicio, copiados: copiados };
}

function renamePlan_(id, nombre) {
  nombre = String(nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre');
  return updateRow_('Planes', 'id', id, { nombre: nombre });
}

/* ------------------------------------------------------------------ */
/*  HISTÓRICO                                                          */
/* ------------------------------------------------------------------ */

// Planificaciones del usuario (la más reciente primero), cada una con lo prescrito
// y los días entrenados: qué series se hicieron de cada ejercicio.
function getHistory_(codigo) {
  codigo = normCode_(codigo);
  var byId = indexById_(readCatalog_(true));
  var planes = readPlanes_().filter(function (p) { return p.codigo === codigo; });
  var asig = readTable_('Asignaciones').filter(function (a) { return normCode_(a.codigo) === codigo; });
  var asigById = {};
  asig.forEach(function (a) { asigById[a.id] = a; });

  var out = {};
  planes.forEach(function (p) {
    var ej = asig.filter(function (a) { return a.planId === p.id && isActive_(a.activo); }).map(function (a) {
      var d = describe_(normId_(a.ejercicioId), byId) || { ejercicioId: normId_(a.ejercicioId), categoria: 0, letra: '', variante: 0, nombre: '', varianteNombre: '' };
      d.cantidad = Number(a.cantidad); d.unidad = a.unidad; d.series = Number(a.series); d.x2 = isTrue_(a.x2);
      return d;
    }).sort(sortEj_);
    out[p.id] = { id: p.id, nombre: p.nombre, inicio: p.inicio, fin: p.fin, ejercicios: ej,
      seriesPorDia: ej.reduce(function (s, e) { return s + e.series; }, 0), dias: {} };
  });

  readTable_('Registro').forEach(function (r) {
    if (normCode_(r.codigo) !== codigo) return;
    var a = asigById[r.asignacionId] || {};
    var plan = out[r.planId || a.planId];
    if (!plan) return;
    var fecha = fmtDate_(r.fecha);
    var dia = plan.dias[fecha] = plan.dias[fecha] || {};
    var key = r.asignacionId;
    if (!dia[key]) {
      var d = describe_(normId_(r.ejercicioId), byId) || { ejercicioId: normId_(r.ejercicioId), categoria: 0, letra: '', variante: 0, nombre: '', varianteNombre: '' };
      // Lo prescrito ese día; los registros antiguos sin esa copia usan la asignación.
      d.cantidad = Number(r.cantidad !== '' && r.cantidad != null ? r.cantidad : a.cantidad);
      d.unidad = r.unidad || a.unidad;
      d.series = Number(r.series !== '' && r.series != null ? r.series : a.series);
      d.x2 = r.x2 !== '' && r.x2 != null ? isTrue_(r.x2) : isTrue_(a.x2);
      d.hechas = 0;
      dia[key] = d;
    }
    dia[key].hechas++;
  });

  return Object.keys(out).map(function (k) {
    var p = out[k];
    p.dias = Object.keys(p.dias).sort().reverse().map(function (fecha) {
      var items = Object.keys(p.dias[fecha]).map(function (k2) { return p.dias[fecha][k2]; }).sort(sortEj_);
      return { fecha: fecha, items: items, hechas: items.reduce(function (s, i) { return s + i.hechas; }, 0) };
    });
    return p;
  }).sort(function (a, b) { return a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0; });
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

// Añade una fila colocando cada valor bajo su cabecera (el orden de columnas da igual).
function appendObj_(name, obj) {
  var sh = sheet_(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
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

function letraIdx_(l) {
  var i = LETRAS.indexOf(l);
  return i < 0 ? 100 + String(l).charCodeAt(0) : i; // letras fuera del alfabeto, al final
}

function sortEj_(a, b) {
  return a.categoria - b.categoria || letraIdx_(a.letra) - letraIdx_(b.letra) || a.variante - b.variante;
}

function requireUser_(codigo) {
  var ok = readTable_('Usuarios').some(function (u) { return normCode_(u.codigo) === normCode_(codigo) && isActive_(u.activo); });
  if (!ok) throw new Error('Código no válido');
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

function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function isActive_(v) { return v === '' || v === true || String(v).toUpperCase() === 'TRUE'; }
function normCode_(c) { return String(c || '').trim().toUpperCase(); }
function normId_(c) { return String(c || '').trim().normalize('NFC').toUpperCase(); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function fechaCorta_(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
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
