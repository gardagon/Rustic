// Rustic — interfaz. Rutas por hash: #/ , #/plan , #/historial , #/admin , #/admin/ejercicios , #/admin/u/CODIGO ,
// #/admin/ej/ID , #/admin/a/ID , #/admin/np/CODIGO (nueva planificación) , #/admin/h/CODIGO (histórico)
(function () {
  const api = window.RusticAPI;
  const $app = document.getElementById('app');
  const UNIT = { reps: 'reps', seg: 'seg', min: 'min' };

  /* ---------- utilidades ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem('rustic-' + k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem('rustic-' + k) : localStorage.setItem('rustic-' + k, v); } catch {} }
  };
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }
  const go = h => { if (location.hash === h) route(); else location.hash = h; };
  const loading = () => ($app.innerHTML = '<div class="loading">Cargando…</div>');
  const dose = e => `${+e.series} × ${+e.cantidad}${e.x2 ? ' x<sub>2</sub>' : ''} ${esc(UNIT[e.unidad] || e.unidad)}`;
  const X2_HELP = 'x<sub>2</sub>: la repetición cuenta cuando la has hecho con los dos lados, o ida y vuelta.';
  const x2Field = (id, on) => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}>
    <span>x<sub>2</sub> · cuenta con los dos lados / ida y vuelta</span></label>`;
  const fechaMedia = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
  const fechaDia = iso => {
    const t = new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const fechaLarga = iso => {
    const t = new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  /* ---------- estado ---------- */
  let plan = null;
  let adminDb = null;
  let adminCat = 1; // categoría elegida en la pestaña Ejercicios
  const openCats = new Set();

  /* ---------- catálogo (admin) ---------- */
  const LETRAS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  const letraIdx = l => { const i = LETRAS.indexOf(l); return i < 0 ? 100 + (l || '~').charCodeAt(0) : i; };
  // El orden no depende del servidor: se recalcula aquí con el alfabeto español.
  // Si a una fila de la hoja le falta la letra o la variante, se deducen del ID (4Ñ1 → Ñ, 1).
  const fixEj = e => {
    const id = String(e.id || e.ejercicioId || '').normalize('NFC').toUpperCase();
    const m = id.match(/^(\d+)(\D)(\d*)$/);
    return { ...e, letra: String(e.letra || (m ? m[2] : '')).normalize('NFC').toUpperCase(),
      variante: +e.variante || (m && m[3] ? +m[3] : 0), categoria: +e.categoria || (m ? +m[1] : 0) };
  };
  const sortEj = (a, b) => a.categoria - b.categoria || letraIdx(a.letra) - letraIdx(b.letra) || a.variante - b.variante;
  const fixPlan = p => ({ ...p, ejercicios: p.ejercicios.map(fixEj).sort(sortEj) });
  const byId = id => adminDb.catalogo.find(e => e.id === id);
  const baseOf = e => (e.variante ? byId(e.categoria + e.letra) : e);
  const variantsOf = base => adminDb.catalogo.filter(e => e.categoria === base.categoria && e.letra === base.letra && e.variante);
  // "4E · Remo anillas", "4E1 · Remo anillas — Anilla al pecho", "4A"
  function exLabel(id) {
    const e = byId(id);
    if (!e) return id + ' (eliminado)';
    const b = baseOf(e) || {};
    const parts = [b.nombre, e.variante ? e.nombre : ''].filter(Boolean);
    return parts.length ? `${e.id} · ${parts.join(' — ')}` : e.id;
  }

  /* ================= ENTRADA ================= */
  function renderLogin(error = '') {
    $app.innerHTML = `
      <section class="login">
        <div class="brand"><img src="icon.svg" alt=""><h1>Rustic</h1></div>
        <form id="f" class="stack" autocomplete="off">
          <div>
            <label for="code">Tu código</label>
            <input id="code" class="code-input" inputmode="text" autocapitalize="characters" spellcheck="false" maxlength="12" required
              value="${esc(store.get('codigo') || '')}" placeholder="${api.demo ? 'DEMO' : 'XXXXXX'}">
          </div>
          <p class="error" id="err">${esc(error)}</p>
          <button class="btn-block" type="submit">Entrar</button>
        </form>
        <div class="spacer"></div>
        <button class="btn-link" id="to-admin">Soy el responsable de los planes</button>
      </section>`;
    const f = document.getElementById('f');
    f.onsubmit = async ev => {
      ev.preventDefault();
      const codigo = document.getElementById('code').value.trim().toUpperCase();
      if (!codigo) return;
      f.querySelector('button').disabled = true;
      try {
        plan = fixPlan(await api.call('getPlan', { codigo }));
        store.set('codigo', codigo);
        go('#/plan');
      } catch (e) {
        document.getElementById('err').textContent = e.message;
        f.querySelector('button').disabled = false;
      }
    };
    document.getElementById('to-admin').onclick = () => go('#/admin');
  }

  /* ================= PLAN DEL USUARIO ================= */
  async function showPlan() {
    const codigo = store.get('codigo');
    if (!codigo) return go('#/');
    if (!plan) {
      loading();
      try { plan = fixPlan(await api.call('getPlan', { codigo })); }
      catch (e) { store.set('codigo', null); return renderLogin(e.message); }
      return renderPlan();
    }
    // Se pinta al instante lo que ya había y se refresca por detrás,
    // por si el entrenador ha cambiado la planificación mientras tanto.
    renderPlan();
    try {
      const fresco = fixPlan(await api.call('getPlan', { codigo }));
      if (location.hash === '#/plan' && JSON.stringify(fresco) !== JSON.stringify(plan)) { plan = fresco; renderPlan(); }
    } catch {}
  }

  function renderPlan() {
    const total = plan.ejercicios.reduce((s, e) => s + e.series, 0);
    const done = plan.ejercicios.reduce((s, e) => s + e.hechas.length, 0);
    const pct = total ? Math.round(done / total * 100) : 0;

    const cats = plan.categorias.map(c => {
      const list = plan.ejercicios.filter(e => e.categoria === c.id);
      if (!list.length) return '';
      const catDone = list.every(e => e.hechas.length >= e.series);
      return `
        <details class="cat ${catDone ? 'is-done' : ''}" data-cat="${c.id}" ${openCats.has(c.id) ? 'open' : ''}>
          <summary>
            <span class="cat-num">${catDone ? '✓' : c.id}</span>
            <span class="cat-title"><h2>${esc(c.nombre)}</h2><p>${list.length} ejercicio${list.length > 1 ? 's' : ''}</p></span>
            <span class="chev" aria-hidden="true"></span>
          </summary>
          <div class="cat-body">${list.map(renderExercise).join('')}</div>
        </details>`;
    }).join('');

    $app.innerHTML = `
      <header class="top">
        <div>
          <h1>Hola, ${esc(plan.nombre)}</h1>
          <p class="muted">${esc(fechaLarga(plan.fecha))}</p>
          ${plan.plan ? `<p class="plan-name">${esc(plan.plan.nombre)} · desde ${esc(fechaMedia(plan.plan.inicio))}</p>` : ''}
        </div>
        <button class="btn-link" id="logout">Salir</button>
      </header>
      ${total ? `<div class="progress" style="margin-bottom:20px">
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
        <p class="progress-label">${done} de ${total} series hechas hoy</p></div>` : ''}
      ${cats || '<div class="card empty">Todavía no tienes ejercicios asignados.</div>'}
      ${plan.ejercicios.some(e => e.x2) ? `<p class="legend">${X2_HELP}</p>` : ''}
      ${'plan' in plan ? '<button class="btn-ghost btn-block" id="hist" style="margin-top:20px">Ver mi histórico</button>' : ''}`;

    const hb = document.getElementById('hist'); if (hb) hb.onclick = () => go('#/historial');
    document.getElementById('logout').onclick = () => { store.set('codigo', null); plan = null; openCats.clear(); go('#/'); };
    $app.querySelectorAll('details.cat').forEach(d => d.addEventListener('toggle', () => {
      d.open ? openCats.add(+d.dataset.cat) : openCats.delete(+d.dataset.cat);
    }));
    $app.querySelectorAll('.set').forEach(b => (b.onclick = () => toggleSet(b.dataset.a, +b.dataset.s)));
  }

  function renderExercise(e) {
    const sets = Array.from({ length: e.series }, (_, i) => {
      const n = i + 1, on = e.hechas.includes(n);
      return `<button class="set ${on ? 'on' : ''}" data-a="${esc(e.asignacionId)}" data-s="${n}"
        aria-pressed="${on}" aria-label="Serie ${n}${on ? ', hecha' : ''}">${on ? '✓' : n}</button>`;
    }).join('');
    return `
      <div class="ex ${e.hechas.length >= e.series ? 'is-done' : ''}">
        <div class="ex-head">
          <div>
            <div class="ex-name"><span class="ex-id">${esc(e.ejercicioId)}</span>${e.nombre ? ' ' + esc(e.nombre) : ''}</div>
            ${e.varianteNombre ? `<div class="ex-var">${esc(e.varianteNombre)}</div>` : ''}
            <div class="ex-meta"><span class="dose">${dose(e)}</span></div>
          </div>
          ${e.video ? `<a class="btn video-btn" href="${esc(e.video)}" target="_blank" rel="noopener">▶ Vídeo</a>` : ''}
        </div>
        <div class="sets">${sets}</div>
      </div>`;
  }

  async function toggleSet(asignacionId, serie) {
    const e = plan.ejercicios.find(x => x.asignacionId === asignacionId);
    const on = e.hechas.includes(serie);
    // Actualización optimista: se pinta ya y se deshace si falla.
    e.hechas = on ? e.hechas.filter(n => n !== serie) : [...e.hechas, serie];
    renderPlan();
    try {
      await api.call(on ? 'unlogSet' : 'logSet', { codigo: store.get('codigo'), asignacionId, serie });
      if (!on && plan.ejercicios.every(x => x.hechas.length >= x.series)) toast('¡Plan de hoy completado!');
    } catch (err) {
      e.hechas = on ? [...e.hechas, serie] : e.hechas.filter(n => n !== serie);
      renderPlan(); toast('No se pudo guardar: ' + err.message);
    }
  }

  /* ================= ADMINISTRACIÓN ================= */
  const adminKey = () => store.get('admin-key');

  function renderAdminLogin(error = '') {
    $app.innerHTML = `
      <header class="top"><h1>Administración</h1><button class="btn-link" id="back">Volver</button></header>
      <form id="f" class="stack card">
        <div><label for="k">Clave de administrador</label>
        <input id="k" type="password" autocomplete="current-password" required placeholder="${api.demo ? 'En demo: admin' : ''}"></div>
        <p class="error">${esc(error)}</p>
        <button class="btn-block">Entrar</button>
      </form>`;
    document.getElementById('back').onclick = () => go('#/');
    document.getElementById('f').onsubmit = async ev => {
      ev.preventDefault();
      const key = document.getElementById('k').value;
      try { await api.call('adminLogin', { key }); store.set('admin-key', key); adminDb = null; route(); }
      catch (e) { renderAdminLogin(e.message); }
    };
  }

  async function loadAdmin(force) {
    if (adminDb && !force) return adminDb;
    adminDb = await api.call('adminData', { key: adminKey() });
    adminDb.catalogo = adminDb.catalogo.map(fixEj).sort(sortEj);
    return adminDb;
  }

  async function showAdmin(tab = 'usuarios') {
    if (!adminKey()) return renderAdminLogin();
    loading();
    try { await loadAdmin(); } catch (e) { store.set('admin-key', null); return renderAdminLogin(e.message); }
    renderAdmin(tab);
  }

  function adminShell(tab, inner) {
    return `
      <header class="top">
        <h1>Administración</h1>
        <button class="btn-link" id="exit">Salir</button>
      </header>
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="usuarios" aria-selected="${tab === 'usuarios'}">Usuarios</button>
        <button role="tab" data-tab="ejercicios" aria-selected="${tab === 'ejercicios'}">Ejercicios</button>
      </div>
      ${inner}`;
  }
  function wireShell() {
    document.getElementById('exit').onclick = () => { store.set('admin-key', null); adminDb = null; go('#/'); };
    $app.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => go(b.dataset.tab === 'usuarios' ? '#/admin' : '#/admin/ejercicios')));
  }

  function renderAdmin(tab) {
    const db = adminDb;
    if (tab === 'usuarios') {
      const count = c => db.asignaciones.filter(a => a.codigo === c).length;
      $app.innerHTML = adminShell(tab, `
        <form id="new-user" class="card row">
          <input class="grow" id="nu" placeholder="Nombre del nuevo usuario" required>
          <button>Crear</button>
        </form>
        <div class="section-title"><h2>Usuarios</h2><span class="muted small">${db.usuarios.length}</span></div>
        <div class="list">${db.usuarios.map(u => `
          <button class="list-item" data-u="${esc(u.codigo)}">
            <span class="grow"><strong>${esc(u.nombre)}</strong><br><span class="muted small">${count(u.codigo)} ejercicios asignados</span></span>
            <span class="mono">${esc(u.codigo)}</span>
          </button>`).join('') || '<div class="empty">Aún no hay usuarios.</div>'}
        </div>`);
      wireShell();
      $app.querySelectorAll('[data-u]').forEach(b => (b.onclick = () => go('#/admin/u/' + encodeURIComponent(b.dataset.u))));
      document.getElementById('new-user').onsubmit = async ev => {
        ev.preventDefault();
        try {
          const u = await api.call('addUser', { key: adminKey(), nombre: document.getElementById('nu').value });
          await loadAdmin(true); toast(`Creado ${u.nombre} · código ${u.codigo}`);
          go('#/admin/u/' + encodeURIComponent(u.codigo));
        } catch (e) { toast(e.message); }
      };
    } else {
      const cat = db.categorias.find(c => c.id === adminCat) || db.categorias[0];
      const bases = db.catalogo.filter(e => e.categoria === cat.id && !e.variante);
      $app.innerHTML = adminShell(tab, `
        <div class="cat-picker" role="tablist" aria-label="Categoría">
          ${db.categorias.map(c => `<button role="tab" data-cat="${c.id}" aria-selected="${c.id === cat.id}">${c.id}</button>`).join('')}
        </div>
        <div class="section-title">
          <h2>${cat.id} · ${esc(cat.nombre)}</h2>
          <button class="btn-link btn-small" id="rename">Renombrar</button>
        </div>
        <div class="list">${bases.map(e => {
          const n = variantsOf(e).length;
          return `<button class="list-item" data-ej="${esc(e.id)}">
            <span class="ex-id">${esc(e.id)}</span>
            <span class="grow">${e.nombre ? esc(e.nombre) : '<span class="muted">Sin nombre</span>'}
              ${n ? `<br><span class="muted small">${n} variante${n > 1 ? 's' : ''}</span>` : ''}</span>
            ${e.video ? '<span class="chip">vídeo</span>' : ''}<span class="edit-hint">Editar</span></button>`;
        }).join('')}</div>`);
      wireShell();
      $app.querySelectorAll('[data-cat]').forEach(b => (b.onclick = () => { adminCat = +b.dataset.cat; renderAdmin('ejercicios'); }));
      $app.querySelectorAll('[data-ej]').forEach(b => (b.onclick = () => go('#/admin/ej/' + encodeURIComponent(b.dataset.ej))));
      document.getElementById('rename').onclick = async () => {
        const nombre = prompt('Nuevo nombre para la categoría ' + cat.id, cat.nombre);
        if (!nombre || !nombre.trim()) return;
        try { await api.call('renameCategory', { key: adminKey(), id: cat.id, nombre: nombre.trim() }); await loadAdmin(true); renderAdmin('ejercicios'); }
        catch (e) { toast(e.message); }
      };
    }
  }

  // Desplegable de variante: el ejercicio base y sus variantes.
  // taken: IDs que ya están en el plan del usuario (se muestran desactivados).
  function variantOptions(base, selected, taken = new Set()) {
    const vs = variantsOf(base);
    if (!vs.length) return '';
    return [base, ...vs].map(e => {
      const off = taken.has(e.id) && e.id !== selected;
      return `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''} ${off ? 'disabled' : ''}>${
        e.variante ? `${esc(e.id)} · ${esc(e.nombre || 'Sin nombre')}` : `Sin variante (${esc(e.id)})`}${off ? ' · ya en el plan' : ''}</option>`;
    }).join('');
  }

  async function showAdminUser(codigo) {
    if (!adminKey()) return renderAdminLogin();
    loading();
    try { await loadAdmin(); } catch (e) { return renderAdminLogin(e.message); }
    const db = adminDb;
    const u = db.usuarios.find(x => x.codigo === codigo);
    if (!u) return go('#/admin');
    const vig = (db.planes || []).filter(p => p.codigo === codigo && !p.fin).sort((a, b) => (a.inicio < b.inicio ? 1 : -1))[0];
    const asig = db.asignaciones.filter(a => a.codigo === codigo)
      .map(a => ({ a, e: byId(a.ejercicioId) }))
      .sort((x, y) => (x.e && y.e ? x.e.categoria - y.e.categoria || letraIdx(x.e.letra) - letraIdx(y.e.letra) || x.e.variante - y.e.variante : 0));

    $app.innerHTML = `
      <header class="top">
        <div><h1>${esc(u.nombre)}</h1><p class="muted">Código <span class="mono">${esc(u.codigo)}</span></p></div>
        <button class="btn-link" id="back">Volver</button>
      </header>
      ${!db.planes ? '' : `<div class="card plan-card">
        ${vig ? `<button class="plan-title" id="rename-plan" aria-label="Renombrar planificación">
            <span><strong>${esc(vig.nombre)}</strong><br><span class="muted small">Vigente desde ${esc(fechaMedia(vig.inicio))}</span></span>
            <span class="edit-hint">Renombrar</span></button>`
          : '<p class="muted">Sin planificación. Se crea sola al asignar el primer ejercicio.</p>'}
        <div class="grid-2" style="margin-top:12px">
          <button class="btn-ghost" id="new-plan">Nueva planificación</button>
          <button class="btn-ghost" id="hist">Histórico</button>
        </div>
      </div>`}
      <form id="assign" class="card stack" style="margin-top:12px">
        <h2>Asignar ejercicio</h2>
        <div class="grid-2">
          <div><label for="ac">Categoría</label><select id="ac">${db.categorias.map(c => `<option value="${c.id}" ${c.id === adminCat ? 'selected' : ''}>${c.id} · ${esc(c.nombre)}</option>`).join('')}</select></div>
          <div><label for="ae">Ejercicio</label><select id="ae"></select></div>
        </div>
        <div id="av-wrap" hidden><label for="av">Variante</label><select id="av"></select></div>
        <div class="grid-3">
          <div><label for="aq">Cantidad</label><input id="aq" type="number" inputmode="numeric" min="1" value="10" required></div>
          <div><label for="au">Unidad</label><select id="au">${db.unidades.map(x => `<option>${x}</option>`).join('')}</select></div>
          <div><label for="as">Series</label><input id="as" type="number" inputmode="numeric" min="1" max="20" value="3" required></div>
        </div>
        ${x2Field('ax2', false)}
        <button class="btn-block" id="assign-btn">Asignar</button>
      </form>
      <div class="section-title"><h2>Ejercicios de la planificación</h2><span class="muted small">${asig.length}</span></div>
      <div class="list">${asig.map(({ a }) => `
        <button class="list-item" data-edit-a="${esc(a.id)}">
          <span class="grow"><strong>${esc(exLabel(a.ejercicioId))}</strong><br>
            <span class="muted small">${dose(a)}</span></span>
          <span class="edit-hint">Editar</span></button>`).join('') || '<div class="empty">Sin ejercicios asignados.</div>'}</div>`;

    document.getElementById('back').onclick = () => go('#/admin');
    // Con el backend anterior (sin planificaciones) estos botones no aparecen.
    if (db.planes) {
      document.getElementById('new-plan').onclick = () => go('#/admin/np/' + encodeURIComponent(codigo));
      document.getElementById('hist').onclick = () => go('#/admin/h/' + encodeURIComponent(codigo));
    }
    const rp = document.getElementById('rename-plan');
    if (rp) rp.onclick = async () => {
      const nombre = prompt('Nombre de la planificación', vig.nombre);
      if (!nombre || !nombre.trim()) return;
      try { await api.call('renamePlan', { key: adminKey(), id: vig.id, nombre: nombre.trim() }); await loadAdmin(true); showAdminUser(codigo); }
      catch (e) { toast(e.message); }
    };
    const ac = document.getElementById('ac'), ae = document.getElementById('ae');
    const av = document.getElementById('av'), avWrap = document.getElementById('av-wrap');
    // La categoría "libera" los ejercicios, y el ejercicio sus variantes.
    // No se puede repetir un ejercicio en el mismo plan: lo ya asignado sale desactivado.
    const taken = new Set(asig.map(({ a }) => a.ejercicioId));
    const btn = document.getElementById('assign-btn');
    const fillVariants = () => {
      const base = byId(ae.value);
      const opts = base ? variantOptions(base, null, taken) : '';
      av.innerHTML = opts; avWrap.hidden = !opts;
      if (opts) { const free = [...av.options].find(o => !o.disabled); if (free) av.value = free.value; }
      updateBtn();
    };
    const updateBtn = () => {
      const id = avWrap.hidden ? ae.value : av.value;
      btn.disabled = !id || taken.has(id);
      btn.textContent = btn.disabled ? 'Ya está en el plan' : 'Asignar';
    };
    const fillExercises = () => {
      adminCat = +ac.value;
      ae.innerHTML = db.catalogo.filter(e => e.categoria === +ac.value && !e.variante).map(e => {
        // Un base sin variantes que ya está asignado no aporta nada nuevo.
        const full = taken.has(e.id) && variantsOf(e).every(v => taken.has(v.id));
        return `<option value="${esc(e.id)}" ${full ? 'disabled' : ''}>${esc(exLabel(e.id))}${full ? ' · ya en el plan' : ''}</option>`;
      }).join('');
      const free = [...ae.options].find(o => !o.disabled); if (free) ae.value = free.value;
      fillVariants();
    };
    av.onchange = updateBtn;
    ac.onchange = fillExercises; ae.onchange = fillVariants; fillExercises();
    document.getElementById('assign').onsubmit = async ev => {
      ev.preventDefault();
      try {
        await api.call('addAssignment', { key: adminKey(), codigo, ejercicioId: avWrap.hidden ? ae.value : av.value,
          cantidad: +document.getElementById('aq').value, unidad: document.getElementById('au').value,
          series: +document.getElementById('as').value, x2: document.getElementById('ax2').checked });
        await loadAdmin(true); toast('Asignado'); showAdminUser(codigo);
      } catch (e) { toast(e.message); }
    };
    $app.querySelectorAll('[data-edit-a]').forEach(b => (b.onclick = () => go('#/admin/a/' + encodeURIComponent(b.dataset.editA))));
  }

  /* ---------- editar un ejercicio o una variante del catálogo ---------- */
  async function showEditExercise(id) {
    if (!adminKey()) return renderAdminLogin();
    loading();
    try { await loadAdmin(); } catch (e) { return renderAdminLogin(e.message); }
    const e = byId(id);
    if (!e) return go('#/admin/ejercicios');
    const base = baseOf(e);
    const cat = adminDb.categorias.find(c => c.id === e.categoria);
    const vs = e.variante ? [] : variantsOf(e);
    const ids = [id, ...vs.map(v => v.id)];
    const usos = adminDb.asignaciones.filter(a => ids.includes(a.ejercicioId)).length;
    const backTo = e.variante ? '#/admin/ej/' + encodeURIComponent(base.id) : '#/admin/ejercicios';

    $app.innerHTML = `
      <header class="top">
        <div><h1><span class="ex-id ex-id-lg">${esc(e.id)}</span></h1>
          <p class="muted">${e.variante ? `Variante de ${esc(exLabel(base.id))}` : `${cat.id} · ${esc(cat.nombre)}`}</p></div>
        <button class="btn-link" id="back">Volver</button>
      </header>
      <form id="f" class="card stack">
        <div><label for="n">${e.variante ? 'Nombre de la variante' : 'Nombre'} (opcional)</label>
          <input id="n" value="${esc(e.nombre)}" placeholder="${e.variante ? 'Ej: anilla al pecho' : 'Vacío si se explica en clase'}"></div>
        <div><label for="v">Enlace de YouTube (vídeo "oculto")</label>
          <input id="v" type="url" inputmode="url" value="${esc(e.video)}" placeholder="${e.variante && base.video ? 'Vacío = usa el vídeo de ' + esc(base.id) : 'https://youtu.be/…'}"></div>
        <p class="muted small">Asignado en ${usos} plan${usos === 1 ? '' : 'es'}${vs.length ? ' (contando variantes)' : ''}. Los cambios se ven en todos.</p>
        <button class="btn-block">Guardar</button>
      </form>
      ${e.variante ? `
        <div class="spacer"></div>
        <button class="btn-danger btn-block" id="del">Eliminar variante</button>` : `
        <div class="section-title"><h2>Variantes</h2><span class="muted small">${vs.length}</span></div>
        ${vs.length ? `<div class="list">${vs.map(v => `
          <button class="list-item" data-ej="${esc(v.id)}"><span class="ex-id">${esc(v.id)}</span>
            <span class="grow">${v.nombre ? esc(v.nombre) : '<span class="muted">Sin nombre</span>'}</span>
            ${v.video ? '<span class="chip">vídeo</span>' : ''}<span class="edit-hint">Editar</span></button>`).join('')}</div>` : ''}
        <form id="nv" class="card stack" style="margin-top:10px">
          <h2>Añadir variante ${esc(e.id)}${vs.length ? Math.max(...vs.map(v => v.variante)) + 1 : 1}</h2>
          <div><label for="nvn">Nombre</label><input id="nvn" placeholder="Ej: anilla a la cadera"></div>
          <div><label for="nvv">Enlace de YouTube (opcional)</label><input id="nvv" type="url" inputmode="url" placeholder="https://youtu.be/…"></div>
          <button class="btn-block btn-ghost">Añadir variante</button>
        </form>`}`;

    document.getElementById('back').onclick = () => go(backTo);
    document.getElementById('f').onsubmit = async ev => {
      ev.preventDefault();
      try {
        await api.call('updateExercise', { key: adminKey(), id, nombre: document.getElementById('n').value, video: document.getElementById('v').value });
        await loadAdmin(true); toast('Guardado ' + id); go(backTo);
      } catch (err) { toast(err.message); }
    };
    $app.querySelectorAll('[data-ej]').forEach(b => (b.onclick = () => go('#/admin/ej/' + encodeURIComponent(b.dataset.ej))));
    const nv = document.getElementById('nv');
    if (nv) nv.onsubmit = async ev => {
      ev.preventDefault();
      try {
        const v = await api.call('addVariant', { key: adminKey(), baseId: id, nombre: document.getElementById('nvn').value, video: document.getElementById('nvv').value });
        await loadAdmin(true); toast('Añadida ' + v.id); showEditExercise(id);
      } catch (err) { toast(err.message); }
    };
    const del = document.getElementById('del');
    if (del) del.onclick = async () => {
      if (!confirm(`¿Eliminar la variante ${id}?`)) return;
      try { await api.call('removeVariant', { key: adminKey(), id }); await loadAdmin(true); toast('Eliminada ' + id); go(backTo); }
      catch (err) { toast(err.message); }
    };
  }

  /* ---------- editar una asignación de un usuario ---------- */
  async function showEditAssignment(id) {
    if (!adminKey()) return renderAdminLogin();
    loading();
    try { await loadAdmin(); } catch (e) { return renderAdminLogin(e.message); }
    const db = adminDb, a = db.asignaciones.find(x => x.id === id);
    if (!a) return go('#/admin');
    const e = byId(a.ejercicioId);
    const u = db.usuarios.find(x => x.codigo === a.codigo);
    const backTo = '#/admin/u/' + encodeURIComponent(a.codigo);
    const taken = new Set(db.asignaciones.filter(x => x.codigo === a.codigo && x.id !== a.id).map(x => x.ejercicioId));
    const vOpts = e ? variantOptions(baseOf(e), e.id, taken) : '';

    $app.innerHTML = `
      <header class="top">
        <div><h1>${esc(exLabel(a.ejercicioId))}</h1><p class="muted">Plan de ${esc(u ? u.nombre : a.codigo)}</p></div>
        <button class="btn-link" id="back">Volver</button>
      </header>
      <form id="f" class="card stack">
        ${vOpts ? `<div><label for="va">Variante</label><select id="va">${vOpts}</select></div>` : ''}
        <div class="grid-3">
          <div><label for="q">Cantidad</label><input id="q" type="number" inputmode="numeric" min="1" value="${a.cantidad}" required></div>
          <div><label for="un">Unidad</label><select id="un">${db.unidades.map(x => `<option ${x === a.unidad ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div><label for="s">Series</label><input id="s" type="number" inputmode="numeric" min="1" max="20" value="${a.series}" required></div>
        </div>
        ${x2Field('x2', a.x2)}
        <button class="btn-block">Guardar</button>
      </form>
      <div class="spacer"></div>
      <button class="btn-danger btn-block" id="del">Quitar del plan</button>`;

    document.getElementById('back').onclick = () => go(backTo);
    document.getElementById('f').onsubmit = async ev => {
      ev.preventDefault();
      const va = document.getElementById('va');
      try {
        await api.call('updateAssignment', { key: adminKey(), id, ejercicioId: va ? va.value : undefined,
          cantidad: +document.getElementById('q').value, unidad: document.getElementById('un').value, series: +document.getElementById('s').value,
          x2: document.getElementById('x2').checked });
        await loadAdmin(true); toast('Guardado'); go(backTo);
      } catch (err) { toast(err.message); }
    };
    document.getElementById('del').onclick = async () => {
      if (!confirm('¿Quitar este ejercicio del plan?')) return;
      try { await api.call('removeAssignment', { key: adminKey(), id }); await loadAdmin(true); toast('Quitado'); go(backTo); }
      catch (err) { toast(err.message); }
    };
  }

  /* ---------- nueva planificación ---------- */
  async function showNewPlan(codigo) {
    if (!adminKey()) return renderAdminLogin();
    loading();
    try { await loadAdmin(); } catch (e) { return renderAdminLogin(e.message); }
    const u = adminDb.usuarios.find(x => x.codigo === codigo);
    if (!u) return go('#/admin');
    const n = adminDb.asignaciones.filter(a => a.codigo === codigo).length;
    const hoy = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' });
    const backTo = '#/admin/u/' + encodeURIComponent(codigo);
    $app.innerHTML = `
      <header class="top">
        <div><h1>Nueva planificación</h1><p class="muted">Para ${esc(u.nombre)}</p></div>
        <button class="btn-link" id="back">Volver</button>
      </header>
      <form id="f" class="card stack">
        <div><label for="pn">Nombre (opcional)</label><input id="pn" placeholder="Planificación ${esc(hoy)}"></div>
        ${n ? `<label class="check"><input type="checkbox" id="cp" checked>
          <span>Empezar con los ${n} ejercicios de la actual, para cambiar solo lo necesario</span></label>` : ''}
        <p class="muted small">${n ? 'La planificación actual se cierra hoy y pasa al histórico tal como está.' : 'Empezará vacía.'}
          ${esc(u.nombre)} verá la nueva al entrar.</p>
        <button class="btn-block">Crear planificación</button>
      </form>`;
    document.getElementById('back').onclick = () => go(backTo);
    document.getElementById('f').onsubmit = async ev => {
      ev.preventDefault();
      const cp = document.getElementById('cp');
      try {
        const p = await api.call('newPlan', { key: adminKey(), codigo, nombre: document.getElementById('pn').value, copiar: cp ? cp.checked : false });
        await loadAdmin(true); toast(`Creada: ${p.nombre}`); go(backTo);
      } catch (err) { toast(err.message); }
    };
  }

  /* ---------- histórico (lo usan el usuario y el administrador) ---------- */
  function renderHistory(hist, titulo, backTo) {
    const pct = (a, b) => (b ? Math.min(100, Math.round(a / b * 100)) : 0);
    const planes = hist.map((p, i) => {
      const medias = p.dias.map(d => pct(d.hechas, p.seriesPorDia));
      const media = medias.length ? Math.round(medias.reduce((s, x) => s + x, 0) / medias.length) : 0;
      return `
        <details class="cat hist-plan" ${i === 0 ? 'open' : ''}>
          <summary>
            <span class="cat-title"><h2>${esc(p.nombre)}</h2>
              <p>${esc(fechaMedia(p.inicio))} – ${p.fin ? esc(fechaMedia(p.fin)) : 'hoy'} · ${p.dias.length} día${p.dias.length === 1 ? '' : 's'} entrenado${p.dias.length === 1 ? '' : 's'}${p.dias.length ? ` · ${media}% de media` : ''}</p></span>
            <span class="chev" aria-hidden="true"></span>
          </summary>
          <div class="cat-body">
            ${p.dias.map(d => `
              <details class="hist-day">
                <summary>
                  <span class="grow">${esc(fechaDia(d.fecha))}</span>
                  <span class="mini-bar"><span style="width:${pct(d.hechas, p.seriesPorDia)}%"></span></span>
                  <span class="muted small hist-n">${d.hechas}/${p.seriesPorDia}</span>
                </summary>
                ${d.items.map(e => `
                  <div class="hist-item">
                    <span class="ex-id">${esc(e.ejercicioId)}</span>
                    <span class="grow">${esc([e.nombre, e.varianteNombre].filter(Boolean).join(' — '))}
                      <br><span class="muted small">${e.hechas} de ${dose(e)}</span></span>
                    ${e.hechas >= e.series ? '<span class="ok">✓</span>' : ''}
                  </div>`).join('')}
              </details>`).join('') || '<p class="empty small">Sin días entrenados.</p>'}
            <details class="hist-day hist-presc">
              <summary><span class="grow">Lo que tenía asignado</span><span class="muted small">${p.ejercicios.length} ejercicios</span></summary>
              ${p.ejercicios.map(e => `
                <div class="hist-item"><span class="ex-id">${esc(e.ejercicioId)}</span>
                  <span class="grow">${esc([e.nombre, e.varianteNombre].filter(Boolean).join(' — '))}
                    <br><span class="muted small">${dose(e)}</span></span></div>`).join('')}
            </details>
          </div>
        </details>`;
    }).join('');
    $app.innerHTML = `
      <header class="top"><div><h1>Histórico</h1><p class="muted">${esc(titulo)}</p></div>
        <button class="btn-link" id="back">Volver</button></header>
      ${planes || '<div class="card empty">Todavía no hay histórico.</div>'}
      ${hist.some(p => p.dias.some(d => d.items.some(i => i.x2))) ? `<p class="legend">${X2_HELP}</p>` : ''}`;
    document.getElementById('back').onclick = () => go(backTo);
  }

  async function showHistory() {
    const codigo = store.get('codigo');
    if (!codigo) return go('#/');
    loading();
    try { renderHistory(await api.call('getHistory', { codigo }), plan ? plan.nombre : '', '#/plan'); }
    catch (e) { toast(e.message); go('#/plan'); }
  }

  async function showAdminHistory(codigo) {
    if (!adminKey()) return renderAdminLogin();
    loading();
    try {
      await loadAdmin();
      const u = adminDb.usuarios.find(x => x.codigo === codigo);
      renderHistory(await api.call('adminHistory', { key: adminKey(), codigo }), u ? u.nombre : codigo, '#/admin/u/' + encodeURIComponent(codigo));
    } catch (e) { toast(e.message); go('#/admin'); }
  }

  /* ================= RUTAS ================= */
  function route() {
    const h = location.hash || '#/';
    window.scrollTo(0, 0);
    if (h === '#/plan') return showPlan();
    if (h === '#/admin') return showAdmin('usuarios');
    if (h === '#/admin/ejercicios') return showAdmin('ejercicios');
    if (h.startsWith('#/admin/u/')) return showAdminUser(decodeURIComponent(h.slice(10)));
    if (h.startsWith('#/admin/ej/')) return showEditExercise(decodeURIComponent(h.slice(11)));
    if (h.startsWith('#/admin/a/')) return showEditAssignment(decodeURIComponent(h.slice(10)));
    if (h.startsWith('#/admin/np/')) return showNewPlan(decodeURIComponent(h.slice(11)));
    if (h.startsWith('#/admin/h/')) return showAdminHistory(decodeURIComponent(h.slice(10)));
    if (h === '#/historial') return showHistory();
    if (store.get('codigo')) return go('#/plan');
    renderLogin();
  }

  document.getElementById('demo-banner').hidden = !api.demo;
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
