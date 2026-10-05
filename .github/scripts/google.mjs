// Publicación del backend en Google Apps Script desde GitHub Actions.
//
//   node google.mjs canjear   GOOGLE_AUTH=<URL de localhost o código>  → escribe el refresh token en $TOKEN_FILE
//   node google.mjs publicar  REFRESH_TOKEN=<token>                     → sube Code.gs, crea versión y actualiza la implementación
//
// Cliente OAuth: el público de clasp, la herramienta oficial de Google para Apps Script
// (viene en su código abierto). Solo se piden permisos sobre proyectos e implementaciones de Apps Script.
import { readFileSync, writeFileSync } from 'node:fs';

export const CLIENT_ID = '1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com';
const CLIENT_SECRET = 'v6V3fKV_zWU7iw1DrpO1rknX';
export const REDIRECT_URI = 'http://localhost';
export const SCOPES = ['https://www.googleapis.com/auth/script.projects', 'https://www.googleapis.com/auth/script.deployments'];
const API = 'https://script.googleapis.com/v1';

export function authUrl() {
  const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    access_type: 'offline', prompt: 'consent', scope: SCOPES.join(' ') });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}

// Acepta la URL completa a la que redirige Google (http://localhost/?code=...) o solo el código.
export function extractCode(input) {
  const t = String(input || '').trim();
  if (!t) throw new Error('El secreto GOOGLE_AUTH está vacío.');
  const m = t.match(/[?&]code=([^&#\s]+)/);
  return decodeURIComponent(m ? m[1] : t);
}

async function token(params, f = fetch) {
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params })
  });
  const j = await r.json();
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw new Error('Google rechaza el código: ya se usó o ha caducado (duran unos minutos). Repite la autorización y actualiza el secreto GOOGLE_AUTH.');
    throw new Error('Google: ' + (j.error_description || j.error || r.status));
  }
  return j;
}

export async function exchange(code, f = fetch) {
  const j = await token({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }, f);
  if (!j.refresh_token) throw new Error('Google no devolvió una credencial permanente. Repite la autorización desde el enlace.');
  return j.refresh_token;
}

async function api(f, accessToken, method, path, body) {
  const r = await f(API + path, {
    method, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || r.status;
    if (/has not enabled the Apps Script API|not been used in project|is disabled/i.test(msg))
      throw new Error('La "API de Google Apps Script" está desactivada. Actívala en https://script.google.com/home/usersettings');
    if (r.status === 404) throw new Error('No encuentro el proyecto o la implementación. Revisa scriptId y deploymentId en apps-script/deploy.json.');
    throw new Error(`Apps Script ${method} ${path}: ${msg}`);
  }
  return j;
}

// Sustituye el código del proyecto conservando su manifiesto (appsscript.json) y el nombre de su archivo.
export function replaceSource(files, source) {
  const server = files.filter(x => x.type === 'SERVER_JS');
  let target = server.length === 1 ? server[0] : server.find(x => /^(code|c[oó]digo)$/i.test(x.name));
  if (!target) throw new Error('El proyecto tiene varios archivos de código (' + server.map(x => x.name).join(', ') + '). Déjalo en uno solo.');
  return files.map(x => (x === target ? { ...x, source } : x));
}

export async function publish({ refreshToken, scriptId, deploymentId, source, descripcion }, f = fetch) {
  const { access_token } = await token({ refresh_token: refreshToken, grant_type: 'refresh_token' }, f);
  const actual = await api(f, access_token, 'GET', `/projects/${scriptId}/content`);
  const files = replaceSource(actual.files || [], source);
  await api(f, access_token, 'PUT', `/projects/${scriptId}/content`, { files });
  const v = await api(f, access_token, 'POST', `/projects/${scriptId}/versions`, { description: descripcion });
  await api(f, access_token, 'PUT', `/projects/${scriptId}/deployments/${deploymentId}`, {
    deploymentConfig: { scriptId, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: descripcion }
  });
  return v.versionNumber;
}

// Llama a la aplicación web publicada: además de comprobarla, pone la hoja al día (ensureSchema_).
export async function verify(deploymentId, f = fetch) {
  const url = `https://script.google.com/macros/s/${deploymentId}/exec`;
  let ultimo = '';
  for (let i = 0; i < 5; i++) {
    try {
      const r = await f(url, { redirect: 'follow' });
      const txt = await r.text();
      const j = JSON.parse(txt);
      if (j.ok) return j;
      ultimo = txt.slice(0, 200);
    } catch (e) { ultimo = String(e.message || e); }
    await new Promise(res => setTimeout(res, 3000 * (i + 1)));
  }
  throw new Error('Publicado, pero la aplicación web no responde bien: ' + ultimo);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'url') { console.log(authUrl()); return; }
  if (cmd === 'canjear') {
    const rt = await exchange(extractCode(process.env.GOOGLE_AUTH));
    writeFileSync(process.env.TOKEN_FILE, rt, { mode: 0o600 });
    console.log('Credencial obtenida.');
    return;
  }
  if (cmd === 'publicar') {
    const cfg = JSON.parse(readFileSync('apps-script/deploy.json', 'utf8'));
    const source = readFileSync(cfg.archivo, 'utf8');
    const desc = (process.env.DESCRIPCION || 'Publicado desde GitHub').slice(0, 100);
    const n = await publish({ refreshToken: process.env.REFRESH_TOKEN, scriptId: cfg.scriptId, deploymentId: cfg.deploymentId, source, descripcion: desc });
    console.log(`Versión ${n} publicada en la implementación.`);
    const j = await verify(cfg.deploymentId);
    console.log(`Backend activo (esquema ${j.esquema ?? '?'}).`);
    return;
  }
  throw new Error('Uso: node google.mjs url|canjear|publicar');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.log('::error::' + (e.message || e)); process.exit(1); });
}
