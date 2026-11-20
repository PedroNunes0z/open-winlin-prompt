// Armazenamento dos anexos em IndexedDB (o localStorage é pequeno demais para
// arquivos). O workspace (localStorage) guarda só os metadados; o conteúdo
// (Blob) fica aqui, com limite muito maior.

const DB_NAME = 'open-winlin-prompt';
const STORE = 'attachments';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function putBlob(id, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteBlob(id) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* indisponível: ignora */
  }
}

// Texto de um anexo de texto (com cache em memória).
export async function getAttachmentText(attachment) {
  if (attachment.content != null) return attachment.content;
  const blob = await getBlob(attachment.id);
  const text = blob ? await blob.text() : '';
  attachment.content = text;
  return text;
}

// URL temporária para pré-visualização/baixada (chame revoke depois).
export async function getAttachmentUrl(attachment) {
  const blob = await getBlob(attachment.id);
  return blob ? URL.createObjectURL(blob) : null;
}

// Migração: anexos antigos guardavam o conteúdo dentro do workspace
// (localStorage). Move para o IndexedDB e limpa o conteúdo do JSON.
export async function migrateLegacyAttachments(state) {
  let changed = false;
  for (const project of state.projects || []) {
    for (const attachment of project.attachments || []) {
      if (attachment.content == null) continue;
      try {
        const blob = attachment.binary
          ? await (await fetch(attachment.content)).blob()
          : new Blob([attachment.content], { type: attachment.type || 'text/plain' });
        await putBlob(attachment.id, blob);
        attachment.content = null;
        changed = true;
      } catch {
        /* mantém o conteúdo no workspace se a migração falhar */
      }
    }
  }
  return changed;
}
