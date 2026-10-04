# Rustic

Plan de ejercicios por usuario, con la Google Sheet como base de datos. Web app instalable en el móvil (PWA).

- **Usuario:** entra con su código, ve sus ejercicios en 9 categorías y marca cada serie que hace.
- **Administrador:** crea usuarios, pone nombre y vídeo a los ejercicios (de `1A` a `9Z`, con Ñ), les añade variantes (`4E1`, `4E2`…) y los asigna.

La app arranca en **modo demo** (sin backend): código `DEMO`, clave de administrador `admin`.

---

## Puesta en marcha

### 1. Subir el proyecto a GitHub
Crea un repositorio vacío llamado `rustic` y sube el contenido de esta carpeta a la rama `main`.

### 2. Activar la publicación
En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Cada push a `main` publica la app en `https://TU-USUARIO.github.io/rustic/` en un minuto, más o menos.
Si el primer despliegue falló porque Pages aún no estaba activado, relánzalo desde **Actions → Publicar en GitHub Pages → Run workflow**.

### 3. Probarla en el móvil (todavía en modo demo)
Abre la URL en el móvil y añádela a la pantalla de inicio:
- iPhone (Safari): Compartir → Añadir a pantalla de inicio.
- Android (Chrome): menú ⋮ → Instalar aplicación.

### 4. Conectar la Google Sheet
1. Crea una Google Sheet nueva y vacía (por ejemplo, "Rustic BD").
2. **Extensiones → Apps Script**. Borra lo que haya y pega el contenido de `apps-script/Code.gs`. Guarda.
3. Arriba, elige la función `setup` y pulsa **Ejecutar**. Autoriza los permisos (es tu propio script).
4. Abre **Registro de ejecución**: ahí aparece la **clave de administrador**. Guárdala.
5. **Implementar → Nueva implementación → tipo: Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. Copia la URL que termina en `/exec` y pégala en `web/config.js` como `API_URL`. Haz push.

Desde ese momento la app usa la hoja real. Entra como administrador, pon nombre a los ejercicios que lo necesiten, crea los usuarios y asígnales ejercicios.

> Cada vez que cambie `Code.gs`, hay que pegarlo de nuevo y en **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión**. La URL no cambia.
>
> Si el cambio afecta a las pestañas de la hoja, no hace falta hacer nada más: la primera petición tras publicar pone la hoja al día sola (añade lo que falta y migra datos, nunca borra).

### 5. Trabajar desde el móvil
Con el repositorio conectado a Claude, pide cambios desde la app del móvil sobre `rustic`. Cuando lleguen a `main`, se publican solos: recarga la app y pruébalos.

---

## Seguridad: qué protege y qué no
- Cada usuario solo recibe sus propios datos; la hoja no es pública.
- El código de usuario es la única llave: vale para planes de ejercicio, no para datos sensibles.
- La clave de administrador está en las propiedades del script, no en el código del repositorio.

Más detalles técnicos y decisiones: [`CLAUDE.md`](CLAUDE.md).
