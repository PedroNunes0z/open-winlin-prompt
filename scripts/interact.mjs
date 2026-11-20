import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9335;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = `file:///${process.cwd().replace(/\\/g, '/')}/dist/index.html`;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/Vaio/AppData/Local/Temp/ps-cdp-interact2',
  '--window-size=1440,900', APP_URL,
], { stdio: 'ignore' });

let page;
for (let i = 0; i < 60; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (page) break;
  } catch { /* wait */ }
  await sleep(200);
}
if (!page) { console.error('no page'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    const { resolve } = pending.get(m.id);
    pending.delete(m.id);
    resolve(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
};
const send = (method, params = {}) => {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve) => pending.set(messageId, { resolve }));
};
const run = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) errors.push(result.exceptionDetails.text);
  return result.result?.value;
};
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
const shot = async (name) => {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(name, Buffer.from(result.data, 'base64'));
};
await sleep(1500);

const checks = {};

checks.initial = await run(`({
  projects: document.querySelectorAll('fluent-option').length,
  prompts: document.querySelectorAll('.tree-item[data-kind="prompt"]').length,
  attachments: document.querySelectorAll('.tree-item[data-kind="attachment"]').length,
  mentionTags: document.querySelectorAll('.mention-tag').length,
  favicon: document.querySelector('link[rel="icon"]')?.href.includes('svg'),
  logoIsSparkle: !!document.querySelector('.app-mark svg')
})`);

checks.toolbarOrder = await run(`(() => {
  const fmt = document.querySelector('.format-group');
  const copy = document.querySelector('#copyBtn');
  return { formatBeforeCopy: !!(fmt.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING) };
})()`);

// Novo projeto e prompt
await run(`document.querySelector('#newProjectBtn').click()`);
await sleep(250);
await run(`document.querySelector('#projectNameInput').value = 'Projeto Teste'`);
await run(`document.querySelector('#projectCreate').click()`);
await sleep(900);
await run(`document.querySelector('#newPromptBtn').click()`);
await sleep(250);
await run(`document.querySelector('#promptNameInput').value = 'Prompt de teste'`);
await run(`document.querySelector('#promptCreate').click()`);
await sleep(400);
checks.created = await run(`({
  dropdown: document.querySelector('#projectSwitcher button[slot="control"]')?.textContent.trim(),
  activeTab: document.querySelector('.tab.is-active .tab__name')?.textContent,
  editorText: document.querySelector('#editor').textContent
})`);

// Menção @ -> tag
await run(`(() => {
  const e = document.querySelector('#editor');
  e.innerHTML = '';
  const t = document.createTextNode('Analise @');
  e.appendChild(t);
  const r = document.createRange(); r.setStart(t, t.textContent.length); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  e.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(300);
checks.mention = await run(`({
  visible: document.querySelector('#mentionDropdown').classList.contains('is-visible'),
  items: document.querySelectorAll('.mention-item').length
})`);
await shot('mention_preview.png');

await run(`document.querySelector('#editor').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}))`);
await sleep(250);
checks.mentionTag = await run(`({
  count: document.querySelectorAll('.mention-tag').length,
  label: document.querySelector('.mention-tag')?.textContent,
  text: document.querySelector('#editor').textContent,
  styled: getComputedStyle(document.querySelector('.mention-tag')).backgroundColor
})`);
await shot('tag_preview.png');

// Backspace apaga a tag inteira
await run(`(() => {
  const e = document.querySelector('#editor');
  const chip = e.querySelector('.mention-tag');
  const space = chip.nextSibling;
  const r = document.createRange(); r.setStart(space, 0); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  e.dispatchEvent(new KeyboardEvent('keydown', {key:'Backspace', bubbles:true, cancelable:true}));
})()`);
await sleep(200);
checks.atomicDelete = await run(`({
  tags: document.querySelectorAll('.mention-tag').length,
  text: document.querySelector('#editor').textContent
})`);

// Configurações: painel, modo claro e cor
await run(`document.querySelector('#settingsBtn').click()`);
await sleep(200);
checks.settingsOpen = await run(`document.querySelector('#settingsPanel').classList.contains('is-open')`);
await run(`document.querySelector('[data-mode="light"]').click()`);
await sleep(200);
await run(`document.querySelector('[data-accent="purple"]').click()`);
await sleep(200);
checks.theme = await run(`({
  mode: document.documentElement.dataset.theme,
  accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  swatchActive: document.querySelector('[data-accent="purple"]').classList.contains('is-active')
})`);
await shot('settings_preview.png');
await run(`document.querySelector('[data-mode="dark"]').click()`);
await sleep(150);

// Painéis
await run(`document.querySelector('#togglePreviewBtn').click()`);
await sleep(150);
checks.previewHidden = await run(`document.querySelector('#split').classList.contains('is-hidden')`);
await run(`document.querySelector('#togglePreviewBtn').click()`);
await sleep(150);

// Restaurar exemplo
await run(`document.querySelector('#resetBtn').click()`);
await sleep(250);
await run(`document.querySelector('#confirmDelete').click()`);
await sleep(400);
checks.afterReset = await run(`({
  projects: document.querySelectorAll('fluent-option').length,
  seedMentionTag: document.querySelector('.mention-tag')?.textContent
})`);

// Enviar anexo ao prompt
await run(`document.querySelector('.tree-item[data-kind="attachment"] [data-action="send"]').click()`);
await sleep(250);
checks.attachmentInsert = await run(`document.querySelector('#editor').textContent.includes('anexo: contexto.txt')`);

// Renomear projeto
await run(`document.querySelector('[data-project-action="rename"]').click()`);
await sleep(250);
await run(`document.querySelector('#renameInput').value = 'Projeto Renomeado'`);
await run(`document.querySelector('#renameConfirm').click()`);
await sleep(350);
checks.projectRename = await run(`document.querySelector('.project-info__name')?.textContent`);

// Fechar todas as abas: nada de editor nem barra de botões
for (let i = 0; i < 4; i++) {
  const remaining = await run(`document.querySelectorAll('.tab__close').length`);
  if (!remaining) break;
  await run(`document.querySelector('.tab__close').click()`);
  await sleep(220);
}
checks.allTabsClosed = await run(`({
  tabs: document.querySelectorAll('.tab').length,
  toolbarHidden: document.querySelector('#toolbar').classList.contains('hidden'),
  splitEmpty: document.querySelector('#split').classList.contains('is-empty'),
  editorVisible: document.querySelector('#editor').getClientRects().length > 0,
  tabsHidden: document.querySelector('#tabs').classList.contains('hidden'),
  emptyVisible: !document.querySelector('#emptyState').classList.contains('hidden')
})`);
await shot('empty_preview.png');

// Recriar prompt pelo estado vazio
await run(`document.querySelector('#emptyNewBtn').click()`);
await sleep(250);
await run(`document.querySelector('#promptNameInput').value = 'De volta.md'`);
await run(`document.querySelector('#promptCreate').click()`);
await sleep(350);
checks.reopened = await run(`({
  toolbarVisible: !document.querySelector('#toolbar').classList.contains('hidden'),
  tab: document.querySelector('.tab.is-active .tab__name')?.textContent
})`);

console.log(JSON.stringify({ checks, errors }, null, 2));
ws.close();
chrome.kill();
