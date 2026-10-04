// Capa de datos. Mismas acciones en el backend real (Apps Script) y en el modo demo.
(function () {
  const URL = (window.RUSTIC_CONFIG || {}).API_URL || '';
  const DEMO = !URL;

  async function remote(action, params = {}) {
    // text/plain evita la petición previa CORS, que Apps Script no admite.
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...params })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error del servidor');
    return json.data;
  }

  /* ---------------- MODO DEMO ---------------- */
  const KEY = 'rustic-demo-db-v1';
  const UNIDADES = ['reps', 'seg', 'min'];
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

  function seed() {
    const categorias = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, nombre: 'Categoría ' + (i + 1) }));
    const nombres = {
      1: ['Sentadilla', 'Zancada', 'Puente de glúteo'],
      2: ['Flexiones', 'Remo con banda'],
      3: ['Plancha', 'Dead bug', 'Bird dog'],
      5: ['Movilidad de cadera'],
      8: ['Estiramiento isquios']
    };
    const catalogo = [];
    Object.entries(nombres).forEach(([cat, list]) => list.forEach((n, i) =>
      catalogo.push({ id: cat + '-' + String(i + 1).padStart(3, '0'), categoria: +cat, nombre: n, video: '' })));
    const a = (id, ej, cantidad, unidad, series, variante, orden) =>
      ({ id, codigo: 'DEMO', ejercicioId: ej, cantidad, unidad, series, variante, orden });
    return {
      categorias, catalogo,
      variantes: ['Normal', 'Variante A', 'Variante B'],
      usuarios: [{ codigo: 'DEMO', nombre: 'Ana' }],
      asignaciones: [
        a('A1', '1-001', 12, 'reps', 3, 'Normal', 1),
        a('A2', '1-003', 15, 'reps', 3, 'Variante A', 2),
        a('A3', '2-001', 10, 'reps', 4, 'Normal', 3),
        a('A4', '3-001', 45, 'seg', 3, 'Normal', 4),
        a('A5', '3-002', 10, 'reps', 2, 'Variante B', 5),
        a('A6', '5-001', 3, 'min', 1, 'Normal', 6),
        a('A7', '8-001', 30, 'seg', 2, 'Normal', 7)
      ],
      registro: []
    };
  }
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
  const save = db => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const norm = c => String(c || '').trim().toUpperCase();
  const code = n => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const admin = k => { if (k !== 'admin') throw new Error('Clave de administrador incorrecta (en demo es "admin")'); };

  const demo = {
    getPlan({ codigo }) {
      const db = load(), c = norm(codigo);
      const user = db.usuarios.find(u => norm(u.codigo) === c);
      if (!user) throw new Error('Código no válido (prueba con DEMO)');
      const hoy = today();
      return {
        nombre: user.nombre, fecha: hoy, categorias: db.categorias,
        ejercicios: db.asignaciones.filter(a => norm(a.codigo) === c).map(a => {
          const e = db.catalogo.find(x => x.id === a.ejercicioId);
          if (!e) return null;
          return {
            asignacionId: a.id, ejercicioId: a.ejercicioId, categoria: e.categoria, nombre: e.nombre, video: e.video,
            cantidad: a.cantidad, unidad: a.unidad, series: a.series, variante: a.variante, orden: a.orden,
            hechas: db.registro.filter(r => r.asignacionId === a.id && r.fecha === hoy).map(r => r.serie)
          };
        }).filter(Boolean).sort((x, y) => x.categoria - y.categoria || x.orden - y.orden)
      };
    },
    logSet({ codigo, asignacionId, serie }) {
      const db = load(), hoy = today();
      if (!db.registro.some(r => r.asignacionId === asignacionId && r.fecha === hoy && r.serie === serie))
        db.registro.push({ fecha: hoy, codigo: norm(codigo), asignacionId, serie });
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
      return { categorias: db.categorias, variantes: db.variantes, unidades: UNIDADES, catalogo: db.catalogo, usuarios: db.usuarios, asignaciones: db.asignaciones };
    },
    addUser({ key, nombre }) {
      admin(key); if (!String(nombre || '').trim()) throw new Error('Falta el nombre');
      const db = load(), u = { codigo: code(6), nombre: nombre.trim() };
      db.usuarios.push(u); save(db); return u;
    },
    addExercise({ key, categoria, nombre, video }) {
      admin(key); if (!String(nombre || '').trim()) throw new Error('Falta el nombre del ejercicio');
      const db = load(), cat = +categoria;
      const max = Math.max(0, ...db.catalogo.filter(e => e.categoria === cat).map(e => +e.id.split('-')[1]));
      const e = { id: cat + '-' + String(max + 1).padStart(3, '0'), categoria: cat, nombre: nombre.trim(), video: (video || '').trim() };
      db.catalogo.push(e); save(db); return e;
    },
    updateExercise({ key, id, nombre, video }) {
      admin(key); if (!String(nombre || '').trim()) throw new Error('Falta el nombre del ejercicio');
      const db = load(), e = db.catalogo.find(x => x.id === id);
      if (!e) throw new Error('No encontrado');
      e.nombre = nombre.trim(); e.video = String(video || '').trim(); save(db); return true;
    },
    removeExercise({ key, id }) {
      admin(key); const db = load();
      if (db.asignaciones.some(a => a.ejercicioId === id)) throw new Error('Está asignado a algún usuario. Quítalo de sus planes antes de eliminarlo.');
      db.catalogo = db.catalogo.filter(e => e.id !== id); save(db); return true;
    },
    updateAssignment({ key, id, cantidad, unidad, series, variante }) {
      admin(key); const db = load(), a = db.asignaciones.find(x => x.id === id);
      if (!a) throw new Error('No encontrado');
      if (!UNIDADES.includes(unidad)) throw new Error('Unidad no válida');
      if (!(+cantidad > 0) || !(+series >= 1 && +series <= 20)) throw new Error('Cantidad o series no válidas');
      Object.assign(a, { cantidad: +cantidad, unidad, series: +series, variante }); save(db); return true;
    },
    renameCategory({ key, id, nombre }) {
      admin(key); const db = load(); db.categorias.find(c => c.id === +id).nombre = nombre; save(db); return true;
    },
    addAssignment({ key, codigo, ejercicioId, cantidad, unidad, series, variante }) {
      admin(key); const db = load();
      if (!(+cantidad > 0) || !(+series >= 1)) throw new Error('Cantidad o series no válidas');
      const a = { id: 'A' + Date.now().toString(36).toUpperCase() + code(3), codigo: norm(codigo), ejercicioId, cantidad: +cantidad, unidad, series: +series, variante, orden: db.asignaciones.length + 1 };
      db.asignaciones.push(a); save(db); return { id: a.id };
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
