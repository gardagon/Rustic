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
                #/admin/ej/ID (editar ejercicio o variante) , #/admin/a/ID (editar asignación)
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
| Planes | id, codigo, nombre, inicio, fin (vacío = vigente) |
| Asignaciones | id, codigo, ejercicioId, cantidad, unidad (reps/seg/min), series, x2, orden, activo, planId |
| Registro | fecha (yyyy-MM-dd, Europe/Madrid), codigo, asignacionId, ejercicioId, serie, timestamp, planId, cantidad, unidad, series, x2 |

Las columnas se localizan por su cabecera (`appendObj_`, `readTable_`), no por su posición. `setup()` es idempotente:
crea lo que falta, añade columnas nuevas al final y migra datos antiguos; nunca borra. Se ejecuta solo: si
`SCHEMA_VERSION` (en Code.gs) es mayor que la guardada en las propiedades del script, la primera petición lo lanza.
Al cambiar el esquema, sube `SCHEMA_VERSION`. La web debe tolerar el backend anterior hasta que se publique.

Decisiones tomadas:
- Planificaciones por bloques: el entrenador cambia el plan entero según su criterio. "Nueva planificación" cierra la
  vigente (fin = hoy) y abre otra desde hoy, opcionalmente copiando sus ejercicios. Solo hay una vigente por usuario.
  Las cerradas son de solo lectura (histórico). Un ejercicio puede repetirse en planificaciones distintas.
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

- Cambios en `web/` → commit y push a `main` → GitHub Pages publica en ~1 minuto → recargar en el móvil.
- Cambios en `apps-script/Code.gs` NO se despliegan solos: hay que copiarlo al editor de Apps Script e ir a Implementar → Gestionar implementaciones → editar → Nueva versión. Avísame siempre que un cambio lo requiera.
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
