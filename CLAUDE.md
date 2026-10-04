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
  app.js        Interfaz. Rutas por hash: #/ , #/plan , #/admin , #/admin/ejercicios , #/admin/u/CODIGO
  sw.js         Service worker "red primero": los cambios se ven al recargar.
apps-script/
  Code.gs       Backend en Google Apps Script vinculado a la Google Sheet (la base de datos).
.github/workflows/deploy.yml   Publica web/ en GitHub Pages en cada push a main.
```

### Modelo de datos (pestañas de la Google Sheet)

| Pestaña | Columnas |
|---|---|
| Categorias | id (1–9), nombre |
| Variantes | nombre |
| Catalogo | id, categoria, nombre, video, activo |
| Usuarios | codigo, nombre, activo |
| Asignaciones | id, codigo, ejercicioId, cantidad, unidad (reps/seg/min), series, variante, orden, activo |
| Registro | fecha (yyyy-MM-dd, Europe/Madrid), codigo, asignacionId, ejercicioId, serie, timestamp |

Decisiones tomadas:
- Tablas comunes, no una pestaña por usuario: permite histórico y un único catálogo. La comodidad del responsable se resuelve con el modo administrador de la app.
- IDs de ejercicio `{categoria}-{nnn}` (ej. `3-007`), generados automáticamente. Sin depender de mayúsculas/minúsculas, porque Sheets no las distingue en búsquedas.
- Códigos de usuario aleatorios de 6 caracteres sin 0/O/1/I.
- Borrado lógico (`activo = FALSE`), nunca se borran filas salvo en Registro al desmarcar una serie.
- Vídeos de YouTube como "ocultos" (no "privados": los privados no se reproducen para otros).

## Flujo de trabajo

- Cambios en `web/` → commit y push a `main` → GitHub Pages publica en ~1 minuto → recargar en el móvil.
- Cambios en `apps-script/Code.gs` NO se despliegan solos: hay que copiarlo al editor de Apps Script e ir a Implementar → Gestionar implementaciones → editar → Nueva versión. Avísame siempre que un cambio lo requiera.
- Sin dependencias ni paso de build. Mantenerlo así salvo que haya un motivo claro.
- Probar en local: `cd web && python3 -m http.server 8000`.

## Pendiente / ideas

- Nombres reales de las 9 categorías (se editan desde Administración → Ejercicios → Renombrar).
- Valores reales de "variante" (pestaña Variantes).
- Vista de histórico por días (los datos ya se guardan en Registro).
- Editar cantidad/series de una asignación sin quitarla y volverla a crear.
- Reordenar ejercicios dentro de una categoría.
