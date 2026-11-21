// Backup na nuvem: empacota o workspace (localStorage) e os anexos (IndexedDB)
// em um único JSON e guarda no Google Drive (arquivo próprio do app).
//
// O login do Google só funciona quando a página está em http://localhost:43210
// (origem autorizada no Google Cloud). O módulo avisa quando está em file://.

const CLIENT_ID = '242368795086-f0lk0mjncpsvok2n2n3s2r08r6f3iosv.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FILENAME = 'open-winlin-prompt-backup.json';
const APP_TAG = 'open-winlin-prompt';
const ALLOWED_ORIGIN = 'http://localhost:43210';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

// só os bancos do próprio app (evita despejar dados de outras páginas)
const DB_PREFIX = 'open-winlin-prompt';
const KNOWN_DATABASES = ['open-winlin-prompt'];

let accessToken = null;
let tokenExpiresAt = 0;
const TOKEN_TIMEOUT = 120000;

/* ------------------------------- utilidades ------------------------------- */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function originIsLocalhost() {
  return /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
}

export function backupRequirement() {
  if (originIsLocalhost()) return null;
  return `O backup na nuvem precisa do app aberto em ${ALLOWED_ORIGIN} (o Google não aceita login em arquivos locais).`;
}

function authErrorMessage(raw) {
  const text = String(raw || '');
  if (/origin_mismatch|idpiframe|invalid_client|invalid_request/i.test(text)) {
    return `O Google recusou esta origem. Cadastre ${ALLOWED_ORIGIN} em "Origens JavaScript autorizadas" do Client ID no Google Cloud Console.`;
  }
  return text || 'Login do Google cancelado.';
}

async function waitForGoogle(timeout = 10000) {
  const started = Date.now();
  while (!window.google?.accounts?.oauth2) {
    if (Date.now() - started > timeout) {
      throw new Error('Não foi possível carregar o login do Google. Verifique sua internet e tente de novo.');
    }
    await wait(150);
  }
  return window.google.accounts.oauth2;
}

/* --------------------------------- login ---------------------------------- */

export async function connectGoogleDrive({ silent = false } = {}) {
  const requirement = backupRequirement();
  if (requirement) throw new Error(requirement);

  const oauth2 = await waitForGoogle();

  return new Promise((resolve, reject) => {
    // se o popup for fechado e o Google não avisar, não deixa a interface presa
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('O login do Google não respondeu. Tente de novo.'));
    }, TOKEN_TIMEOUT);

    // um cliente novo por pedido: o callback certo é sempre o desta tentativa
    const tokenClient = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      error_callback: (err) => finish(reject, new Error(authErrorMessage(err?.message))),
      callback: (response) => {
        if (response?.error) {
          finish(reject, new Error(authErrorMessage(response.error_description || response.error)));
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60000;
        finish(resolve, accessToken);
      },
    });

    try {
      tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
    } catch (err) {
      finish(reject, new Error(err?.message || 'Não foi possível abrir o login do Google.'));
    }
  });
}

async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  return connectGoogleDrive({ silent: Boolean(accessToken) });
}

/** fetch autenticado: se o token expirar, pede outro e repete uma vez. */
async function driveFetch(url, options = {}, retried = false) {
  await ensureToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && !retried) {
    accessToken = null;
    tokenExpiresAt = 0;
    return driveFetch(url, options, true);
  }
  return response;
}

async function driveError(response, fallback) {
  try {
    const data = await response.json();
    return new Error(data?.error?.message || fallback);
  } catch {
    return new Error(`${fallback} (HTTP ${response.status})`);
  }
}

/* --------------------- serialização de Blob/File em JSON --------------------- */

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

async function serializeValue(value) {
  if (value instanceof Blob) {
    return {
      __type: value instanceof File ? 'File' : 'Blob',
      name: value.name || 'anexo',
      mime: value.type || 'application/octet-stream',
      lastModified: value.lastModified || Date.now(),
      base64: await blobToBase64(value),
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(serializeValue));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = await serializeValue(item);
    return out;
  }
  return value;
}

function deserializeValue(value) {
  if (value && typeof value === 'object' && (value.__type === 'Blob' || value.__type === 'File')) {
    const blob = base64ToBlob(value.base64, value.mime);
    return value.__type === 'File'
      ? new File([blob], value.name || 'anexo', { type: value.mime, lastModified: value.lastModified })
      : blob;
  }
  if (Array.isArray(value)) return value.map(deserializeValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = deserializeValue(item);
    return out;
  }
  return value;
}

/* ------------------------ workspace + anexos → backup ------------------------ */

async function listAppDatabases() {
  if (typeof indexedDB.databases === 'function') {
    try {
      const databases = await indexedDB.databases();
      const names = databases.map((info) => info.name).filter((name) => name && name.startsWith(DB_PREFIX));
      if (names.length) return names;
    } catch {
      /* alguns navegadores bloqueiam indexedDB.databases() */
    }
  }
  return KNOWN_DATABASES.slice();
}

function dumpDatabase(dbName, onProgress) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const db = request.result;
      const storeNames = Array.from(db.objectStoreNames);
      if (!storeNames.length) {
        db.close();
        resolve({});
        return;
      }

      const tx = db.transaction(storeNames, 'readonly');
      const result = {};

      for (const storeName of storeNames) {
        const items = await new Promise((done) => {
          const all = [];
          const cursorRequest = tx.objectStore(storeName).openCursor();
          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              all.push({ key: cursor.key, value: cursor.value });
              cursor.continue();
            } else {
              done(all);
            }
          };
          cursorRequest.onerror = () => done(all);
        });
        onProgress?.({ stage: 'read', store: storeName, count: items.length });
        result[storeName] = await Promise.all(items.map(async (entry) => ({
          key: entry.key,
          value: await serializeValue(entry.value),
        })));
      }

      db.close();
      resolve(result);
    };
  });
}

export async function buildBackupPayload({ onProgress } = {}) {
  const localData = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    localData[key] = localStorage.getItem(key);
  }

  const databases = await listAppDatabases();
  const idbData = {};
  for (const name of databases) {
    onProgress?.({ stage: 'database', name });
    idbData[name] = await dumpDatabase(name, onProgress);
  }

  return {
    app: APP_TAG,
    exportedAt: new Date().toISOString(),
    origin: location.origin,
    localStorage: localData,
    indexedDB: idbData,
  };
}

export async function applyBackupPayload(payload) {
  if (!payload || payload.app !== APP_TAG || !payload.localStorage) {
    throw new Error('Arquivo de backup inválido (não parece ser um backup do Open Winlin Prompt).');
  }

  localStorage.clear();
  for (const [key, value] of Object.entries(payload.localStorage)) {
    if (typeof value === 'string') localStorage.setItem(key, value);
  }

  for (const [dbName, stores] of Object.entries(payload.indexedDB || {})) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const validStores = Object.keys(stores).filter((name) => db.objectStoreNames.contains(name));
        if (!validStores.length) {
          db.close();
          resolve();
          return;
        }

        const tx = db.transaction(validStores, 'readwrite');
        for (const storeName of validStores) {
          const store = tx.objectStore(storeName);
          store.clear();
          for (const entry of stores[storeName]) {
            const value = deserializeValue(entry.value);
            if (store.keyPath) store.put(value);
            else store.put(value, entry.key);
          }
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }

  return payload;
}

/* --------------------------------- Drive ---------------------------------- */

async function findBackupFile() {
  const query = encodeURIComponent(`name='${BACKUP_FILENAME}' and trashed=false`);
  const response = await driveFetch(
    `${DRIVE_FILES}?q=${query}&fields=files(id,name,modifiedTime,size)&spaces=drive`,
  );
  if (!response.ok) throw await driveError(response, 'Erro ao consultar o Google Drive.');
  const data = await response.json();
  return data.files?.[0] || null;
}

async function uploadBackup(text, fileId) {
  const metadata = { name: BACKUP_FILENAME, mimeType: 'application/json' };
  const url = fileId
    ? `${DRIVE_UPLOAD}/${fileId}?uploadType=resumable&fields=id,name,modifiedTime,size`
    : `${DRIVE_UPLOAD}?uploadType=resumable&fields=id,name,modifiedTime,size`;

  // envio retomável: aceita backups grandes (anexos em base64 passam fácil de 5 MB)
  const start = await driveFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/json',
      'X-Upload-Content-Length': String(new Blob([text]).size),
    },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) throw await driveError(start, 'Não foi possível iniciar o envio do backup.');

  const uploadUrl = start.headers.get('Location');
  if (!uploadUrl) throw new Error('O Google não devolveu o endereço de envio do backup.');

  const upload = await driveFetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: text,
  });
  if (!upload.ok) throw await driveError(upload, 'Falha ao enviar o backup para o Google Drive.');
  return upload.json();
}

export async function saveToGoogleDrive({ onProgress } = {}) {
  const requirement = backupRequirement();
  if (requirement) throw new Error(requirement);

  await ensureToken();
  onProgress?.({ stage: 'collect' });
  const payload = await buildBackupPayload({ onProgress });
  const text = JSON.stringify(payload);
  onProgress?.({ stage: 'upload', size: new Blob([text]).size });

  const existing = await findBackupFile();
  const file = await uploadBackup(text, existing?.id || null);
  onProgress?.({ stage: 'done', size: Number(file?.size) || new Blob([text]).size });
  return file;
}

export async function restoreFromGoogleDrive({ onProgress } = {}) {
  const requirement = backupRequirement();
  if (requirement) throw new Error(requirement);

  await ensureToken();
  const existing = await findBackupFile();
  if (!existing) throw new Error('Nenhum backup encontrado na sua conta do Google Drive.');

  onProgress?.({ stage: 'download' });
  const response = await driveFetch(`${DRIVE_FILES}/${existing.id}?alt=media`);
  if (!response.ok) throw await driveError(response, 'Falha ao baixar o backup do Google Drive.');

  const payload = await response.json();
  onProgress?.({ stage: 'restore' });
  await applyBackupPayload(payload);
  return { payload, modifiedTime: existing.modifiedTime };
}

/* ------------------------- backup local (.json) -------------------------- */

/** Gera o backup completo (workspace + anexos) como um Blob .json. */
export async function createBackupBlob({ onProgress } = {}) {
  onProgress?.({ stage: 'collect' });
  const payload = await buildBackupPayload({ onProgress });
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function restoreBackupText(text, { onProgress } = {}) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('O arquivo escolhido não é um JSON válido.');
  }
  onProgress?.({ stage: 'restore' });
  await applyBackupPayload(payload);
  return payload;
}
