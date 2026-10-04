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
  const KEY = 'rustic-demo-db-v4';
  const UNIDADES = ['reps', 'seg', 'min'];
  const LETRAS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('');
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const nid = s => String(s || '').trim().toUpperCase();
  const letraIdx = l => { const i = LETRAS.indexOf(l); return i < 0 ? 100 + l.charCodeAt(0) : i; };
  const sortEj = (a, b) => a.categoria - b.categoria || letraIdx(a.letra) - letraIdx(b.letra) || a.variante - b.variante;

  function seed() {
    const categorias = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, nombre: 'Categoría ' + (i + 1) }));
    const catalogo = [];
    for (let c = 1; c <= 9; c++) LETRAS.forEach(l => catalogo.push({ id: c + l, categoria: c, letra: l, variante: 0, nombre: '', video: '', activo: true }));
    const nombre = (id, n) => (catalogo.find(e => e.id === id).nombre = n);
    nombre('1D', 'Sentadilla'); nombre('1E', 'Zancada'); nombre('2D', 'Flexiones');
    nombre('3D', 'Plancha'); nombre('3E', 'Dead bug'); nombre('5A', 'Superman'); nombre('4E', 'Remo anillas');
    catalogo.push({ id: '4E1', categoria: 4, letra: 'E', variante: 1, nombre: 'Anilla al pecho', video: '', activo: true });
    catalogo.push({ id: '4E2', categoria: 4, letra: 'E', variante: 2, nombre: 'Anilla a la cadera', video: '', activo: true });
    const a = (id, ej, cantidad, unidad, series, x2 = false) => ({ id, codigo: 'DEMO', ejercicioId: ej, cantidad, unidad, series, x2 });
    return {
      categorias, catalogo,
      usuarios: [{ codigo: 'DEMO', nombre: 'Ana' }],
      asignaciones: [
        a('A1', '1A', 5, 'min', 1),
        a('A2', '1D', 12, 'reps', 3),
        a('A3', '2D', 10, 'reps', 4),
        a('A4', '3D', 45, 'seg', 3),
        a('A7', '5A', 8, 'reps', 3, true),
        a('A5', '4E1', 10, 'reps', 3, true),
        a('A6', '4E2', 8, 'reps', 2)
      ],
      registro: []
    };
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
  const notInPlan = (db, codigo, ejercicioId, exceptId) => {
    if (db.asignaciones.some(a => a.id !== exceptId && nid(a.codigo) === nid(codigo) && a.ejercicioId === ejercicioId))
      throw new Error(ejercicioId + ' ya está en este plan. Edítalo en lugar de añadirlo otra vez.');
  };
  function describe(id, db) {
    const e = active(db).find(x => x.id === id);
    if (!e) return null;
    const base = e.variante ? active(db).find(x => x.id === e.categoria + e.letra) : e;
    return {
      ejercicioId: e.id, categoria: e.categoria, letra: e.letra, variante: e.variante,
      nombre: base ? base.nombre : '', varianteNombre: e.variante ? e.nombre : '',
      video: e.video || (base ? base.video : '')
    };
  }

  const demo = {
    getPlan({ codigo }) {
      const db = load(), c = nid(codigo);
      const user = db.usuarios.find(u => nid(u.codigo) === c);
      if (!user) throw new Error('Código no válido (prueba con DEMO)');
      const hoy = today();
      return {
        nombre: user.nombre, fecha: hoy, categorias: db.categorias,
        ejercicios: db.asignaciones.filter(a => nid(a.codigo) === c).map(a => {
          const d = describe(a.ejercicioId, db);
          if (!d) return null;
          return { ...d, asignacionId: a.id, cantidad: a.cantidad, unidad: a.unidad, series: a.series, x2: !!a.x2,
            hechas: db.registro.filter(r => r.asignacionId === a.id && r.fecha === hoy).map(r => r.serie) };
        }).filter(Boolean).sort(sortEj)
      };
    },
    logSet({ codigo, asignacionId, serie }) {
      const db = load(), hoy = today(), a = db.asignaciones.find(x => x.id === asignacionId);
      if (!db.registro.some(r => r.asignacionId === asignacionId && r.fecha === hoy && r.serie === serie))
        db.registro.push({ fecha: hoy, codigo: nid(codigo), asignacionId, ejercicioId: a && a.ejercicioId, serie });
      save(db); return true;
    },
    unlogSet({ asignacionId, serie }) {
      const db = load(), hoy = today();
      db.registro = db.registro.filter(r => !(r.asignacionId === asignacionId && r.fecha === hoy && r.serie === serie));
      save(db); return true;
    },
    adminLogin({ key }) { admin(key); return true; },
    adminData({ key }) {
      admin(key); const db = load();
      return {
        categorias: db.categorias, unidades: UNIDADES, usuarios: db.usuarios, asignaciones: db.asignaciones,
        catalogo: active(db).map(({ activo, ...e }) => e).sort(sortEj)
      };
    },
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
      admin(key); const db = load(), v = active(db).find(x => x.id === nid(id));
      if (!v || !v.variante) throw new Error('Solo se pueden eliminar variantes');
      if (db.asignaciones.some(a => a.ejercicioId === v.id)) throw new Error('Está asignada a algún usuario. Quítala de sus planes antes de eliminarla.');
      v.activo = false; save(db); return true;
    },
    renameCategory({ key, id, nombre }) {
      admin(key); const db = load(); db.categorias.find(c => c.id === +id).nombre = nombre; save(db); return true;
    },
    addAssignment({ key, codigo, ejercicioId, cantidad, unidad, series, x2 }) {
      admin(key); const db = load(); dose({ cantidad, unidad, series });
      if (!active(db).some(e => e.id === nid(ejercicioId))) throw new Error('Ejercicio no encontrado');
      notInPlan(db, codigo, nid(ejercicioId), null);
      const a = { id: 'A' + Date.now().toString(36).toUpperCase() + code(3), codigo: nid(codigo), ejercicioId: nid(ejercicioId),
        cantidad: +cantidad, unidad, series: +series, x2: !!x2 };
      db.asignaciones.push(a); save(db); return { id: a.id };
    },
    updateAssignment({ key, id, ejercicioId, cantidad, unidad, series, x2 }) {
      admin(key); const db = load(), a = db.asignaciones.find(x => x.id === id);
      if (!a) throw new Error('No encontrado'); dose({ cantidad, unidad, series });
      if (ejercicioId) {
        if (!active(db).some(e => e.id === nid(ejercicioId))) throw new Error('Ejercicio no encontrado');
        notInPlan(db, a.codigo, nid(ejercicioId), id);
        a.ejercicioId = nid(ejercicioId);
      }
      Object.assign(a, { cantidad: +cantidad, unidad, series: +series, x2: !!x2 }); save(db); return true;
    },
    removeAssignment({ key, id }) {
      admin(key); const db = load(); db.asignaciones = db.asignaciones.filter(a => a.id !== id); save(db); return true;
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
