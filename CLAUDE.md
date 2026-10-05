# Rustic — contexto para Claude

App de planes de ejercicios. Cada usuario entra con un código, ve sus ejercicios agrupados en 9 categorías y marca las series que hace cada día. Un responsable (administrador) crea usuarios, mantiene el catálogo y asigna ejercicios desde la propia app.

## Cómo trabajar conmigo (el dueño del proyecto)

- Eres mi asesor, no mi asistente. No empieces dándome la razón.
- Etiqueta las afirmaciones: **[Seguro]** si hay pruebas sólidas, **[Probable]** si es una inferencia fuerte, **[Suposición]** si rellena huecos.
- No uses: "Buena pregunta", "Tienes toda la razón", "Tiene mucho sentido", "Por supuesto", "Sin duda".
- Si me equivoco: "No estoy de acuerdo porque [razón]. Yo haría [alternativa]. El riesgo de tu enfoque es [desventaja]."
- Empieza por lo más útil. La verdad incómoda, primero. Si te rebato sin información nueva, mantén tu posición.
- Suelo escribir desde el móvil: respuestas cortas, y dime siempre cómo probar el cambio.

## Arquitectura

```
web/            PWA estática (HTML + CSS + JS, sin build). Se publica en GitHub Pages.
  config.js     API_URL del backend. Vacía = modo demo (datos en localStorage, clave admin "admin", código "DEMO").
  api.js        Capa de datos. Implementa las mismas acciones en remoto y en demo: si añades una acción, añádela en los dos sitios.
  app.js        Interfaz. Rutas por hash: #/ , #/plan , #/admin , #/admin/ejercicios , #/admin/u/CODIGO ,
                #/admin/ej/ID (editar ejercicio o variante) , #/admin/a/ID (editar asignación) ,
                #/admin/np/CODIGO (nueva planificación) , #/admin/p/ID (nombre y fechas de la planificación) ,
                #/admin/h/CODIGO (histórico)
  sw.js         Service worker "red primero": los cambios se ven al recargar.
apps-script/
  Code.gs       Backend en Google Apps Script vinculado a la Google Sheet (la base de datos).
.github/workflows/deploy.yml   Publica web/ en GitHub Pages en cada push a main.
```

### Modelo de datos (pestañas de la Google Sheet)

| Pestaña | Columnas |
|---|---|
| Categorias | id (1–9), nombre |
| Catalogo | id, categoria, letra, variante, nombre, video, activo |
| Usuarios | codigo, nombre, activo |
| Planes | id, codigo, nombre, inicio, fin (vacío = sin fecha de fin) |
| Asignaciones | id, codigo, ejercicioId, cantidad, unidad (reps/seg/min), series, x2, orden, activo, planId |
| Registro | fecha (yyyy-MM-dd, Europe/Madrid), codigo, asignacionId, ejercicioId, serie, timestamp, planId, cantidad, unidad, series, x2 |

Las columnas se localizan por su cabecera (`appendObj_`, `readTable_`), no por su posición. `setup()` es idempotente:
crea lo que falta, añade columnas nuevas al final y migra datos antiguos; nunca borra. Se ejecuta solo: si
`SCHEMA_VERSION` (en Code.gs) es mayor que la guardada en las propiedades del script, la primera petición lo lanza.
Al cambiar el esquema, sube `SCHEMA_VERSION`. La web debe tolerar el backend anterior hasta que se publique.

Decisiones tomadas:
- Planificaciones por bloques, cada una de inicio a fin; el tic "Sin fecha de fin" deja fin vacío. El usuario ve la
  que está en curso hoy (inicio ≤ hoy ≤ fin); si se solapan, la de inicio más reciente y, a igual inicio, la creada
  después (así se leen bien los datos antiguos, donde fin de la anterior = inicio de la nueva). Pasado el fin, el
  usuario no ve ejercicios hasta que haya otra; si hay una futura, se le avisa de cuándo empieza.
  "Nueva planificación" pide inicio (≥ hoy y ≥ inicio de la actual) y fin o "sin fin"; si la actual sigue abierta
  en esa fecha, termina el día antes. Opcionalmente copia sus ejercicios.
  El administrador edita la más reciente que no ha terminado (puede ser una que empieza más adelante); su nombre y
  fechas se cambian en #/admin/p/ID, sin solaparse con la anterior ni la siguiente y con fin ≥ hoy.
  Las terminadas (fin < hoy) son de solo lectura (histórico). Un ejercicio puede repetirse en planificaciones distintas.
- Cada serie registrada guarda lo prescrito ese día (cantidad, unidad, series, x2, planId): editar después la
  asignación no reescribe el histórico. Registros anteriores sin esa copia usan los valores de la asignación.
- Tablas comunes, no una pestaña por usuario: permite histórico y un único catálogo. La comodidad del responsable se resuelve con el modo administrador de la app.
- Nomenclatura del entrenador: ejercicio base = categoría + letra (`4E`, de `1A` a `9Z`, con Ñ entre N y O); variante = base + número (`4E1`, `4E2`). setup() crea los 243 ejercicios base sin nombre; las variantes las añade el administrador.
- El nombre puede quedar vacío a propósito: p. ej. A, B y C cambian cada clase y los explica el entrenador. En pantalla se muestra solo el ID.
- Cada variante tiene su nombre y su vídeo; si no tiene vídeo, usa el del ejercicio base. Una asignación apunta a un base (`4E`) o a una variante (`4E1`).
- Los números de variante eliminada no se reutilizan, para que el histórico no se mezcle.
- `x2` (se muestra como x₂ junto a la cantidad): la repetición cuenta al hacerla con los dos lados (curl con ambos brazos) o ida y vuelta (empujes en pista). Es de la asignación, no del ejercicio: el entrenador lo decide en cada plan.
- Un mismo ID no puede estar dos veces en la misma planificación (se edita, no se duplica). Variantes distintas del mismo ejercicio (4E1 y 4E2) sí pueden convivir.
- Códigos de usuario aleatorios de 6 caracteres sin 0/O/1/I.
- Borrado lógico (`activo = FALSE`), nunca se borran filas salvo en Registro al desmarcar una serie.
- Los ejercicios base no se eliminan (son fijos, A–Z). Una variante no se puede eliminar mientras esté asignada.
- Vídeos de YouTube como "ocultos" (no "privados": los privados no se reproducen para otros).

## Flujo de trabajo

**Reglas para cada sesión:**
1. Antes de cambiar nada, `git pull`. Al terminar, ejecuta `./tests/run.sh`; si falla, arréglalo antes de subir.
2. Si añades o cambias comportamiento del backend, añade su prueba en `tests/`. Si cambias una acción, cámbiala
   también en el modo demo (`web/api.js`).
3. Trabaja directamente sobre `main` y haz push al terminar (proyecto de una sola persona; no hace falta rama ni PR),
   salvo que te pida otra cosa.
4. Después del push, comprueba que se publicó (ver más abajo) y dime en 2–3 pasos cómo probarlo en el móvil.
5. Las pruebas en navegador (Playwright) se hacen con `API_URL` vacía en `web/config.js` (modo demo), y se restaura
   después. Nunca subas `config.js` con la URL vacía.
6. Este archivo es la memoria del proyecto: si cambias la arquitectura, el modelo de datos o se toma una decisión
   nueva, actualízalo en el mismo push. Lo que no esté aquí, la siguiente sesión no lo sabrá.

- Cambios en `web/` → commit y push a `main` → GitHub Pages publica en ~1 minuto → recargar en el móvil.
- Cambios en `apps-script/Code.gs` → push a `main` → el flujo "Publicar backend" lo sube a Apps Script, crea una
  versión y la pone en la implementación (misma URL). Datos en `apps-script/deploy.json`; lógica en
  `.github/scripts/google.mjs`. La credencial de Google está cifrada en `.github/google-token.enc` y la clave es el
  secreto `GOOGLE_AUTH` del repositorio. Si ese flujo falla, el resultado está en la pestaña Actions de GitHub.
- Para comprobar desde una sesión si un push publicó bien (la API de /actions está bloqueada, esta no):
  `gh api repos/gardagon/Rustic/commits/<sha>/check-runs --jq '.check_runs[] | "\(.name) \(.conclusion)"'`
  El job `publicar` / `conectar` solo acaba en success si la app web publicada respondió bien.
- Si un cambio de Code.gs altera el esquema de la hoja, sube `SCHEMA_VERSION`: se migra sola al publicar.
- Sin dependencias ni paso de build. Mantenerlo así salvo que haya un motivo claro.
- Probar en local: `cd web && python3 -m http.server 8000`.

## Seguridad del repositorio

- El repositorio es público: cualquiera puede leer el código, pero solo el dueño puede cambiarlo. Nunca aceptar pull requests de terceros sin revisarlos.
- Nunca poner en el repositorio claves, la URL de la hoja ni datos de usuarios. La clave de administrador vive en las propiedades del script.
- La URL del script en `web/config.js` es pública por diseño: sin código de usuario o clave de admin no devuelve nada.

## Pendiente / ideas

- Nombres reales de las 9 categorías (se editan desde Administración → Ejercicios → Renombrar).
- Rendimiento: getPlan y getHistory leen todo Registro. Con ~50.000 filas empezará a notarse; entonces leer solo
  los últimos días o archivar por años.
- Gráfica de evolución por ejercicio (cantidad prescrita y cumplimiento a lo largo de las planificaciones).
- Reordenar ejercicios dentro de una categoría.
