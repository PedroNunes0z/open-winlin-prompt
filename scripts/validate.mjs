import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const APP_URL = `file:///${process.cwd().replace(/\\/g, '/')}/dist/index.html`;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/Vaio/AppData/Local/Temp/ps-cdp-profile',
  '--window-size=1440,900',
  APP_URL,
], { stdio: 'ignore' });

let page;
for (let i = 0; i < 60; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (page) break;
  } catch { /* waiting */ }
  await sleep(200);
}
if (!page) {
  console.error('No CDP page target found');
  chrome.kill();
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    errors.push(message.params.entry.text);
  }
};
function send(method, params = {}) {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
}

await send('Runtime.enable');
await send('Log.enable');
await sleep(1800);

const expression = `(() => {
  const el = (s) => document.querySelector(s);
  const rect = (s) => { const r = el(s)?.getBoundingClientRect(); return r ? {w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y)} : null; };
  const cs = (s) => { const c = el(s) && getComputedStyle(el(s)); return c ? {display:c.display, width:c.width, color:c.color} : null; };
  return {
    dropdown: rect('#projectSwitcher'), dropdownStyle: cs('#projectSwitcher'),
    dropdownControl: el('#projectSwitcher')?.querySelector('button[slot="control"]')?.textContent?.trim(),
    dropdownSelected: el('#projectSwitcher')?.selectedOptions?.length,
    dropdownText: el('#projectSwitcher')?.textContent,
    dropdownShadow: el('#projectSwitcher')?.shadowRoot?.textContent?.trim().slice(0, 180),
    treeItems: document.querySelectorAll('.tree-item').length,
    tabs: document.querySelectorAll('.tab').length,
    codeBlocks: document.querySelectorAll('.code-block').length,
    katex: document.querySelectorAll('.katex').length,
    highlighted: document.querySelectorAll('.hljs-keyword, .hljs-string, .hljs-title').length,
    editorTextLength: el('#editor')?.textContent.length,
    mentionTags: document.querySelectorAll('.mention-tag').length,
    status: el('#saveStatus')?.textContent,
    search: rect('#searchInput'),
  };
})()`;

const result = await send('Runtime.evaluate', { expression, returnByValue: true });
console.log(JSON.stringify({ checks: result.result.value, errors }, null, 2));

ws.close();
chrome.kill();
