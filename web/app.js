// Rustic — interfaz. Rutas por hash: #/ , #/plan , #/admin , #/admin/ejercicios , #/admin/u/CODIGO , #/admin/ej/ID , #/admin/a/ID
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
  const dose = e => `${e.series} × ${e.cantidad} ${UNIT[e.unidad] || e.unidad}`;
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
        plan = await api.call('getPlan', { codigo });
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
      try { plan = await api.call('getPlan', { codigo }); }
      catch (e) { store.set('codigo', null); return renderLogin(e.message); }
    }
    renderPlan();
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
        </div>
        <button class="btn-link" id="logout">Salir</button>
      </header>
      ${total ? `<div class="progress" style="margin-bottom:20px">
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
        <p class="progress-label">${done} de ${total} series hechas hoy</p></div>` : ''}
      ${cats || '<div class="card empty">Todavía no tienes ejercicios asignados.</div>'}`;

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
            <div class="ex-meta"><span class="dose">${esc(dose(e))}</span></div>
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
  function variantOptions(base, selected) {
    const vs = variantsOf(base);
    if (!vs.length) return '';
    return [base, ...vs].map(e => `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''}>${
      e.variante ? `${esc(e.id)} · ${esc(e.nombre || 'Sin nombre')}` : `Sin variante (${esc(e.id)})`}</option>`).join('');
  }

  async function showAdminUser(codigo) {
    if (!adminKey()) return renderAdminLogin();
    loading();
    try { await loadAdmin(); } catch (e) { return renderAdminLogin(e.message); }
    const db = adminDb;
    const u = db.usuarios.find(x => x.codigo === codigo);
    if (!u) return go('#/admin');
    const asig = db.asignaciones.filter(a => a.codigo === codigo)
      .map(a => ({ a, e: byId(a.ejercicioId) }))
      .sort((x, y) => (x.e && y.e ? x.e.categoria - y.e.categoria || x.e.letra.localeCompare(y.e.letra) || x.e.variante - y.e.variante : 0));

    $app.innerHTML = `
      <header class="top">
        <div><h1>${esc(u.nombre)}</h1><p class="muted">Código <span class="mono">${esc(u.codigo)}</span></p></div>
        <button class="btn-link" id="back">Volver</button>
      </header>
      <form id="assign" class="card stack">
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
        <button class="btn-block">Asignar</button>
      </form>
      <div class="section-title"><h2>Plan actual</h2><span class="muted small">${asig.length}</span></div>
      <div class="list">${asig.map(({ a }) => `
        <button class="list-item" data-edit-a="${esc(a.id)}">
          <span class="grow"><strong>${esc(exLabel(a.ejercicioId))}</strong><br>
            <span class="muted small">${esc(dose(a))}</span></span>
          <span class="edit-hint">Editar</span></button>`).join('') || '<div class="empty">Sin ejercicios asignados.</div>'}</div>`;

    document.getElementById('back').onclick = () => go('#/admin');
    const ac = document.getElementById('ac'), ae = document.getElementById('ae');
    const av = document.getElementById('av'), avWrap = document.getElementById('av-wrap');
    // La categoría "libera" los ejercicios, y el ejercicio sus variantes.
    const fillVariants = () => {
      const opts = variantOptions(byId(ae.value), ae.value);
      av.innerHTML = opts; avWrap.hidden = !opts;
    };
    const fillExercises = () => {
      adminCat = +ac.value;
      ae.innerHTML = db.catalogo.filter(e => e.categoria === +ac.value && !e.variante)
        .map(e => `<option value="${esc(e.id)}">${esc(exLabel(e.id))}</option>`).join('');
      fillVariants();
    };
    ac.onchange = fillExercises; ae.onchange = fillVariants; fillExercises();
    document.getElementById('assign').onsubmit = async ev => {
      ev.preventDefault();
      try {
        await api.call('addAssignment', { key: adminKey(), codigo, ejercicioId: avWrap.hidden ? ae.value : av.value,
          cantidad: +document.getElementById('aq').value, unidad: document.getElementById('au').value,
          series: +document.getElementById('as').value });
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
    const vOpts = e ? variantOptions(baseOf(e), e.id) : '';

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
          cantidad: +document.getElementById('q').value, unidad: document.getElementById('un').value, series: +document.getElementById('s').value });
        await loadAdmin(true); toast('Guardado'); go(backTo);
      } catch (err) { toast(err.message); }
    };
    document.getElementById('del').onclick = async () => {
      if (!confirm('¿Quitar este ejercicio del plan?')) return;
      try { await api.call('removeAssignment', { key: adminKey(), id }); await loadAdmin(true); toast('Quitado'); go(backTo); }
      catch (err) { toast(err.message); }
    };
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
