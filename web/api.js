// Capa de datos. Mismas acciones en el backend real (Apps Script) y en el modo demo.
// Si añades o cambias una acción, hazlo en apps-script/Code.gs y aquí.
(function () {
  const URL = (window.RUSTIC_CONFIG || {}).API_URL || '';
  const DEMO = !URL;

  async function remote(action, params = {}) {
    // text/plain evita la petición previa CORS, que Apps Script no admite.
    let res, json;
    try {
      res = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...params })
      });
    } catch {
      throw new Error('Sin conexión con el servidor. Comprueba tu internet.');
    }
    try { json = await res.json(); }
    catch { throw new Error('El servidor no responde bien (' + res.status + '). Revisa la implementación de Apps Script.'); }
    if (!json.ok) throw new Error(json.error || 'Error del servidor');
    return json.data;
  }

  /* ---------------- MODO DEMO ---------------- */
  const KEY = 'rustic-demo-db-v5';
  const UNIDADES = ['reps', 'seg', 'min'];
  const LETRAS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('');
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const fechaCorta = iso => iso.split('-').reverse().join('/');
  const nid = s => String(s || '').trim().normalize('NFC').toUpperCase();
  const letraIdx = l => { const i = LETRAS.indexOf(l); return i < 0 ? 100 + l.charCodeAt(0) : i; };
  const sortEj = (a, b) => a.categoria - b.categoria || letraIdx(a.letra) - letraIdx(b.letra) || a.variante - b.variante;

  // Datos de ejemplo: una planificación cerrada con días entrenados y la vigente.
  function seed() {
    const categorias = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, nombre: 'Categoría ' + (i + 1) }));
    const catalogo = [];
    for (let c = 1; c <= 9; c++) LETRAS.forEach(l => catalogo.push({ id: c + l, categoria: c, letra: l, variante: 0, nombre: '', video: '', activo: true }));
    const nombre = (id, n) => (catalogo.find(e => e.id === id).nombre = n);
    nombre('1D', 'Sentadilla'); nombre('1E', 'Zancada'); nombre('2D', 'Flexiones');
    nombre('3D', 'Plancha'); nombre('3E', 'Dead bug'); nombre('5A', 'Superman'); nombre('4E', 'Remo anillas');
    catalogo.push({ id: '4E1', categoria: 4, letra: 'E', variante: 1, nombre: 'Anilla al pecho', video: '', activo: true });
    catalogo.push({ id: '4E2', categoria: 4, letra: 'E', variante: 2, nombre: 'Anilla a la cadera', video: '', activo: true });
    const hoy = today(), inicioVig = addDays(hoy, -6), inicioAnt = addDays(hoy, -34);
    const planes = [
      { id: 'P0', codigo: 'DEMO', nombre: 'Planificación de prueba anterior', inicio: inicioAnt, fin: addDays(inicioVig, -1) },
      { id: 'P1', codigo: 'DEMO', nombre: 'Planificación ' + fechaCorta(inicioVig), inicio: inicioVig, fin: '' }
    ];
    const a = (id, planId, ej, cantidad, unidad, series, x2 = false) =>
      ({ id, codigo: 'DEMO', planId, ejercicioId: ej, cantidad, unidad, series, x2, activo: true });
    const asignaciones = [
      a('B1', 'P0', '1D', 10, 'reps', 3), a('B2', 'P0', '3D', 30, 'seg', 3), a('B3', 'P0', '4E1', 8, 'reps', 3, true),
      a('A1', 'P1', '1A', 5, 'min', 1), a('A2', 'P1', '1D', 12, 'reps', 3), a('A3', 'P1', '2D', 10, 'reps', 4),
      a('A4', 'P1', '3D', 45, 'seg', 3), a('A7', 'P1', '5A', 8, 'reps', 3, true),
      a('A5', 'P1', '4E1', 10, 'reps', 3, true), a('A6', 'P1', '4E2', 8, 'reps', 2)
    ];
    const registro = [];
    const hecho = (fecha, asig, n) => {
      const x = asignaciones.find(y => y.id === asig);
      for (let s = 1; s <= n; s++) registro.push({ fecha, codigo: 'DEMO', asignacionId: asig, ejercicioId: x.ejercicioId, serie: s,
        planId: x.planId, cantidad: x.cantidad, unidad: x.unidad, series: x.series, x2: x.x2 });
    };
    [-30, -27, -23, -20, -16, -13, -9].forEach((d, i) => { hecho(addDays(hoy, d), 'B1', 3); hecho(addDays(hoy, d), 'B2', i % 3 ? 3 : 2); hecho(addDays(hoy, d), 'B3', 3); });
    [-5, -2].forEach(d => ['A1', 'A2', 'A3', 'A4', 'A7', 'A5'].forEach(id => hecho(addDays(hoy, d), id, asignaciones.find(y => y.id === id).series)));
    return { categorias, catalogo, usuarios: [{ codigo: 'DEMO', nombre: 'Ana' }], planes, asignaciones, registro };
  }
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
  const save = db => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const code = n => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const admin = k => { if (k !== 'admin') throw new Error('Clave de administrador incorrecta (en demo es "admin")'); };
  const active = db => db.catalogo.filter(e => e.activo);
  const dose = r => {
    if (!UNIDADES.includes(r.unidad)) throw new Error('Unidad no válida');
    if (!(+r.cantidad > 0) || !(+r.series >= 1 && +r.series <= 20)) throw new Error('Cantidad o series no válidas');
  };
  // Planificaciones: de inicio a fin (fin vacío = sin fecha de fin). Igual que en Code.gs.
  const terminada = (p, dia) => !!p.fin && p.fin < dia;
  const enCurso = (p, dia) => p.inicio <= dia && !terminada(p, dia);
  // La más reciente primero; a igual inicio, la creada después.
  const planesDe = (db, codigo) => db.planes.map((p, n) => ({ p, n })).filter(x => nid(x.p.codigo) === nid(codigo))
    .sort((a, b) => (a.p.inicio < b.p.inicio ? 1 : a.p.inicio > b.p.inicio ? -1 : b.n - a.n)).map(x => x.p);
  const newPlanObj = (codigo, nombre, inicio, fin) => ({ id: 'P' + Date.now().toString(36).toUpperCase() + code(3), codigo: nid(codigo),
    nombre: String(nombre || '').trim() || 'Planificación ' + fechaCorta(inicio), inicio, fin: fin || '' });
  // La que edita el administrador: la más reciente que no ha terminado.
  const currentPlan = (db, codigo, crear) => {
    const p = planesDe(db, codigo).find(x => !terminada(x, today()));
    if (p || !crear) return p || null;
    const n = newPlanObj(codigo, '', today(), '');
    db.planes.push(n); return n;
  };
  const vigentes = db => new Set(db.planes.filter(p => !terminada(p, today())).map(p => p.id));
  const isoOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  const checkFechas = (inicio, fin) => {
    if (!isoOk(inicio)) throw new Error('Fecha de inicio no válida');
    if (fin && !isoOk(fin)) throw new Error('Fecha de fin no válida');
    if (fin && fin < inicio) throw new Error('La fecha de fin no puede ser anterior a la de inicio');
  };
  const notInPlan = (db, planId, ejercicioId, exceptId) => {
    if (db.asignaciones.some(a => a.id !== exceptId && a.activo && a.planId === planId && a.ejercicioId === ejercicioId))
      throw new Error(ejercicioId + ' ya está en este plan. Edítalo en lugar de añadirlo otra vez.');
  };
  function describe(id, db, conInactivos) {
    const cat = conInactivos ? db.catalogo : active(db);
    const e = cat.find(x => x.id === id);
    if (!e) return null;
    const base = e.variante ? cat.find(x => x.id === e.categoria + e.letra) : e;
    return {
      ejercicioId: e.id, categoria: e.categoria, letra: e.letra, variante: e.variante,
      nombre: base ? base.nombre : '', varianteNombre: e.variante ? e.nombre : '',
      video: e.video || (base ? base.video : '')
    };
  }
  function history(db, codigo) {
    const c = nid(codigo);
    return planesDe(db, c).map(p => {
      const ejercicios = db.asignaciones.filter(a => a.planId === p.id && a.activo).map(a =>
        ({ ...(describe(a.ejercicioId, db, true) || { ejercicioId: a.ejercicioId }), cantidad: a.cantidad, unidad: a.unidad, series: a.series, x2: !!a.x2 })).sort(sortEj);
      const dias = {};
      db.registro.filter(r => nid(r.codigo) === c && r.planId === p.id).forEach(r => {
        const dia = dias[r.fecha] = dias[r.fecha] || {};
        dia[r.asignacionId] = dia[r.asignacionId] || { ...(describe(r.ejercicioId, db, true) || { ejercicioId: r.ejercicioId }),
          cantidad: r.cantidad, unidad: r.unidad, series: r.series, x2: !!r.x2, hechas: 0 };
        dia[r.asignacionId].hechas++;
      });
      return { id: p.id, nombre: p.nombre, inicio: p.inicio, fin: p.fin, ejercicios,
        seriesPorDia: ejercicios.reduce((s, e) => s + e.series, 0),
        dias: Object.keys(dias).sort().reverse().map(fecha => {
          const items = Object.values(dias[fecha]).sort(sortEj);
          return { fecha, items, hechas: items.reduce((s, i) => s + i.hechas, 0) };
        }) };
    });
  }

  const demo = {
    getPlan({ codigo }) {
      const db = load(), c = nid(codigo);
      const user = db.usuarios.find(u => nid(u.codigo) === c);
      if (!user) throw new Error('Código no válido (prueba con DEMO)');
      const hoy = today(), planes = planesDe(db, c), plan = planes.find(p => enCurso(p, hoy));
      const proxima = planes.filter(p => p.inicio > hoy).pop();
      return {
        nombre: user.nombre, fecha: hoy, categorias: db.categorias,
        plan: plan ? { id: plan.id, nombre: plan.nombre, inicio: plan.inicio, fin: plan.fin } : null,
        proxima: proxima ? { nombre: proxima.nombre, inicio: proxima.inicio, fin: proxima.fin } : null,
        ejercicios: !plan ? [] : db.asignaciones.filter(a => a.planId === plan.id && a.activo).map(a => {
          const d = describe(a.ejercicioId, db);
          if (!d) return null;
          return { ...d, asignacionId: a.id, cantidad: a.cantidad, unidad: a.unidad, series: a.series, x2: !!a.x2, comentario: a.comentario || '',
            hechas: db.registro.filter(r => r.asignacionId === a.id && r.fecha === hoy).map(r => r.serie) };
        }).filter(Boolean).sort(sortEj)
      };
    },
    logSet({ codigo, asignacionId, serie }) {
      const db = load(), hoy = today(), a = db.asignaciones.find(x => x.id === asignacionId);
      if (!a || nid(a.codigo) !== nid(codigo)) throw new Error('Asignación no encontrada');
      if (!db.registro.some(r => r.asignacionId === asignacionId && r.fecha === hoy && r.serie === serie))
        db.registro.push({ fecha: hoy, codigo: nid(codigo), asignacionId, ejercicioId: a.ejercicioId, serie,
          planId: a.planId, cantidad: a.cantidad, unidad: a.unidad, series: a.series, x2: !!a.x2 });
      save(db); return true;
    },
    unlogSet({ asignacionId, serie }) {
      const db = load(), hoy = today();
      db.registro = db.registro.filter(r => !(r.asignacionId === asignacionId && r.fecha === hoy && r.serie === serie));
      save(db); return true;
    },
    // La descripción la escribe el usuario; el administrador solo la lee.
    setComment({ codigo, asignacionId, comentario }) {
      const db = load(), a = db.asignaciones.find(x => x.id === asignacionId);
      if (!a || !a.activo || nid(a.codigo) !== nid(codigo)) throw new Error('Asignación no encontrada');
      const p = db.planes.find(x => x.id === a.planId);
      if (p && terminada(p, today())) throw new Error('Esa planificación ya terminó: es de solo lectura');
      comentario = String(comentario || '').trim();
      if (comentario.length > 1000) throw new Error('Máximo 1000 caracteres');
      a.comentario = comentario; save(db); return { comentario };
    },
    getHistory({ codigo }) {
      const db = load();
      if (!db.usuarios.some(u => nid(u.codigo) === nid(codigo))) throw new Error('Código no válido');
      return history(db, codigo);
    },
    adminLogin({ key }) { admin(key); return true; },
    adminData({ key }) {
      admin(key); const db = load(), vig = vigentes(db);
      return {
        categorias: db.categorias, unidades: UNIDADES, usuarios: db.usuarios, planes: db.planes,
        asignaciones: db.asignaciones.filter(a => a.activo && vig.has(a.planId)),
        catalogo: active(db).map(({ activo, ...e }) => e).sort(sortEj)
      };
    },
    adminHistory({ key, codigo }) { admin(key); return history(load(), codigo); },
    addUser({ key, nombre }) {
      admin(key); if (!String(nombre || '').trim()) throw new Error('Falta el nombre');
      const db = load(), u = { codigo: code(6), nombre: nombre.trim() };
      db.usuarios.push(u); save(db); return u;
    },
    updateExercise({ key, id, nombre, video }) {
      admin(key); const db = load(), e = active(db).find(x => x.id === nid(id));
      if (!e) throw new Error('Ejercicio no encontrado: ' + id);
      e.nombre = String(nombre || '').trim(); e.video = String(video || '').trim(); save(db); return true;
    },
    addVariant({ key, baseId, nombre, video }) {
      admin(key); const db = load(), base = active(db).find(x => x.id === nid(baseId) && !x.variante);
      if (!base) throw new Error('Ejercicio base no encontrado: ' + baseId);
      const n = 1 + Math.max(0, ...db.catalogo.filter(e => e.categoria === base.categoria && e.letra === base.letra).map(e => e.variante));
      const v = { id: base.id + n, categoria: base.categoria, letra: base.letra, variante: n,
        nombre: String(nombre || '').trim(), video: String(video || '').trim(), activo: true };
      db.catalogo.push(v); save(db); return v;
    },
    removeVariant({ key, id }) {
      admin(key); const db = load(), v = active(db).find(x => x.id === nid(id)), vig = vigentes(db);
      if (!v || !v.variante) throw new Error('Solo se pueden eliminar variantes');
      if (db.asignaciones.some(a => a.activo && vig.has(a.planId) && a.ejercicioId === v.id)) throw new Error('Está asignada a algún usuario. Quítala de sus planes antes de eliminarla.');
      v.activo = false; save(db); return true;
    },
    renameCategory({ key, id, nombre }) {
      admin(key); const db = load(); db.categorias.find(c => c.id === +id).nombre = nombre; save(db); return true;
    },
    addAssignment({ key, codigo, ejercicioId, cantidad, unidad, series, x2 }) {
      admin(key); const db = load(); dose({ cantidad, unidad, series });
      if (!active(db).some(e => e.id === nid(ejercicioId))) throw new Error('Ejercicio no encontrado');
      const plan = currentPlan(db, codigo, true);
      notInPlan(db, plan.id, nid(ejercicioId), null);
      const a = { id: 'A' + Date.now().toString(36).toUpperCase() + code(3), codigo: nid(codigo), planId: plan.id, ejercicioId: nid(ejercicioId),
        cantidad: +cantidad, unidad, series: +series, x2: !!x2, activo: true };
      db.asignaciones.push(a); save(db); return { id: a.id, planId: plan.id };
    },
    updateAssignment({ key, id, ejercicioId, cantidad, unidad, series, x2 }) {
      admin(key); const db = load(), a = db.asignaciones.find(x => x.id === id);
      if (!a) throw new Error('No encontrado'); dose({ cantidad, unidad, series });
      if (ejercicioId) {
        if (!active(db).some(e => e.id === nid(ejercicioId))) throw new Error('Ejercicio no encontrado');
        notInPlan(db, a.planId, nid(ejercicioId), id);
        a.ejercicioId = nid(ejercicioId);
      }
      Object.assign(a, { cantidad: +cantidad, unidad, series: +series, x2: !!x2 }); save(db); return true;
    },
    removeAssignment({ key, id }) {
      admin(key); const db = load(), a = db.asignaciones.find(x => x.id === id);
      if (a) a.activo = false; save(db); return true;
    },
    newPlan({ key, codigo, nombre, copiar, inicio, fin }) {
      admin(key); const db = load(), hoy = today();
      if (!db.usuarios.some(u => nid(u.codigo) === nid(codigo))) throw new Error('Usuario no encontrado');
      inicio = String(inicio || hoy).trim(); fin = String(fin || '').trim();
      checkFechas(inicio, fin);
      if (inicio < hoy) throw new Error('La fecha de inicio no puede ser anterior a hoy');
      const anterior = currentPlan(db, codigo, false);
      if (anterior && inicio < anterior.inicio) throw new Error(`No puede empezar antes que «${anterior.nombre}» (${fechaCorta(anterior.inicio)})`);
      if (anterior && (!anterior.fin || anterior.fin >= inicio)) {
        const f = addDays(inicio, -1); anterior.fin = f < anterior.inicio ? anterior.inicio : f;
      }
      const plan = newPlanObj(codigo, nombre, inicio, fin);
      db.planes.push(plan);
      let copiados = 0;
      if (anterior && copiar) db.asignaciones.filter(a => a.planId === anterior.id && a.activo).forEach(a => {
        db.asignaciones.push({ ...a, id: 'A' + Date.now().toString(36).toUpperCase() + code(3), planId: plan.id }); copiados++;
      });
      save(db); return { id: plan.id, nombre: plan.nombre, inicio: plan.inicio, fin: plan.fin, copiados };
    },
    updatePlan({ key, id, nombre, inicio, fin }) {
      admin(key); const db = load(), hoy = today(), p = db.planes.find(x => x.id === id);
      if (!p) throw new Error('No encontrado: ' + id);
      if (terminada(p, hoy)) throw new Error('Esta planificación ya terminó: es de solo lectura');
      nombre = nombre == null ? p.nombre : String(nombre).trim();
      if (!nombre) throw new Error('Falta el nombre');
      inicio = inicio == null ? p.inicio : String(inicio).trim();
      fin = fin == null ? p.fin : String(fin).trim();
      checkFechas(inicio, fin);
      if (fin && fin < hoy) throw new Error('La fecha de fin no puede ser anterior a hoy');
      const lista = planesDe(db, p.codigo), i = lista.indexOf(p), siguiente = lista[i - 1], previa = lista[i + 1];
      if (siguiente && (!fin || fin >= siguiente.inicio)) throw new Error(`Se solapa con «${siguiente.nombre}», que empieza el ${fechaCorta(siguiente.inicio)}`);
      if (inicio !== p.inicio && previa && (!previa.fin || inicio <= previa.fin)) throw new Error(`Se solapa con «${previa.nombre}», que termina el ${previa.fin ? fechaCorta(previa.fin) : '—'}`);
      Object.assign(p, { nombre, inicio, fin }); save(db); return true;
    },
    renamePlan({ key, id, nombre }) {
      admin(key); if (!String(nombre || '').trim()) throw new Error('Falta el nombre');
      const db = load(), p = db.planes.find(x => x.id === id); if (!p) throw new Error('No encontrado');
      p.nombre = nombre.trim(); save(db); return true;
    }
  };

  window.RusticAPI = {
    demo: DEMO,
    resetDemo() { localStorage.removeItem(KEY); },
    async call(action, params = {}) {
      if (!DEMO) return remote(action, params);
      await new Promise(r => setTimeout(r, 150)); // simula red
      if (!demo[action]) throw new Error('Acción desconocida: ' + action);
      return demo[action](params);
    }
  };
})();
