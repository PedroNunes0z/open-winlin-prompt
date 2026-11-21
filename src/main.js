import '@fluentui/web-components/button.js';
import '@fluentui/web-components/text-input.js';
import '@fluentui/web-components/dropdown.js';
import '@fluentui/web-components/option.js';
import '@fluentui/web-components/listbox.js';
import '@fluentui/web-components/progress-bar.js';
import '@fluentui/web-components/dialog.js';
import '@fluentui/web-components/badge.js';
import '@fluentui/web-components/divider.js';
import '@fluentui/web-components/checkbox.js';
import '@fluentui/web-components/textarea.js';
import { setTheme } from '@fluentui/web-components';
import { webDarkTheme, webLightTheme } from '@fluentui/tokens';

import './styles.css';
import {
  state, uid, persist, setSavedHandler, getActiveProject, getPrompt,
  findPromptById, usageBytes, exportWorkspace, importWorkspace, resetWorkspace,
} from './store.js';
import { renderMarkdown } from './markdown.js';
import { MentionController } from './mentions.js';
import { readEditor, writeEditor, insertText, wrapSelection, toggleWrap, toggleLinePrefix } from './editor.js';
import { putBlob, getBlob, deleteBlob, getAttachmentText, getAttachmentUrl, migrateLegacyAttachments } from './attachment-data.js';
import { applyIcons, icons, fileIcon } from './icons.js';
import logoSvg from './assets/img/logo.svg?raw';
import configScript from '../scripts/configurar-ollama.ps1?raw';

const ACCENTS = {
  cyan:   { dark: '#00d2ff', light: '#3a7bd5', bg: '#3a7bd5', rgb: '0, 210, 255' },
  blue:   { dark: '#60cdff', light: '#0067c0', bg: '#005a9e', rgb: '96, 205, 255' },
  purple: { dark: '#b48cff', light: '#7a26d8', bg: '#7a26d8', rgb: '180, 140, 255' },
  teal:   { dark: '#4dd0c1', light: '#007f75', bg: '#007a70', rgb: '77, 208, 193' },
  green:  { dark: '#6ccb8f', light: '#117a3d', bg: '#137a41', rgb: '108, 203, 143' },
  orange: { dark: '#ffab70', light: '#a34e00', bg: '#a34e00', rgb: '255, 171, 112' },
  pink:   { dark: '#ff8fc7', light: '#b3176b', bg: '#b3176b', rgb: '255, 143, 199' },
};

const $ = (selector) => document.querySelector(selector);
const now = () => new Date().toISOString();

const els = {
  switcher: $('#projectSwitcher'),
  tree: $('#tree'),
  tabs: $('#tabs'),
  editor: $('#editor'),
  preview: $('#preview'),
  editorContainer: $('#editorContainer'),
  mentionDropdown: $('#mentionDropdown'),
  split: $('#split'),
  toolbar: $('#toolbar'),
  divider: $('#splitDivider'),
  previewPane: $('#previewPane'),
  emptyState: $('#emptyState'),
  search: $('#searchInput'),
  projectInfo: $('#projectInfo'),
  storageLabel: $('#storageLabel'),
  storageBar: $('#storageBar'),
  statusProject: $('#statusProject'),
  statusPrompt: $('#statusPrompt'),
  statusWords: $('#statusWords'),
  statusChars: $('#statusChars'),
  saveStatus: $('#saveStatus'),
  fileInput: $('#fileInput'),
  importInput: $('#importInput'),
  toasts: $('#toasts'),
};

let searchQuery = '';
let renameTarget = null;
let pendingConfirm = null;
let previewVisible = true;
let previewTimer = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/* --------------------------- tema e notificações --------------------------- */

function applyTheme() {
  const theme = state.theme === 'light' ? webLightTheme : webDarkTheme;
  setTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.style.colorScheme = state.theme;

  const accent = ACCENTS[state.accent] || ACCENTS.cyan;
  const brandFg = state.theme === 'light' ? accent.light : accent.dark;
  const accentSoft = `rgba(${accent.rgb}, ${state.theme === 'light' ? '0.12' : '0.16'})`;
  root.style.setProperty('--accent', brandFg);
  root.style.setProperty('--accent-bg', accent.bg);
  root.style.setProperty('--accent-soft', accentSoft);
  root.style.setProperty('--mention-fg', brandFg);
  root.style.setProperty('--mention-bg', `rgba(${accent.rgb}, ${state.theme === 'light' ? '0.14' : '0.18'})`);
  root.style.setProperty('--mention-border', `rgba(${accent.rgb}, 0.45)`);
  // Componentes Fluent (selos, botões de destaque, progresso, checkboxes...)
  // passam a usar a cor de destaque escolhida, em vez do azul padrão do Fluent.
  root.style.setProperty('--colorBrandBackground', accent.bg);
  root.style.setProperty('--colorBrandBackgroundHover', accent.bg);
  root.style.setProperty('--colorBrandBackgroundPressed', accent.bg);
  root.style.setProperty('--colorBrandBackgroundSelected', accent.bg);
  root.style.setProperty('--colorBrandBackgroundStatic', accent.bg);
  root.style.setProperty('--colorBrandBackground2', accentSoft);
  root.style.setProperty('--colorBrandForeground1', brandFg);
  root.style.setProperty('--colorBrandForeground2', brandFg);
  root.style.setProperty('--colorBrandForegroundOnLight', accent.light);
  root.style.setProperty('--colorBrandForegroundLink', brandFg);
  root.style.setProperty('--colorBrandStroke1', brandFg);
  root.style.setProperty('--colorBrandStroke2', brandFg);
  root.style.setProperty('--colorStrokeFocus1', brandFg);
  root.style.setProperty('--colorStrokeFocus2', brandFg);

  document.querySelectorAll('#modeSwitch button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.theme);
  });
  document.querySelectorAll('.swatch').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.accent === state.accent);
  });
}

function referenceNames() {
  const project = getActiveProject();
  return [...project.attachments.map((a) => a.name), ...project.prompts.map((p) => p.name)];
}

/* ------------------- sugestões de escrita (IA local / Ollama) ------------------- */

const OLLAMA_URL = 'http://localhost:11434';
const AI_MODEL = 'qwen2.5-coder:1.5b';
const AI_SIZES = { short: { tokens: 48, lines: 1 }, medium: { tokens: 96, lines: 2 }, long: { tokens: 256, lines: 6 } };

// Ajustes de velocidade x consistência:
// - contexto curto (2048) e trechos menores = resposta mais rápida;
// - temperatura baixa + top_k/top_p + seed fixa = sugestões previsíveis;
// - stop no fim de bloco = sugestão enxuta.
const AI_OPTIONS = { temperature: 0.1, top_k: 20, top_p: 0.9, repeat_penalty: 1.05, num_ctx: 2048, seed: 42 };
const AI_CONTEXT = { prefix: 1200, suffix: 400 };
const AI_DEBOUNCE = { typing: 450, pause: 950 };
const AI_WARMUP = { model: AI_MODEL, keep_alive: '30m' };

// Sugestão curta e direta: corta no primeiro bloco (linha em branco) e no limite de linhas.
// As linhas vazias do começo não podem contar no limite (senão a sugestão
// vira string vazia quando o modelo começa com uma quebra de linha).
function limitSuggestion(text, size) {
  const block = text.split('\n\n')[0];
  // a quebra inicial faz parte da sugestão (ex.: depois de "def f():" ela é
  // obrigatória); só não conta no limite de linhas
  const lead = (block.match(/^\n+/) || [''])[0];
  const body = block.slice(lead.length);
  if (!body.trim()) return '';
  const lines = body.split('\n').slice(0, size.lines).join('\n').replace(/\s+$/, '');
  return lead + lines;
}

// Durante o streaming: descarta repetição da última linha e mantém só o bloco atual.
function previewSuggestion(text, prefix, size) {
  if (!text) return '';
  let out = text;
  const lastLine = (prefix.split('\n').pop() || '').trim();
  const start = out.replace(/^[ \t]+/, '');
  // o modelo às vezes recomeça a linha atual: remove o trecho repetido
  if (lastLine.length >= 4) {
    if (start.startsWith(lastLine)) out = start.slice(lastLine.length).replace(/^[ \t]*\n?/, '');
    else {
      const head = lastLine.slice(0, Math.min(24, Math.floor(lastLine.length / 2)));
      if (head.length >= 6 && start.startsWith(head)) out = start.slice(head.length);
    }
  }
  return limitSuggestion(out, size);
}

// Evita repetir o que já existe no texto: tira linhas geradas que já estão
// no prefixo/sufixo e descarta a sugestão se for repetição pura.
function dedupeSuggestion(suggestion, prefix, suffix) {
  if (!suggestion) return '';
  // a quebra de linha inicial faz parte da sugestão ("def f():" → "\n    ...")
  const lead = (suggestion.match(/^\n+/) || [''])[0];
  const body = suggestion.slice(lead.length);
  if (!body.trim()) return '';
  const normLines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const known = new Set([...normLines(prefix), ...normLines(suffix)]);
  const lines = body.split('\n');
  while (lines.length > 1 && known.has(lines[0].trim())) lines.shift();
  while (lines.length > 1 && known.has(lines[lines.length - 1].trim())) lines.pop();
  let result = lines.join('\n').trim();
  if (!result) return '';
  // não repete o final do texto que já está antes do cursor
  const tail = (prefix.split('\n').pop() || '').trim();
  if (tail.length >= 6 && result.startsWith(tail)) result = result.slice(tail.length).trim();
  if (!result) return '';
  if (suffix.includes(result) || prefix.includes(result)) return '';
  // sugestão que só repete o que o texto já tem (antes ou depois)
  const suffixHead = suffix.trimStart();
  if (suffixHead.length > 12 && suffixHead.startsWith(result)) return '';
  const resultLines = normLines(result);
  if ((resultLines.length >= 2 || result.length > 40) && resultLines.every((l) => known.has(l))) return '';
  // pontuação solta não ajuda em nada
  if (!/[\p{L}\p{N}]/u.test(result)) return '';

  // Bloco Python ("def f():" / "if x:") espera corpo identado: se o modelo
  // devolveu a primeira linha sem identação, corrigimos para o texto ser válido.
  const lastPrefixLine = (prefix.split('\n').pop() || '').trimEnd();
  if (lead && /:$/.test(lastPrefixLine) && !/^\s/.test(result)) {
    result = result.split('\n').map((line) => (line.trim() ? `    ${line}` : line)).join('\n');
  }

  return lead + result;
}

// Tamanho automático: decide o quanto pedir pelo contexto onde está o cursor.
function resolveAiSize(ai, prefix) {
  const preset = AI_SIZES[ai.size];
  if (preset) return preset;
  const lastLine = prefix.split('\n').pop() || '';
  const trimmed = lastLine.trimEnd();
  const inCodeBlock = (prefix.match(/```/g) || []).length % 2 === 1;
  // linha que abre um bloco ({, (, [, =>) pede o bloco inteiro
  // {, (, [, => ou ":" no fim (Python) abrem um bloco
  const opensBlock = /[{([]$/.test(trimmed) || /=>$/.test(trimmed) || /:$/.test(trimmed);
  if (inCodeBlock || opensBlock) {
    return opensBlock ? AI_SIZES.long : AI_SIZES.medium;
  }
  if (/^\s*$/.test(lastLine)) return AI_SIZES.medium; // parágrafo novo
  if (/^#{1,6}\s/.test(lastLine)) return AI_SIZES.short; // título: só completa a linha
  if (/^\s*([-*+]|\d+\.)\s/.test(lastLine)) return AI_SIZES.medium; // item de lista
  if (/^\s*>/.test(lastLine)) return AI_SIZES.short; // citação
  return AI_SIZES.short; // meio de frase: só o restante da linha
}

let aiOllamaUp = false;
let aiOllamaBlocked = false;
let aiModelReady = false;
let aiChecking = false;
let aiDownloading = false;
let aiAbortPull = null;
let aiAbortGen = null;
let aiTimer = null;
let aiSuggestionText = null;
let aiLastGen = null; // { status: 'busy'|'ok'|'error', ms, at }
let aiWarmedUp = false;
let aiCache = { key: '', text: '' }; // mesma situação (texto anterior + seguinte) = mesma sugestão
let aiRequestToken = null;

// Carrega o modelo na memória antes do primeiro pedido: a primeira sugestão
// deixa de levar vários segundos (carregamento do GGUF no Ollama).
let aiWarmupPromise = null;
function warmAiModel() {
  if (aiWarmedUp) return Promise.resolve();
  if (!aiModelReady || aiDownloading) return Promise.resolve();
  if (!aiWarmupPromise) aiWarmupPromise = doWarmAiModel();
  return aiWarmupPromise;
}

async function doWarmAiModel() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_WARMUP.model,
        prompt: 'a',
        stream: false,
        raw: true,
        keep_alive: AI_WARMUP.keep_alive,
        // o mesmo num_ctx da geração: se mudar, o Ollama recarrega o modelo
        options: { num_predict: 1, num_ctx: AI_OPTIONS.num_ctx, temperature: 0 },
      }),
    });
    aiWarmedUp = res.ok;
  } catch {
    aiWarmedUp = false;
  } finally {
    aiWarmupPromise = null;
  }
}

const aiSettings = () => {
  state.ai ||= { enabled: false, when: 'pause', size: 'auto', model: AI_MODEL };
  return state.ai;
};

const formatAiMs = (ms) => (ms < 1000
  ? `${Math.round(ms)} ms`
  : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

// Barra inferior: mostra se a última geração funcionou/falhou e quanto tempo levou.
function updateAiStatusBar() {
  const el = $('#statusAi');
  if (!el) return;
  const ai = aiSettings();
  let text = 'IA local: desligada';
  let on = false;
  let failed = false;
  let title = '';
  if (ai.enabled && !aiModelReady) {
    text = 'IA local: baixe o modelo';
  } else if (ai.enabled && aiLastGen?.status === 'busy') {
    text = 'IA local: gerando...';
  } else if (ai.enabled && aiLastGen?.status === 'ok') {
    text = `IA local: funcionou em ${formatAiMs(aiLastGen.ms)}`;
    on = true;
    title = `Última sugestão gerada em ${formatAiMs(aiLastGen.ms)} às ${new Date(aiLastGen.at).toLocaleTimeString('pt-BR')}`;
  } else if (ai.enabled && aiLastGen?.status === 'error') {
    text = 'IA local: falhou';
    failed = true;
    title = `A última geração falhou às ${new Date(aiLastGen.at).toLocaleTimeString('pt-BR')}. Verifique se o Ollama está aberto.`;
  } else if (ai.enabled) {
    text = 'IA local: ligada';
  }
  el.textContent = text;
  el.title = title;
  el.classList.toggle('is-on', on);
  el.classList.toggle('is-error', failed);
}

function setAiStatus(message, kind = '') {
  const el = $('#aiModelStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `ai-status${kind ? ` is-${kind}` : ''}`;
}

function renderAiSettings() {
  const ai = aiSettings();
  document.querySelectorAll('#aiEnabledSwitch button').forEach((button) => {
    button.classList.toggle('is-active', String(ai.enabled) === button.dataset.on);
  });
  const whenSelect = $('#aiWhenSelect');
  const sizeSelect = $('#aiSizeSelect');
  if (whenSelect) whenSelect.value = ai.when;
  if (sizeSelect) sizeSelect.value = ai.size;
  $('#aiDownloadBtn')?.classList.toggle('hidden', aiDownloading || aiModelReady || !aiOllamaUp);
  $('#aiCancelBtn')?.classList.toggle('hidden', !aiDownloading);
  $('#aiProgress')?.classList.toggle('hidden', !aiDownloading);
  $('#aiRecheckBtn')?.classList.toggle('hidden', aiDownloading || aiOllamaUp);
  $('#aiOllamaLink')?.classList.toggle('hidden', aiDownloading || aiOllamaUp || aiOllamaBlocked);
  $('#aiFixBox')?.classList.toggle('hidden', !aiOllamaBlocked);
  updateAiStatusBar();
}

async function fetchWithTimeout(url, options = {}, ms = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Descobre se o Ollama responde, mesmo quando o navegador bloqueia a leitura
// (app aberto como arquivo file:// envia Origin "null", rejeitado pelo Ollama).
async function pingOllama() {
  try {
    await fetchWithTimeout(`${OLLAMA_URL}/api/version`, { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

async function checkAiModel() {
  if (aiChecking || aiDownloading) return;
  aiChecking = true;
  setAiStatus('Verificando se o Ollama está aberto...');
  try {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    aiOllamaUp = true;
    aiOllamaBlocked = false;
    aiModelReady = (data.models || []).some((m) => m.name === AI_MODEL);
    setAiStatus(
      aiModelReady
        ? 'Pronto! O modelo já está no seu computador.'
        : 'Ollama aberto, mas o modelo ainda não foi baixado. Baixe para começar.',
      aiModelReady ? 'ok' : '',
    );
    if (aiModelReady) warmAiModel();
  } catch {
    aiOllamaUp = false;
    aiModelReady = false;
    if (await pingOllama()) {
      aiOllamaBlocked = true;
      setAiStatus('Ollama aberto, mas o navegador bloqueou a conexão (o app abre como arquivo). Faça a liberação rápida abaixo.', 'error');
    } else {
      aiOllamaBlocked = false;
      setAiStatus('Ollama não encontrado. Baixe o Ollama e abra o aplicativo dele para continuar.', 'error');
    }
  } finally {
    aiChecking = false;
    renderAiSettings();
  }
}

function handlePullMessage(msg) {
  if (msg.error) throw new Error(msg.error);
  const progress = $('#aiProgress');
  if (msg.total && msg.completed != null) {
    const pct = Math.round((msg.completed / msg.total) * 100);
    if (progress) progress.value = pct;
    setAiStatus(`Baixando o modelo... ${pct}%`);
  } else if (/pulling manifest/i.test(msg.status || '')) {
    setAiStatus('Preparando o download...');
  } else if (/verifying/i.test(msg.status || '')) {
    setAiStatus('Conferindo os arquivos baixados...');
  } else if (/writing/i.test(msg.status || '')) {
    setAiStatus('Guardando o modelo no seu computador...');
  } else if (/success/i.test(msg.status || '')) {
    setAiStatus('Quase lá...');
  }
}

async function downloadAiModel() {
  if (aiDownloading) return;
  if (aiOllamaBlocked) {
    toast('Faça a liberação rápida abaixo e clique em Verificar de novo.');
    return;
  }
  if (!aiOllamaUp) {
    await checkAiModel();
    if (aiOllamaBlocked) {
      toast('Faça a liberação rápida abaixo e clique em Verificar de novo.');
      return;
    }
    if (!aiOllamaUp) {
      toast('Ollama não encontrado. Baixe o Ollama e abra o aplicativo dele primeiro.', 'error');
      return;
    }
  }
  aiDownloading = true;
  aiAbortPull = new AbortController();
  const progress = $('#aiProgress');
  if (progress) progress.value = 0;
  setAiStatus('Baixando o modelo... (986 MB — pode levar alguns minutos)');
  renderAiSettings();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: AI_MODEL, stream: true }),
      signal: aiAbortPull.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handlePullMessage(JSON.parse(line)); } catch { /* linha parcial */ }
      }
    }
    aiModelReady = true;
    aiCache = { key: '', text: '' };
    warmAiModel(); // já carrega na memória para a primeira sugestão ser rápida
    setAiStatus('Pronto! Modelo baixado e pronto para usar.', 'ok');
    toast('Modelo de IA baixado. As sugestões já funcionam!');
  } catch (err) {
    aiModelReady = false;
    if (err?.name === 'AbortError') {
      setAiStatus('Download cancelado. Você pode tentar de novo quando quiser.');
    } else {
      setAiStatus('Não foi possível baixar agora. Confira sua conexão com a internet e tente de novo.');
      toast('Falha ao baixar o modelo de IA', 'error');
    }
  } finally {
    aiDownloading = false;
    aiAbortPull = null;
    renderAiSettings();
  }
}

function aiCaretContext() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !els.editor.contains(selection.getRangeAt(0).startContainer)) return null;
  const range = selection.getRangeAt(0);
  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(els.editor);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const text = readEditor(els.editor);
  const offset = prefixRange.toString().length;
  return { prefix: text.slice(0, offset), suffix: text.slice(offset) };
}

// Posição do cursor (offset no texto) — usada para garantir que a sugestão
// ainda corresponde ao lugar onde o usuário está escrevendo.
function caretOffsetNow() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !els.editor.contains(selection.getRangeAt(0).startContainer)) return null;
  const range = selection.getRangeAt(0);
  const before = range.cloneRange();
  before.selectNodeContents(els.editor);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

async function requestAiSuggestion() {
  const ai = aiSettings();
  if (!ai.enabled || !aiModelReady || aiDownloading) return;
  hideAiSuggestion(); // o texto fantasma não pode entrar no contexto do pedido
  const ctx = aiCaretContext();
  if (!ctx || !ctx.prefix.trim()) return;

  const size = resolveAiSize(ai, ctx.prefix);
  const prefix = ctx.prefix.slice(-AI_CONTEXT.prefix);
  const suffix = ctx.suffix.slice(0, AI_CONTEXT.suffix);
  const caretAt = ctx.prefix.length;

  // Mesma situação de antes? Reaproveita a sugestão (resposta instantânea).
  const key = `${size.tokens}|${prefix.slice(-200)}|${suffix.slice(0, 160)}`;
  if (aiCache.key === key) {
    if (aiCache.text) showAiSuggestion(aiCache.text);
    return;
  }

  aiAbortGen?.abort();
  aiAbortGen = new AbortController();
  const myController = aiAbortGen;
  const token = {};
  aiRequestToken = token;
  aiLastGen = { status: 'busy', ms: 0, at: Date.now() };
  updateAiStatusBar();
  const startedAt = performance.now();
  let full = '';
  let firstTokenAt = 0;

  // Se o cursor sair do lugar (usuário continuou digitando), descarta tudo.
  const stale = () => aiAbortGen !== myController || caretOffsetNow() !== caretAt;

  try {
    // primeira vez: espera o modelo carregar (evita a resposta truncada do cold start)
    if (!aiWarmedUp) await warmAiModel();
    if (stale()) return;
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: myController.signal,
      body: JSON.stringify({
        model: AI_MODEL,
        prompt: `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
        stream: true, // streaming: o texto fantasma aparece enquanto gera
        // raw: true desliga o template de conversa do Ollama — sem ele, o modelo
        // responde como chat ("Claro!...") em vez de completar o texto (FIM).
        raw: true,
        keep_alive: AI_WARMUP.keep_alive, // mantém o modelo carregado entre pedidos
        options: {
          ...AI_OPTIONS,
          num_predict: size.tokens,
          // para no fim do bloco atual, sem emendar a próxima seção
          stop: ['\n\n', '<|endoftext|>', '<|fim_pad|>'],
        },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line).response || '';
          if (chunk && !firstTokenAt) firstTokenAt = performance.now();
          full += chunk;
        } catch { /* linha parcial */ }
      }
      if (full.trim() && !stale()) {
        const preview = previewSuggestion(full, prefix, size);
        if (preview) showAiSuggestion(preview);
      }
    }
    if (buffer.trim()) {
      try { full += JSON.parse(buffer).response || ''; } catch { /* fim de fluxo */ }
    }
    if (stale()) return; // cursor mudou: descarta silenciosamente

    const limited = limitSuggestion(full, size);
    const suggestion = dedupeSuggestion(limited, prefix, suffix);
    if (suggestion) {
      aiCache = { key, text: suggestion };
      aiLastGen = { status: 'ok', ms: performance.now() - startedAt, at: Date.now(), first: firstTokenAt ? firstTokenAt - startedAt : 0 };
      showAiSuggestion(suggestion);
    } else if (limited) {
      // gerou, mas era só repetição do que já existe: descarta sem erro
      aiCache = { key, text: '' };
      aiLastGen = { status: 'ok', ms: performance.now() - startedAt, at: Date.now() };
      hideAiSuggestion();
    } else {
      // resposta vazia (o texto já está completo): não é falha
      aiCache = { key, text: '' };
      aiLastGen = null;
      hideAiSuggestion();
    }
  } catch {
    if (aiAbortGen !== myController || myController.signal.aborted) {
      // cancelada por um pedido mais novo ou pelo usuário: não é falha
      if (aiAbortGen === myController && full.trim()) {
        aiLastGen = { status: 'ok', ms: performance.now() - startedAt, at: Date.now() };
      }
      return;
    }
    // modelo ainda carregando/instável: tenta de novo depois do aquecimento
    if (!aiWarmedUp) warmAiModel();
    aiWarmedUp = false;
    aiLastGen = { status: 'error', ms: performance.now() - startedAt, at: Date.now() };
    hideAiSuggestion();
    /* sugestão é opcional: a falha aparece só na barra inferior, sem interromper a escrita */
  } finally {
    if (aiRequestToken === token) aiRequestToken = null;
    updateAiStatusBar();
  }
}

let ghostEl = null; // span com o texto fantasma inline (opacidade reduzida)

function showAiSuggestion(text) {
  if (aiAbortGen?.signal.aborted) return;
  aiSuggestionText = text;
  if (ghostEl && ghostEl.isConnected) {
    ghostEl.textContent = text;
    return;
  }
  ghostEl = null;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !els.editor.contains(selection.getRangeAt(0).startContainer)) return;
  const range = selection.getRangeAt(0);
  range.collapse(true);
  ghostEl = document.createElement('span');
  ghostEl.className = 'ghost-suggestion';
  ghostEl.contentEditable = 'false';
  ghostEl.textContent = text;
  range.insertNode(ghostEl);
  const caret = document.createRange();
  caret.setStartBefore(ghostEl);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
}

function hideAiSuggestion() {
  aiSuggestionText = null;
  aiAbortGen?.abort(); // dispensar a sugestão também cancela a geração em curso
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }
}

function acceptAiSuggestion() {
  if (!aiSuggestionText) return;
  const text = aiSuggestionText;
  hideAiSuggestion();
  insertText(els.editor, text);
}

function scheduleAiSuggestion() {
  clearTimeout(aiTimer);
  hideAiSuggestion();
  const ai = aiSettings();
  if (!ai.enabled || !aiModelReady || ai.when === 'manual') return;
  // atraso curto: a sugestão aparece logo depois de parar de digitar
  aiTimer = setTimeout(() => requestAiSuggestion(), AI_DEBOUNCE[ai.when] || AI_DEBOUNCE.pause);
}

/* ------------- ações sobre o texto selecionado (IA local) ------------- */

const SELECTION_ACTIONS = {
  reduce: {
    title: 'Texto reduzido',
    instruction: 'Reduza o texto abaixo, mantendo o sentido, as informações importantes e o formato (markdown, código, listas). Seja bem mais curto. Responda apenas com o texto reduzido, sem explicações.',
  },
  expand: {
    title: 'Texto ampliado',
    instruction: 'Amplie e desenvolva o texto abaixo, mantendo o sentido e o formato (markdown, código, listas), com mais detalhes e exemplos quando fizer sentido. Responda apenas com o texto ampliado, sem explicações.',
  },
  grammar: {
    title: 'Gramática corrigida',
    instruction: 'Corrija a gramática, a ortografia e a pontuação do texto abaixo, mantendo o sentido, o tom e o formato (markdown, código, listas). Não mude o conteúdo além do necessário. Responda apenas com o texto corrigido, sem explicações.',
  },
};

let selInfo = null; // { start, end, text } — offsets no texto do editor
let selResultText = null;
let aiAbortSel = null;

function selectionOffsets() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !els.editor.contains(range.startContainer)) return null;
  const offsetOf = (node, offset) => {
    const pre = range.cloneRange();
    pre.selectNodeContents(els.editor);
    pre.setEnd(node, offset);
    return pre.toString().length;
  };
  return {
    start: offsetOf(range.startContainer, range.startOffset),
    end: offsetOf(range.endContainer, range.endOffset),
    text: range.toString(),
  };
}

function rangeFromOffsets(start, end) {
  const walker = document.createTreeWalker(els.editor, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const locate = (target) => {
    let remaining = target;
    for (const node of nodes) {
      if (remaining <= node.textContent.length) return { node, offset: remaining };
      remaining -= node.textContent.length;
    }
    const last = nodes[nodes.length - 1];
    return last ? { node: last, offset: last.textContent.length } : null;
  };
  const from = locate(start);
  const to = locate(end);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function positionNearSelection(box) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  let rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (!rect.top && !rect.left)) rect = els.editor.getBoundingClientRect();
  const containerRect = els.editorContainer.getBoundingClientRect();
  const left = rect.left - containerRect.left;
  const boxWidth = box.offsetWidth || 340;
  const boxHeight = box.offsetHeight || 40;
  box.style.left = `${Math.max(8, Math.min(left, Math.max(8, containerRect.width - boxWidth - 8)))}px`;
  const above = rect.top - containerRect.top - boxHeight - 8;
  let top = above >= 8 ? above : rect.bottom - containerRect.top + 8;
  // mantém a caixa inteira dentro do editor, mesmo com texto longo
  top = Math.max(8, Math.min(top, Math.max(8, containerRect.height - boxHeight - 8)));
  box.style.top = `${top}px`;
}

function hideSelectionTools() {
  $('#selectionTools')?.classList.add('hidden');
}

function hideSelectionResult() {
  selResultText = null;
  $('#selectionResult')?.classList.add('hidden');
}

function maybeShowSelectionTools() {
  if (selResultText) return;
  const ai = aiSettings();
  if (!ai.enabled || !aiModelReady) { hideSelectionTools(); return; }
  const info = selectionOffsets();
  if (!info || info.text.trim().length < 3) { hideSelectionTools(); return; }
  selInfo = info;
  const tools = $('#selectionTools');
  tools.classList.remove('hidden');
  positionNearSelection(tools);
}

async function runSelectionAction(action) {
  const config = SELECTION_ACTIONS[action];
  if (!config || !selInfo) return;
  const selectedText = selInfo.text;
  hideSelectionTools();
  const box = $('#selectionResult');
  $('#selectionResultTitle').textContent = 'Gerando...';
  box.querySelector('.ai-suggestion__code').textContent = 'A IA local está trabalhando no texto selecionado.';
  box.classList.remove('hidden');
  positionNearSelection(box);
  aiAbortSel?.abort();
  aiAbortSel = new AbortController();
  const myController = aiAbortSel;
  aiLastGen = { status: 'busy', ms: 0, at: Date.now() };
  updateAiStatusBar();
  const startedAt = performance.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: myController.signal,
      body: JSON.stringify({
        model: AI_MODEL,
        prompt: `${config.instruction}\n\nTexto:\n${selectedText}`,
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0.2, num_predict: 512, num_ctx: 4096 },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = (data.response || '').trim();
    if (aiAbortSel !== myController) return;
    if (!result) throw new Error('resposta vazia');
    aiLastGen = { status: 'ok', ms: performance.now() - startedAt, at: Date.now() };
    selResultText = result;
    $('#selectionResultTitle').textContent = config.title;
    box.querySelector('.ai-suggestion__code').textContent = result;
  } catch {
    if (aiAbortSel !== myController) return;
    aiLastGen = { status: 'error', ms: performance.now() - startedAt, at: Date.now() };
    hideSelectionResult();
    toast('Não foi possível transformar o texto. Verifique se o Ollama está aberto.', 'error');
  } finally {
    updateAiStatusBar();
  }
}

function acceptSelectionResult() {
  if (!selResultText || !selInfo) return;
  const range = rangeFromOffsets(selInfo.start, selInfo.end);
  if (!range) { hideSelectionResult(); return; }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const text = selResultText;
  hideSelectionResult();
  selInfo = null;
  insertText(els.editor, text);
}

/* ---------------------- biblioteca: APIs, IDEs, WebSites ---------------------- */

const LIBRARY = {
  api: {
    key: 'apis', label: 'APIs', singular: 'API', icon: 'api',
    desc: 'Organize provedores de API: site, URL base, chave e IDs de modelos.',
    fields: [
      { key: 'provider', label: 'Nome do provedor', placeholder: 'ex.: OpenAI', required: true },
      { key: 'siteUrl', label: 'URL do site', placeholder: 'https://...', required: true, type: 'url' },
      { key: 'baseUrl', label: 'URL base', placeholder: 'https://api.exemplo.com/v1', type: 'url' },
      { key: 'apiKey', label: 'Key (chave de API)', placeholder: 'sk-...', secret: true },
      { key: 'modelIds', label: 'ID de modelos (opcional)', placeholder: 'Um por linha, ex.:\ngpt-4o\ngpt-4o-mini', area: true },
    ],
    searchable: (item) => [item.provider, item.siteUrl, item.baseUrl, item.modelIds],
  },
  ide: {
    key: 'ides', label: 'IDEs', singular: 'IDE', icon: 'ide',
    desc: 'Organize as IDEs que você usa: nome, site e descrição.',
    fields: [
      { key: 'name', label: 'Nome da IDE', placeholder: 'ex.: Visual Studio Code', required: true },
      { key: 'siteUrl', label: 'URL do site', placeholder: 'https://...', required: true, type: 'url' },
      { key: 'description', label: 'Descrição', placeholder: 'Para que você usa esta IDE...', area: true },
    ],
    searchable: (item) => [item.name, item.siteUrl, item.description],
  },
  website: {
    key: 'websites', label: 'WebSites', singular: 'WebSite', icon: 'globe',
    desc: 'Organize sites úteis: nome, URL e descrição.',
    fields: [
      { key: 'name', label: 'Nome do site', placeholder: 'ex.: Documentação', required: true },
      { key: 'siteUrl', label: 'URL do site', placeholder: 'https://...', required: true, type: 'url' },
      { key: 'description', label: 'Descrição', placeholder: 'O que este site oferece...', area: true },
    ],
    searchable: (item) => [item.name, item.siteUrl, item.description],
  },
};

let editingLibrary = null; // { type, id? }
let detailLibrary = null; // { type, id }
let showLibraryKey = false;

const libraryItems = (project, type) => project[LIBRARY[type].key] || [];
const findLibraryItem = (project, type, id) => libraryItems(project, type).find((item) => item.id === id);
const libraryTitle = (type, item) => (type === 'api' ? item.provider : item.name) || 'Sem nome';

function openLibraryForm(type, item = null) {
  const cfg = LIBRARY[type];
  editingLibrary = { type, id: item?.id || null };
  $('#libraryTitle').textContent = item ? `Editar ${cfg.singular}` : `Nova ${cfg.singular}`;
  $('#libraryDesc').textContent = cfg.desc;
  $('#libraryForm').innerHTML = cfg.fields.map((field) => {
    const value = escapeHtml(item?.[field.key] || '');
    const control = field.area
      ? `<fluent-textarea data-field="${field.key}" rows="3" placeholder="${escapeHtml(field.placeholder || '')}" value="${value}"></fluent-textarea>`
      : `<fluent-text-input data-field="${field.key}" type="${field.secret ? 'password' : (field.type || 'text')}" placeholder="${escapeHtml(field.placeholder || '')}" value="${value}"></fluent-text-input>`;
    return `<div class="library-field"><label>${field.label}${field.required ? ' *' : ''}</label>${control}</div>`;
  }).join('');
  openById('libraryDialog');
  setTimeout(() => $('#libraryForm').querySelector('fluent-text-input, fluent-textarea')?.focus(), 60);
}

function saveLibraryForm() {
  if (!editingLibrary) return;
  const { type, id } = editingLibrary;
  const cfg = LIBRARY[type];
  const project = getActiveProject();
  const data = {};
  let valid = true;
  cfg.fields.forEach((field) => {
    const el = $(`#libraryForm [data-field="${field.key}"]`);
    const value = (el?.value ?? el?.textContent ?? '').trim();
    data[field.key] = value;
    if (field.required && !value) valid = false;
  });
  if (!valid) { toast('Preencha os campos obrigatórios (nome e URL do site)', 'error'); return; }
  if (id) {
    const item = findLibraryItem(project, type, id);
    if (!item) return;
    Object.assign(item, data);
    toast(`${cfg.singular} atualizado`);
  } else {
    project[cfg.key].push({ id: uid(type === 'api' ? 'api' : type === 'ide' ? 'ide' : 'web'), ...data, createdAt: now() });
    toast(`${cfg.singular} adicionado à biblioteca`);
  }
  editingLibrary = null;
  $('#libraryDialog').hide();
  persist();
  renderAll();
}

function librarySnippet(type, item) {
  if (type === 'api') {
    const models = (item.modelIds || '').split(/\n|,/).map((m) => m.trim()).filter(Boolean);
    return [
      `## API — ${item.provider}`,
      item.siteUrl ? `- Site: [${item.siteUrl}](${item.siteUrl})` : null,
      item.baseUrl ? `- Base URL: \`${item.baseUrl}\`` : null,
      models.length ? `- Modelos: ${models.map((m) => `\`${m}\``).join(', ')}` : null,
      '',
    ].filter(Boolean).join('\n');
  }
  return [
    `## ${item.name}`,
    item.siteUrl ? `[${item.siteUrl}](${item.siteUrl})` : null,
    item.description || null,
    '',
  ].filter(Boolean).join('\n');
}

function maskKey(key = '') {
  if (!key) return '—';
  return showLibraryKey ? key : `${key.slice(0, 4)}${'•'.repeat(Math.max(4, Math.min(12, key.length - 4)))}`;
}

function renderLibraryDetail() {
  if (!detailLibrary) return;
  const { type, id } = detailLibrary;
  const cfg = LIBRARY[type];
  const item = findLibraryItem(getActiveProject(), type, id);
  if (!item) { $('#libraryDetailDialog').hide(); return; }
  const rows = [];
  const row = (label, valueHtml) => rows.push(`<div class="library-detail__row"><span class="library-detail__label">${label}</span><span class="library-detail__value">${valueHtml}</span></div>`);
  if (type === 'api') {
    if (item.siteUrl) row('Site', `<a href="${escapeHtml(item.siteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.siteUrl)}</a>`);
    if (item.baseUrl) row('URL base', `<code>${escapeHtml(item.baseUrl)}</code>`);
    row('Key', item.apiKey ? `<code>${escapeHtml(maskKey(item.apiKey))}</code>` : '—');
    if (item.modelIds) row('Modelos', escapeHtml(item.modelIds));
  } else {
    if (item.siteUrl) row('Site', `<a href="${escapeHtml(item.siteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.siteUrl)}</a>`);
    if (item.description) row('Descrição', escapeHtml(item.description));
  }
  $('#libraryDetail').innerHTML = `
    <div class="library-detail__head">
      <span class="library-detail__icon" data-icon="${cfg.icon}"></span>
      <div>
        <div class="library-detail__title">${escapeHtml(libraryTitle(type, item))}</div>
        <div class="library-detail__kind">${cfg.singular} · biblioteca do projeto</div>
      </div>
    </div>
    <div class="library-detail__rows">${rows.join('')}</div>
    <div class="library-detail__actions">
      ${item.siteUrl ? `<fluent-button data-lib-action="open" appearance="accent"><span data-icon="external"></span> Abrir site</fluent-button>` : ''}
      <fluent-button data-lib-action="insert" appearance="stealth"><span data-icon="send"></span> Inserir no prompt</fluent-button>
      ${type === 'api' && item.baseUrl ? `<fluent-button data-lib-action="copy-base" appearance="stealth"><span data-icon="copy"></span> Copiar URL base</fluent-button>` : ''}
      ${type === 'api' && item.apiKey ? `<fluent-button data-lib-action="toggle-key" appearance="stealth"><span data-icon="${showLibraryKey ? 'eye-off' : 'eye'}"></span> ${showLibraryKey ? 'Ocultar key' : 'Mostrar key'}</fluent-button><fluent-button data-lib-action="copy-key" appearance="stealth"><span data-icon="key"></span> Copiar key</fluent-button>` : ''}
      <fluent-button data-lib-action="edit" appearance="stealth"><span data-icon="rename"></span> Editar</fluent-button>
      <fluent-button data-lib-action="delete" appearance="stealth"><span data-icon="trash"></span> Excluir</fluent-button>
    </div>`;
  applyIcons($('#libraryDetail'));
  $('#libraryDetail').querySelectorAll('[data-lib-action]').forEach((button) => {
    button.addEventListener('click', () => handleLibraryDetailAction(button.dataset.libAction));
  });
}

async function handleLibraryDetailAction(action) {
  if (!detailLibrary) return;
  const { type, id } = detailLibrary;
  const project = getActiveProject();
  const item = findLibraryItem(project, type, id);
  if (!item) return;
  const cfg = LIBRARY[type];
  if (action === 'open' && item.siteUrl) {
    window.open(item.siteUrl, '_blank', 'noopener,noreferrer');
  } else if (action === 'insert') {
    $('#libraryDetailDialog').hide();
    insertAtCursor(librarySnippet(type, item));
  } else if (action === 'copy-base') {
    const ok = await copyText(item.baseUrl);
    toast(ok ? 'URL base copiada' : 'Não foi possível copiar', ok ? 'info' : 'error');
  } else if (action === 'copy-key') {
    const ok = await copyText(item.apiKey || '');
    toast(ok ? 'Key copiada' : 'Não foi possível copiar', ok ? 'info' : 'error');
  } else if (action === 'toggle-key') {
    showLibraryKey = !showLibraryKey;
    renderLibraryDetail();
  } else if (action === 'edit') {
    $('#libraryDetailDialog').hide();
    openLibraryForm(type, item);
  } else if (action === 'delete') {
    pendingConfirm = () => {
      project[cfg.key] = libraryItems(project, type).filter((entry) => entry.id !== id);
      detailLibrary = null;
      $('#libraryDetailDialog').hide();
      persist();
      renderAll();
      toast(`${cfg.singular} “${libraryTitle(type, item)}” excluído`);
    };
    $('#confirmTitle').textContent = `Excluir ${cfg.singular}?`;
    $('#confirmMessage').textContent = `“${libraryTitle(type, item)}” será removido da biblioteca. Esta ação não pode ser desfeita.`;
    $('#confirmDialog').show();
  }
}

function handleLibraryItemAction(type, id, action) {
  if (action === 'open') { detailLibrary = { type, id }; showLibraryKey = false; renderLibraryDetail(); openById('libraryDetailDialog'); return; }
  if (action === 'edit') { const item = findLibraryItem(getActiveProject(), type, id); if (item) openLibraryForm(type, item); return; }
  if (action === 'delete') {
    const item = findLibraryItem(getActiveProject(), type, id);
    if (!item) return;
    const project = getActiveProject();
    pendingConfirm = () => {
      project[LIBRARY[type].key] = libraryItems(project, type).filter((entry) => entry.id !== id);
      persist(); renderAll();
      toast(`${LIBRARY[type].singular} “${libraryTitle(type, item)}” excluído`);
    };
    $('#confirmTitle').textContent = `Excluir ${LIBRARY[type].singular}?`;
    $('#confirmMessage').textContent = `“${libraryTitle(type, item)}” será removido da biblioteca. Esta ação não pode ser desfeita.`;
    $('#confirmDialog').show();
  }
}

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `<span class="toast__icon" data-icon="${kind === 'error' ? 'close' : 'check'}"></span><span>${escapeHtml(message)}</span>`;
  applyIcons(el);
  els.toasts.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

setSavedHandler((ok, err) => {
  els.saveStatus.textContent = ok ? 'Salvo localmente' : 'Falha ao salvar';
  els.saveStatus.className = `save-status ${ok ? 'is-ok' : 'is-error'}`;
  if (!ok) toast(`Não foi possível salvar: ${err?.message || 'erro desconhecido'}`, 'error');
});

/* ------------------------------- seleção ---------------------------------- */

function currentPrompt() {
  const project = getActiveProject();
  if (!state.openTabs.length) {
    state.activePromptId = null;
    return { project, prompt: null };
  }
  let prompt = getPrompt(project, state.activePromptId);
  if (!prompt) {
    state.activePromptId = state.openTabs[0];
    prompt = getPrompt(project, state.activePromptId);
    if (!prompt) {
      state.openTabs = [];
      state.activePromptId = null;
      return { project, prompt: null };
    }
  }
  return { project, prompt };
}

function setActiveProject(id) {
  if (id === state.activeProjectId) return;
  const previous = getActiveProject();
  previous.openTabs = state.openTabs;
  previous.activePromptId = state.activePromptId;

  state.activeProjectId = id;
  const project = getActiveProject();
  const validTabs = (project.openTabs || []).filter((pid) => getPrompt(project, pid));
  state.openTabs = validTabs.length ? validTabs : project.prompts.slice(0, 3).map((p) => p.id);
  state.activePromptId = getPrompt(project, project.activePromptId)
    ? project.activePromptId
    : (state.openTabs[0] || null);
  persist();
  renderAll();
}

function openPrompt(id) {
  const hadAttachment = Boolean(state.attachmentView);
  state.attachmentView = null;
  // voltar da aba de anexo para a aba já ativa precisa redesenhar
  if (!hadAttachment && state.activePromptId === id && state.openTabs.includes(id)) return;
  state.activePromptId = id;
  if (!state.openTabs.includes(id)) state.openTabs.push(id);
  persist();
  renderAll();
}

function closeTab(id) {
  state.openTabs = state.openTabs.filter((tabId) => tabId !== id);
  if (state.activePromptId === id) {
    state.activePromptId = state.openTabs[state.openTabs.length - 1] || null;
  }
  persist();
  renderAll();
}

/* -------------------------------- renders --------------------------------- */

function renderProjectSwitcher() {
  // O componente insere seu próprio botão de controle no light DOM: substituir
  // todo o innerHTML destruiria esse botão. Atualizamos apenas a listbox.
  let listbox = els.switcher.querySelector('fluent-listbox');
  if (!listbox) {
    listbox = document.createElement('fluent-listbox');
    els.switcher.appendChild(listbox);
  }
  listbox.innerHTML = state.projects.map((project) =>
    `<fluent-option value="${escapeHtml(project.id)}"${project.id === state.activeProjectId ? ' selected' : ''}>${escapeHtml(project.name)}</fluent-option>`,
  ).join('');

  // O Fluent Dropdown registra suas opções de forma assíncrona; definir o valor
  // no mesmo tick gera um erro interno. Tentamos após o registro.
  const wanted = state.activeProjectId;
  let attempts = 0;
  const applyValue = () => {
    try {
      els.switcher.value = wanted;
    } catch {
      if (++attempts < 8) requestAnimationFrame(applyValue);
    }
  };
  requestAnimationFrame(applyValue);
}

function fileItemHtml(file, kind) {
  const isAttachment = kind === 'attachment';
  const isActive = !isAttachment && file.id === state.activePromptId;
  return `
    <div class="tree-item ${isActive ? 'is-active' : ''}" data-kind="${kind}" data-id="${escapeHtml(file.id)}" role="treeitem" tabindex="0" title="${escapeHtml(file.name)}">
      <span class="tree-item__icon" data-icon="${isAttachment ? fileIcon(file.name, file.type) : 'file-text'}"></span>
      <span class="tree-item__name">${escapeHtml(file.name)}</span>
      <span class="tree-item__actions">
        ${isAttachment ? `<button class="tree-item__action" data-action="send" title="Enviar para o prompt" data-icon="send"></button>` : ''}
        <button class="tree-item__action" data-action="rename" title="Renomear" data-icon="rename"></button>
        <button class="tree-item__action tree-item__action--danger" data-action="delete" title="Excluir" data-icon="trash"></button>
      </span>
    </div>`;
}

function renderTree() {
  const project = getActiveProject();
  const query = searchQuery.trim().toLowerCase();
  const prompts = project.prompts.filter((p) => p.name.toLowerCase().includes(query));
  const attachments = project.attachments.filter((a) => a.name.toLowerCase().includes(query));

  els.projectInfo.innerHTML = `
    <div class="project-info__row">
      <div class="project-info__text">
        <div class="project-info__name">${escapeHtml(project.name)}</div>
        <div class="project-info__meta">${project.prompts.length} prompt${project.prompts.length === 1 ? '' : 's'} · ${project.attachments.length} anexo${project.attachments.length === 1 ? '' : 's'} · ${libraryItems(project, 'api').length + libraryItems(project, 'ide').length + libraryItems(project, 'website').length} na biblioteca</div>
      </div>
      <div class="project-info__actions">
        <button class="tree-item__action" data-project-action="rename" title="Renomear projeto" data-icon="rename"></button>
        <button class="tree-item__action tree-item__action--danger" data-project-action="delete" title="Excluir projeto" data-icon="trash"></button>
      </div>
    </div>`;
  applyIcons(els.projectInfo);
  els.projectInfo.querySelectorAll('[data-project-action]').forEach((button) => {
    button.addEventListener('click', () => handleProjectAction(button.dataset.projectAction));
  });

  els.tree.innerHTML = `
    <div class="tree-group">
      <div class="tree-group__head"><span class="tree-group__chevron" data-icon="chevron"></span><span data-icon="folder-open"></span><span class="tree-group__title">Prompts</span><fluent-badge>${project.prompts.length}</fluent-badge><button class="tree-group__add" id="treeAddPromptBtn" title="Novo prompt" data-icon="add"></button></div>
      <div class="tree-group__body">
        ${prompts.length ? prompts.map((p) => fileItemHtml(p, 'prompt')).join('') : '<div class="tree-empty">Nenhum prompt encontrado</div>'}
      </div>
    </div>
    <div class="tree-group">
      <div class="tree-group__head"><span class="tree-group__chevron" data-icon="chevron"></span><span data-icon="attach"></span><span class="tree-group__title">Anexos</span><fluent-badge>${project.attachments.length}</fluent-badge><button class="tree-group__add" id="treeAddAttachmentBtn" title="Adicionar anexos" data-icon="add"></button></div>
      <div class="tree-group__body">
        ${attachments.length ? attachments.map((a) => fileItemHtml(a, 'attachment')).join('') : '<div class="tree-empty">Nenhum anexo</div>'}
      </div>
    </div>
    ${Object.entries(LIBRARY).map(([type, cfg]) => {
      const items = libraryItems(project, type).filter((item) =>
        cfg.searchable(item).join(' ').toLowerCase().includes(query));
      return `
    <div class="tree-group">
      <div class="tree-group__head"><span class="tree-group__chevron" data-icon="chevron"></span><span data-icon="${cfg.icon}"></span><span class="tree-group__title">${cfg.label}</span><fluent-badge>${libraryItems(project, type).length}</fluent-badge><button class="tree-group__add" data-library-add="${type}" title="Novo ${cfg.singular}" data-icon="add"></button></div>
      <div class="tree-group__body">
        ${items.length ? items.map((item) => `
        <div class="tree-item" data-library-kind="${type}" data-id="${escapeHtml(item.id)}" role="treeitem" tabindex="0" title="${escapeHtml(libraryTitle(type, item))}">
          <span class="tree-item__icon" data-icon="${cfg.icon}"></span>
          <span class="tree-item__name">${escapeHtml(libraryTitle(type, item))}</span>
          <span class="tree-item__actions">
            <button class="tree-item__action" data-action="edit" title="Editar" data-icon="rename"></button>
            <button class="tree-item__action tree-item__action--danger" data-action="delete" title="Excluir" data-icon="trash"></button>
          </span>
        </div>`).join('') : `<div class="tree-empty">Nenhum${type === 'website' ? ' site' : type === 'ide' ? ' IDE' : ''} cadastrado${type === 'api' ? '' : ''} — clique em + para adicionar</div>`}
      </div>
    </div>`;
    }).join('')}`;
  applyIcons(els.tree);

  $('#treeAddPromptBtn')?.addEventListener('click', (e) => { e.stopPropagation(); openNewPromptDialog(); });
  $('#treeAddAttachmentBtn')?.addEventListener('click', (e) => { e.stopPropagation(); els.fileInput.click(); });

  els.tree.querySelectorAll('.tree-group__head').forEach((head) => {
    head.addEventListener('click', () => {
      head.closest('.tree-group').classList.toggle('is-collapsed');
    });
  });

  els.tree.querySelectorAll('[data-library-add]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      openLibraryForm(button.dataset.libraryAdd);
    });
  });

  els.tree.querySelectorAll('.tree-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      const actionButton = e.target.closest('[data-action]');
      if (actionButton) {
        e.stopPropagation();
        if (item.dataset.libraryKind) handleLibraryItemAction(item.dataset.libraryKind, item.dataset.id, actionButton.dataset.action);
        else handleTreeAction(item.dataset.kind, item.dataset.id, actionButton.dataset.action);
        return;
      }
      if (item.dataset.libraryKind) handleLibraryItemAction(item.dataset.libraryKind, item.dataset.id, 'open');
      else if (item.dataset.kind === 'prompt') openPrompt(item.dataset.id);
      else if (item.dataset.kind === 'attachment') {
        const attachment = getActiveProject().attachments.find((a) => a.id === item.dataset.id);
        if (attachment) openAttachmentPreview(attachment);
      }
    });
    item.addEventListener('dblclick', () => handleTreeAction(item.dataset.kind, item.dataset.id, 'rename'));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        item.click();
      }
      if (e.key === 'Delete' && item.dataset.libraryKind) {
        handleLibraryItemAction(item.dataset.libraryKind, item.dataset.id, 'delete');
      }
    });
  });
}

function renderTabs() {
  const project = getActiveProject();
  const attachment = state.attachmentView ? project.attachments.find((a) => a.id === state.attachmentView) : null;
  if (state.attachmentView && !attachment) state.attachmentView = null;

  els.tabs.classList.toggle('hidden', state.openTabs.length === 0 && !attachment);
  const promptTabs = state.openTabs.map((id) => {
    const found = findPromptById(id);
    if (!found) return '';
    const active = !attachment && id === state.activePromptId ? 'is-active' : '';
    return `
      <div class="tab ${active}" data-id="${escapeHtml(id)}" role="tab" aria-selected="${active === 'is-active'}" title="${escapeHtml(found.prompt.name)}">
        <span class="tab__icon" data-icon="file-text"></span>
        <span class="tab__name">${escapeHtml(found.prompt.name)}</span>
        <button class="tab__close" data-close="${escapeHtml(id)}" title="Fechar" data-icon="close"></button>
      </div>`;
  }).join('');

  const attachmentTab = attachment ? `
      <div class="tab tab--attachment is-active" data-attachment="${escapeHtml(attachment.id)}" role="tab" aria-selected="true" title="${escapeHtml(attachment.name)}">
        <span class="tab__icon" data-icon="${escapeHtml(fileIcon(attachment.name, attachment.type))}"></span>
        <span class="tab__name">${escapeHtml(attachment.name)}</span>
        <button class="tab__close" data-close-attachment="1" title="Fechar" data-icon="close"></button>
      </div>` : '';

  els.tabs.innerHTML = promptTabs + attachmentTab;
  applyIcons(els.tabs);

  els.tabs.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-attachment]')) {
        closeAttachmentPreview();
        return;
      }
      if (e.target.closest('[data-close]')) {
        closeTab(tab.dataset.id);
        return;
      }
      if (tab.dataset.attachment) return; // já é a aba ativa
      if (findPromptById(tab.dataset.id)?.project.id !== getActiveProject().id) {
        setActiveProject(findPromptById(tab.dataset.id).project.id);
      }
      // openPrompt cuida de fechar a aba de anexo e redesenhar
      openPrompt(tab.dataset.id);
    });
  });
}

function updatePreview(source) {
  const text = source ?? readEditor(els.editor);
  els.preview.innerHTML = renderMarkdown(text);
  els.preview.querySelectorAll('[data-copy-code]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.closest('.code-block')?.querySelector('code')?.textContent || '';
      const ok = await copyText(code);
      button.textContent = ok ? 'Copiado!' : 'Falhou';
      setTimeout(() => { button.textContent = 'Copiar'; }, 1600);
    });
  });
}

function renderEditor() {
  hideAiSuggestion();
  const { project, prompt } = currentPrompt();

  // aba de anexo: a área do editor dá lugar à pré-visualização do arquivo
  const attachment = state.attachmentView ? project.attachments.find((a) => a.id === state.attachmentView) : null;
  $('#attachmentView')?.classList.toggle('hidden', !attachment);
  els.split.classList.toggle('hidden', Boolean(attachment));
  els.toolbar.classList.toggle('hidden', Boolean(attachment) || !prompt);
  if (attachment) {
    els.emptyState.classList.add('hidden');
    renderAttachmentView(attachment);
    $('#statusPrompt').textContent = attachment.name;
    $('#statusWords').textContent = formatBytes(attachment.size);
    $('#statusChars').textContent = attachment.type || 'arquivo';
    $('#editorMeta').textContent = `${project.name} · ${attachment.name}`;
    return;
  }

  const hasPrompt = Boolean(prompt);
  els.split.classList.toggle('is-empty', !hasPrompt);
  els.split.classList.toggle('is-hidden', hasPrompt && !previewVisible);
  els.toolbar.classList.toggle('hidden', !hasPrompt);
  els.emptyState.classList.toggle('hidden', hasPrompt);

  if (!hasPrompt) {
    writeEditor(els.editor, '');
    els.preview.innerHTML = '';
    updateStatus();
    return;
  }

  writeEditor(els.editor, prompt.content, referenceNames());
  $('#editorMeta').textContent = `${project.name} · ${prompt.name}`;
  updatePreview(prompt.content);
  updateStatus();
  const h = historyFor(prompt.id);
  if (!h.past.length) h.past.push(prompt.content);
}

/* ------------------------------ desfazer/refazer (Ctrl+Z) ------------------------------ */
// O editor reconstrói o DOM a cada digitação, então o Ctrl+Z nativo do
// navegador não funciona — o histórico é nosso, por prompt.

const editHistory = new Map();

function historyFor(id) {
  if (!editHistory.has(id)) editHistory.set(id, { past: [], future: [] });
  return editHistory.get(id);
}

function pushHistory() {
  const { prompt } = currentPrompt();
  if (!prompt) return;
  const h = historyFor(prompt.id);
  if (h.past[h.past.length - 1] === prompt.content) return;
  h.past.push(prompt.content);
  if (h.past.length > 100) h.past.shift();
  h.future = [];
}

let historyTimer = null;
function scheduleHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(pushHistory, 600);
}

function applyHistoryContent(content) {
  const { prompt } = currentPrompt();
  if (!prompt) return;
  prompt.content = content;
  prompt.updatedAt = now();
  writeEditor(els.editor, content, referenceNames(), { preserveCaret: true });
  updatePreview(content);
  updateStatus();
  persist();
}

function undoEdit() {
  const { prompt } = currentPrompt();
  if (!prompt) return;
  const h = historyFor(prompt.id);
  if (h.past.length < 2) return;
  h.future.push(h.past.pop());
  applyHistoryContent(h.past[h.past.length - 1]);
}

function redoEdit() {
  const { prompt } = currentPrompt();
  if (!prompt) return;
  const h = historyFor(prompt.id);
  if (!h.future.length) return;
  const next = h.future.pop();
  h.past.push(next);
  applyHistoryContent(next);
}

function updateStatus() {
  const { project, prompt } = currentPrompt();
  els.statusProject.textContent = project.name;
  els.statusPrompt.textContent = prompt ? prompt.name : 'Nenhum arquivo aberto';
  const text = readEditor(els.editor) || '';
  const words = (text.trim().match(/\S+/g) || []).length;
  els.statusWords.textContent = `${words} palavra${words === 1 ? '' : 's'}`;
  els.statusChars.textContent = `${text.length} caractere${text.length === 1 ? '' : 's'}`;
}

async function updateStorage() {
  // uso total (workspace + anexos no IndexedDB), quando o navegador informa
  let bytes = usageBytes();
  let quota = 5 * 1024 * 1024;
  try {
    const estimate = await navigator.storage.estimate();
    if (estimate.usage != null) bytes = estimate.usage;
    if (estimate.quota) quota = estimate.quota;
  } catch { /* mantém o cálculo do workspace */ }
  const kb = bytes / 1024;
  els.storageLabel.textContent = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  els.storageBar.value = Math.min(100, (bytes / quota) * 100);
}

function renderAll() {
  applyTheme();
  renderProjectSwitcher();
  renderTree();
  renderTabs();
  renderEditor();
  renderAiSettings();
  updateStorage();
}

/* ------------------------------- ações ------------------------------------ */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    helper.remove();
    return ok;
  }
}

function downloadFile(filename, content, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ensureMd(name) {
  const trimmed = (name || '').trim() || 'sem-titulo';
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

function createProject() {
  const name = ($('#projectNameInput').value || '').trim();
  if (!name) {
    toast('Informe um nome para o projeto', 'error');
    return;
  }
  const project = { id: uid('proj'), name, createdAt: now(), prompts: [], attachments: [], apis: [], ides: [], websites: [], openTabs: [], activePromptId: null };
  state.projects.push(project);
  $('#projectDialog').hide();
  setActiveProject(project.id);
  toast(`Projeto “${name}” criado`);
}

function createPrompt() {
  const { project } = currentPrompt();
  const name = ensureMd($('#promptNameInput').value);
  if (project.prompts.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    toast('Já existe um prompt com esse nome', 'error');
    return;
  }
  const prompt = { id: uid('doc'), name, content: `# ${name.replace(/\.md$/i, '')}\n\n`, createdAt: now(), updatedAt: now() };
  project.prompts.push(prompt);
  $('#promptDialog').hide();
  $('#promptNameInput').value = '';
  openPrompt(prompt.id);
  toast(`Prompt “${name}” criado`);
  setTimeout(() => els.editor.focus(), 50);
}

function handleTreeAction(kind, id, action) {
  const project = getActiveProject();
  const collection = kind === 'prompt' ? project.prompts : project.attachments;
  const file = collection.find((entry) => entry.id === id);
  if (!file) return;

  if (action === 'rename') {
    renameTarget = { kind, id };
    $('#renameInput').value = file.name;
    $('#renameDialog').show();
    setTimeout(() => $('#renameInput').focus(), 50);
  } else if (action === 'delete') {
    pendingConfirm = () => {
      if (kind === 'prompt') {
        project.prompts = project.prompts.filter((p) => p.id !== id);
        state.openTabs = state.openTabs.filter((tabId) => tabId !== id);
        if (state.activePromptId === id) state.activePromptId = state.openTabs.at(-1) || project.prompts[0]?.id || null;
      } else {
        project.attachments = project.attachments.filter((a) => a.id !== id);
        deleteBlob(id);
      }
      persist();
      renderAll();
      toast(`“${file.name}” excluído`);
    };
    $('#confirmTitle').textContent = `Excluir ${kind === 'prompt' ? 'prompt' : 'anexo'}?`;
    $('#confirmMessage').textContent = `“${file.name}” será removido do projeto. Esta ação não pode ser desfeita.`;
    $('#confirmDialog').show();
  } else if (action === 'send') {
    insertAttachment(file);
  }
}

function handleProjectAction(action) {
  const project = getActiveProject();
  if (action === 'rename') {
    renameTarget = { kind: 'project', id: project.id };
    $('#renameInput').value = project.name;
    $('#renameDialog').show();
    setTimeout(() => $('#renameInput').focus(), 50);
    return;
  }
  if (action === 'delete') {
    if (state.projects.length === 1) {
      toast('Não é possível excluir o único projeto', 'error');
      return;
    }
    pendingConfirm = () => {
      const target = state.projects.find((p) => p.id !== project.id);
      setActiveProject(target.id);
      state.projects = state.projects.filter((p) => p.id !== project.id);
      persist();
      renderAll();
      toast(`Projeto “${project.name}” excluído`);
    };
    $('#confirmTitle').textContent = 'Excluir projeto?';
    $('#confirmMessage').textContent = `“${project.name}”, seus prompts e anexos serão removidos. Esta ação não pode ser desfeita.`;
    $('#confirmDialog').show();
  }
}

function applyRename() {
  if (!renameTarget) return;
  const collection = renameTarget.kind === 'project'
    ? state.projects
    : (renameTarget.kind === 'prompt' ? getActiveProject().prompts : getActiveProject().attachments);
  const file = collection.find((entry) => entry.id === renameTarget.id);
  if (!file) return;
  let name = ($('#renameInput').value || '').trim();
  if (!name) {
    toast('Informe um nome válido', 'error');
    return;
  }
  if (renameTarget.kind === 'prompt') name = ensureMd(name);
  if (collection.some((entry) => entry.id !== file.id && entry.name.toLowerCase() === name.toLowerCase())) {
    toast('Já existe um arquivo com esse nome', 'error');
    return;
  }
  file.name = name;
  renameTarget = null;
  $('#renameDialog').hide();
  persist();
  renderAll();
  toast(`Renomeado para “${name}”`);
}

function insertAtCursor(text) {
  const { prompt } = currentPrompt();
  if (!prompt) {
    toast('Abra um prompt antes de inserir conteúdo', 'error');
    return;
  }
  insertText(els.editor, text);
  prompt.content = readEditor(els.editor);
  prompt.updatedAt = now();
  updatePreview();
  updateStatus();
  persist();
}

function fenceFor(content) {
  const runs = content.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

async function insertAttachment(attachment) {
  if (attachment.binary) {
    insertAtCursor(`\n> Anexo binário: \`@${attachment.name}\` (${formatBytes(attachment.size)})\n`);
    toast(`Referência de “${attachment.name}” inserida`);
    return;
  }
  const content = await getAttachmentText(attachment);
  const fence = fenceFor(content || '');
  insertAtCursor(`\n<!-- anexo: ${attachment.name} -->\n${fence}text\n${content}\n${fence}\n`);
  toast(`Conteúdo de “${attachment.name}” inserido`);
}

/* --------------------------- pré-visualização de anexos --------------------------- */

let previewObjectUrl = null;
let previewAttachment = null;

function attachmentPreviewKind(attachment) {
  const ext = (attachment.name.split('.').pop() || '').toLowerCase();
  if (/^image\//i.test(attachment.type) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'].includes(ext)) return 'image';
  if (/^video\//i.test(attachment.type) || ['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext)) return 'video';
  if (/^audio\//i.test(attachment.type) || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
  if (attachment.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (!attachment.binary) return 'text';
  return 'unsupported';
}

// O anexo abre em uma aba (não em modal): a área do editor dá lugar à pré-visualização.
async function openAttachmentPreview(attachment) {
  state.attachmentView = attachment.id;
  previewAttachment = attachment;
  renderTabs();
  renderEditor();
}

function closeAttachmentPreview() {
  state.attachmentView = null;
  previewAttachment = null;
  if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
  renderTabs();
  renderEditor();
}

// desenha a pré-visualização do anexo na aba ativa
async function renderAttachmentView(attachment) {
  const body = $('#attachmentViewBody');
  const view = $('#attachmentView');
  if (!body || !view) return;
  const downloadBtn = $('#attachmentViewDownload');
  const nameEl = $('#attachmentViewName');
  const metaEl = $('#attachmentViewMeta');
  const iconEl = $('#attachmentViewIcon');

  nameEl.textContent = attachment.name;
  metaEl.textContent = `${formatBytes(attachment.size)} · ${attachment.type}`;
  if (iconEl) {
    iconEl.dataset.icon = fileIcon(attachment.name, attachment.type);
    applyIcons(view);
  }

  if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
  body.innerHTML = '<div class="attachment-preview__empty">Carregando...</div>';

  const blob = await getBlob(attachment.id);
  if (!blob) {
    body.innerHTML = '<div class="attachment-preview__empty">Conteúdo indisponível — o arquivo pode ter sido adicionado em outro navegador.</div>';
    downloadBtn?.classList.add('hidden');
    return;
  }

  previewObjectUrl = URL.createObjectURL(blob);
  downloadBtn?.classList.remove('hidden');
  const kind = attachmentPreviewKind(attachment);
  if (kind === 'image') body.innerHTML = `<img src="${previewObjectUrl}" alt="${escapeHtml(attachment.name)}">`;
  else if (kind === 'video') body.innerHTML = `<video src="${previewObjectUrl}" controls playsinline></video>`;
  else if (kind === 'audio') body.innerHTML = `<audio src="${previewObjectUrl}" controls></audio>`;
  else if (kind === 'pdf') body.innerHTML = `<iframe src="${previewObjectUrl}" title="${escapeHtml(attachment.name)}"></iframe>`;
  else if (kind === 'text') {
    const text = await getAttachmentText(attachment);
    const pre = document.createElement('pre');
    pre.textContent = text;
    body.replaceChildren(pre);
  } else {
    body.innerHTML = '<div class="attachment-preview__empty">Sem pré-visualização para este tipo de arquivo. Use “Baixar” para abrir.</div>';
  }
}

function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB por anexo (IndexedDB)

async function addFiles(fileList) {
  const project = getActiveProject();
  let added = 0;
  let skipped = 0;
  for (const file of Array.from(fileList)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      skipped++;
      continue;
    }
    const isText = /^text\//i.test(file.type) || /\.(md|txt|json|csv|ya?ml|xml|html?|css|js|ts|py|java|cs|go|rs|sql|sh|ps1|ini|log)$/i.test(file.name) || !file.type;
    const existing = project.attachments.find((a) => a.name.toLowerCase() === file.name.toLowerCase());
    const id = existing?.id || uid('att');
    try {
      await putBlob(id, file); // conteúdo no IndexedDB; o workspace guarda só metadados
    } catch {
      skipped++;
      continue;
    }
    if (existing) {
      existing.content = null;
      existing.binary = !isText;
      existing.size = file.size;
      existing.type = file.type || 'application/octet-stream';
    } else {
      project.attachments.push({
        id, name: file.name, type: file.type || 'application/octet-stream',
        size: file.size, binary: !isText, content: null, createdAt: now(),
      });
    }
    added++;
  }
  els.fileInput.value = '';
  persist();
  renderAll();
  if (added) toast(`${added} anexo${added === 1 ? '' : 's'} adicionado${added === 1 ? '' : 's'}`);
  if (skipped) toast(`${skipped} arquivo(s) ignorado(s) por exceder 50 MB`, 'error');
}

function applyFormat(kind) {
  const editor = els.editor;
  switch (kind) {
    case 'bold':
      toggleWrap(editor, '**', '**', 'texto em negrito');
      break;
    case 'italic':
      toggleWrap(editor, '*', '*', 'texto em itálico');
      break;
    case 'heading':
      toggleWrap(editor, '## ', '', 'Título');
      break;
    case 'code': {
      const selection = window.getSelection()?.toString() || '';
      const fence = fenceFor(selection || 'código');
      if (selection.includes('\n') || !selection) {
        wrapSelection(editor, `${fence}js\n`, `\n${fence}`, 'console.log("Olá!");');
      } else {
        toggleWrap(editor, '`', '`', 'código');
      }
      break;
    }
    case 'link':
      toggleWrap(editor, '[', '](https://)', 'texto do link');
      break;
    case 'list':
      toggleLinePrefix(editor, '- ');
      break;
    case 'quote':
      toggleLinePrefix(editor, '> ');
      break;
    default:
      return;
  }
}

function focusSearch() {
  els.search.focus();
  const inner = els.search.shadowRoot?.querySelector('input');
  inner?.focus();
}

function openById(id) {
  const dialog = document.getElementById(id);
  dialog?.show?.();
}

function openNewPromptDialog() {
  const input = $('#promptNameInput');
  if (input) input.value = '';
  openById('promptDialog');
  setTimeout(() => input?.focus(), 50);
}

/* ------------------------------- eventos ---------------------------------- */

function bindEvents() {
  els.switcher.addEventListener('change', (e) => setActiveProject(e.target.value));

  $('#newProjectBtn').addEventListener('click', () => {
    $('#projectNameInput').value = '';
    openById('projectDialog');
    setTimeout(() => $('#projectNameInput').focus(), 50);
  });
  $('#emptyNewBtn').addEventListener('click', openNewPromptDialog);
  els.fileInput.addEventListener('change', (e) => addFiles(e.target.files));

  $('#projectCreate').addEventListener('click', createProject);
  $('#promptCreate').addEventListener('click', createPrompt);
  $('#renameConfirm').addEventListener('click', applyRename);

  for (const [button, dialog] of [
    ['projectCancel', 'projectDialog'], ['promptCancel', 'promptDialog'],
    ['renameCancel', 'renameDialog'], ['attachCancel', 'attachDialog'],
    ['libraryCancel', 'libraryDialog'], ['libraryDetailClose', 'libraryDetailDialog'],
  ]) {
    document.getElementById(button).addEventListener('click', () => document.getElementById(dialog).hide());
  }
  $('#librarySave').addEventListener('click', saveLibraryForm);
  $('#libraryForm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.target.closest('fluent-textarea')) {
      e.preventDefault();
      saveLibraryForm();
    }
  });

  $('#confirmCancel').addEventListener('click', () => {
    pendingConfirm = null;
    $('#confirmDialog').hide();
  });
  $('#confirmDelete').addEventListener('click', () => {
    $('#confirmDialog').hide();
    pendingConfirm?.();
    pendingConfirm = null;
  });

  $('#copyBtn').addEventListener('click', async () => {
    const { prompt } = currentPrompt();
    if (!prompt) return;
    const ok = await copyText(prompt.content);
    toast(ok ? 'Markdown copiado para a área de transferência' : 'Não foi possível copiar', ok ? 'info' : 'error');
  });

  $('#downloadBtn').addEventListener('click', () => {
    const { prompt } = currentPrompt();
    if (!prompt) return;
    downloadFile(prompt.name, prompt.content);
    toast(`“${prompt.name}” baixado`);
  });

  $('#insertAttachmentBtn').addEventListener('click', () => {
    const project = getActiveProject();
    if (!project.attachments.length) {
      toast('Este projeto ainda não tem anexos. Adicione arquivos pela lateral.', 'error');
      return;
    }
    $('#attachList').innerHTML = project.attachments.map((a) => `
      <label class="attach-option">
        <fluent-checkbox class="attach-check" value="${escapeHtml(a.id)}" checked></fluent-checkbox>
        <span data-icon="${fileIcon(a.name, a.type)}"></span>
        <span class="attach-option__name">${escapeHtml(a.name)}</span>
        <span class="attach-option__size">${formatBytes(a.size)}</span>
      </label>`).join('');
    applyIcons($('#attachList'));
    openById('attachDialog');
  });

  $('#attachmentViewDownload')?.addEventListener('click', () => {
    if (!previewObjectUrl || !previewAttachment) return;
    const link = document.createElement('a');
    link.href = previewObjectUrl;
    link.download = previewAttachment.name;
    link.click();
  });

  $('#attachConfirm').addEventListener('click', () => {
    const project = getActiveProject();
    const selected = [...$('#attachList').querySelectorAll('.attach-check')]
      .filter((checkbox) => checkbox.checked || checkbox.hasAttribute('checked'))
      .map((checkbox) => project.attachments.find((a) => a.id === checkbox.value))
      .filter(Boolean);
    $('#attachDialog').hide();
    if (!selected.length) {
      toast('Selecione ao menos um anexo', 'error');
      return;
    }
    selected.forEach(insertAttachment);
  });

  document.querySelectorAll('[data-format]').forEach((button) => {
    button.addEventListener('click', () => applyFormat(button.dataset.format));
  });

  const settingsPanel = $('#settingsPanel');
  $('#settingsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle('is-open');
    if (settingsPanel.classList.contains('is-open')) {
      renderAiSettings();
      checkAiModel();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (settingsPanel.classList.contains('is-open') && !settingsPanel.contains(e.target) && !e.target.closest('#settingsBtn')) {
      settingsPanel.classList.remove('is-open');
    }
  });
  document.querySelectorAll('#modeSwitch button').forEach((button) => {
    button.addEventListener('click', () => {
      state.theme = button.dataset.mode;
      applyTheme();
      persist();
    });
  });
  document.querySelectorAll('.swatch').forEach((button) => {
    button.addEventListener('click', () => {
      state.accent = button.dataset.accent;
      applyTheme();
      persist();
      toast(`Cor de destaque: ${button.title}`);
    });
  });

  document.querySelectorAll('#aiEnabledSwitch button').forEach((button) => {
    button.addEventListener('click', () => {
      aiSettings().enabled = button.dataset.on === 'true';
      aiLastGen = null;
      persist();
      renderAiSettings();
      if (!aiSettings().enabled) hideAiSuggestion();
      toast(aiSettings().enabled ? 'Sugestões automáticas ligadas' : 'Sugestões automáticas desligadas');
      if (aiSettings().enabled && !aiModelReady) {
        toast('Baixe o modelo acima para começar a receber sugestões');
        checkAiModel();
      }
    });
  });
  $('#aiWhenSelect')?.addEventListener('change', (e) => {
    aiSettings().when = e.target.value;
    persist();
  });
  $('#aiSizeSelect')?.addEventListener('change', (e) => {
    aiSettings().size = e.target.value;
    persist();
  });
  $('#aiDownloadBtn')?.addEventListener('click', downloadAiModel);
  $('#aiCancelBtn')?.addEventListener('click', () => aiAbortPull?.abort());
  $('#aiRecheckBtn')?.addEventListener('click', checkAiModel);
  $('#aiOllamaLink')?.addEventListener('click', () => window.open('https://ollama.com/download', '_blank', 'noopener,noreferrer'));
  $('#aiCopyFixBtn')?.addEventListener('click', async () => {
    const ok = await copyText('setx OLLAMA_ORIGINS "*"');
    toast(ok ? 'Comando copiado — cole no PowerShell' : 'Não foi possível copiar', ok ? 'info' : 'error');
  });
  $('#aiAutoFixBtn')?.addEventListener('click', () => {
    downloadFile('configurar-ollama.ps1', configScript, 'text/plain;charset=utf-8');
    toast('Script baixado — execute o arquivo para abrir a janela de progresso e configurar tudo sozinho');
  });


  $('#exportBtn').addEventListener('click', () => {
    downloadFile('open-winlin-prompt-workspace.json', exportWorkspace(), 'application/json');
    toast('Workspace exportado');
  });

  $('#importBtn').addEventListener('click', () => els.importInput.click());
  els.importInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importWorkspace(await file.text());
      els.importInput.value = '';
      renderAll();
      toast('Workspace importado com sucesso');
    } catch (err) {
      toast(`Arquivo inválido: ${err.message}`, 'error');
    }
  });

  $('#resetBtn').addEventListener('click', () => {
    pendingConfirm = () => {
      resetWorkspace();
      searchQuery = '';
      els.search.value = '';
      renderAll();
      toast('Workspace de exemplo restaurado');
    };
    $('#confirmTitle').textContent = 'Restaurar exemplo?';
    $('#confirmMessage').textContent = 'Seus projetos atuais serão substituídos pelo workspace de exemplo. Exporte antes se desejar manter uma cópia.';
    $('#confirmDialog').show();
  });

  els.search.addEventListener('input', (e) => {
    searchQuery = e.target.value || '';
    renderTree();
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchQuery = '';
      els.search.value = '';
      renderTree();
      els.search.blur();
    }
  });

  let highlightTimer = null;
  els.editor.addEventListener('input', () => {
    const { prompt } = currentPrompt();
    if (!prompt) return;
    prompt.content = readEditor(els.editor);
    prompt.updatedAt = now();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => updatePreview(), 60);
    // pré-visualização simples das formatações dentro do próprio editor
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      // não reconstrói o editor com texto fantasma ativo — ele seria apagado
      if (!aiSuggestionText && !els.mentionDropdown.classList.contains('is-visible')) {
        writeEditor(els.editor, readEditor(els.editor), referenceNames(), { preserveCaret: true });
      }
    }, 300);
    updateStatus();
    persist();
    hideSelectionTools();
    hideSelectionResult();
    scheduleHistory();
    scheduleAiSuggestion();
  });

  // Caixinha de ações da IA: aparece só quando o usuário SOLTA o mouse
  // (ou termina de selecionar pelo teclado), nunca durante o arrasto.
  let selectingText = false;
  els.editor.addEventListener('pointerdown', () => { selectingText = true; hideSelectionTools(); });
  document.addEventListener('pointerup', () => {
    if (!selectingText) return;
    selectingText = false;
    setTimeout(maybeShowSelectionTools, 0);
  });
  els.editor.addEventListener('mouseup', () => setTimeout(maybeShowSelectionTools, 0));
  els.editor.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key.startsWith('Arrow') || e.key === 'End' || e.key === 'Home') {
      setTimeout(maybeShowSelectionTools, 0);
    }
  });
  // selectionchange só serve para esconder a caixa quando a seleção sai do editor
  document.addEventListener('selectionchange', () => {
    if (selectingText) return;
    const selection = window.getSelection();
    const inside = selection?.anchorNode && els.editor.contains(selection.anchorNode);
    if (!inside || selection.isCollapsed) hideSelectionTools();
  });
  document.querySelectorAll('#selectionTools button').forEach((button) => {
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => runSelectionAction(button.dataset.selAction));
  });
  ['#selectionAcceptBtn', '#selectionDismissBtn'].forEach((selector) => {
    $(selector)?.addEventListener('mousedown', (e) => e.preventDefault());
  });
  $('#selectionAcceptBtn')?.addEventListener('click', acceptSelectionResult);
  $('#selectionDismissBtn')?.addEventListener('click', hideSelectionResult);

  els.editor.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    // Enter: inserimos a quebra nós mesmos. O contenteditable do Chrome
    // coloca o cursor antes da quebra que ele mesmo criou, o que fazia o texto
    // seguinte entrar na linha errada ("parecia" que o Enter não funcionava).
    if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      hideAiSuggestion();
      insertText(els.editor, '\n');
      return;
    }
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoEdit(); return; }
    if (mod && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) { e.preventDefault(); redoEdit(); return; }
    if (e.key === 'Escape' && selResultText) { e.preventDefault(); hideSelectionResult(); return; }
    if (e.key === 'Escape' && !$('#selectionTools')?.classList.contains('hidden')) { e.preventDefault(); hideSelectionTools(); return; }
    if (aiSuggestionText) {
      if (e.key === 'Tab') {
        e.preventDefault();
        acceptAiSuggestion();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideAiSuggestion();
        return;
      }
    }
    if (e.ctrlKey && e.key === ' ' && document.activeElement === els.editor) {
      e.preventDefault();
      if (!aiSettings().enabled) {
        toast('Ligue as sugestões automáticas nas configurações (engrenagem)');
        return;
      }
      requestAiSuggestion();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) hideAiSuggestion();
    if (e.key === 'Enter' && !e.defaultPrevented && !els.mentionDropdown.classList.contains('is-visible')) {
      e.preventDefault();
      insertText(els.editor, '\n');
    }
  });

  els.editor.addEventListener('click', hideAiSuggestion);
  els.editor.addEventListener('scroll', hideSelectionTools);

  els.editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) insertText(els.editor, text);
  });

  els.preview.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link && /^https?:\/\//i.test(link.getAttribute('href'))) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    }
  });

  $('#togglePreviewBtn').addEventListener('click', () => {
    previewVisible = !previewVisible;
    renderEditor();
    toast(previewVisible ? 'Pré-visualização exibida' : 'Editor em tela cheia');
  });

  let dragging = false;
  els.divider.addEventListener('pointerdown', (e) => {
    dragging = true;
    els.divider.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');
  });
  els.divider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = els.split.getBoundingClientRect();
    // percent = posição da divisória a partir da esquerda (largura do editor).
    // A pré-visualização fica à direita, então a largura dela é o restante:
    // arrastar para a direita encolhe a pré-visualização e vice-versa.
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(22, Math.min(75, percent));
    els.previewPane.style.flexBasis = `${100 - clamped}%`;
  });
  const stopDrag = () => {
    dragging = false;
    document.body.classList.remove('is-resizing');
  };
  els.divider.addEventListener('pointerup', stopDrag);
  els.divider.addEventListener('pointercancel', stopDrag);

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'k') {
      e.preventDefault();
      focusSearch();
    } else if (mod && e.shiftKey && key === 'n') {
      e.preventDefault();
      $('#newProjectBtn').click();
    } else if (mod && !e.shiftKey && key === 'n') {
      e.preventDefault();
      openNewPromptDialog();
    } else if (mod && key === 's') {
      e.preventDefault();
      persist({ immediate: true });
      toast('Workspace salvo');
    } else if (mod && e.shiftKey && key === 'c') {
      e.preventDefault();
      $('#copyBtn').click();
    } else if (mod && !e.shiftKey && key === 'b' && document.activeElement === els.editor) {
      e.preventDefault();
      applyFormat('bold');
    } else if (mod && !e.shiftKey && key === 'i' && document.activeElement === els.editor) {
      e.preventDefault();
      applyFormat('italic');
    }
  });

  new MentionController({
    editor: els.editor,
    container: els.editorContainer,
    dropdown: els.mentionDropdown,
    getFiles: () => {
      const project = getActiveProject();
      return [
        ...project.attachments.map((a) => ({ id: a.id, name: a.name, kind: 'attachment', type: a.type })),
        ...project.prompts.map((p) => ({ id: p.id, name: p.name, kind: 'prompt' })),
      ];
    },
    onSelect: (file) => toast(`Referência @${file.name} inserida`),
  });
}

/* ---------------------------------- boot ---------------------------------- */

// Logo (logo.svg) injetada inline para herdar a cor do tema via CSS.
document.querySelector('.app-mark').innerHTML = logoSvg;
applyIcons();
bindEvents();
renderAll();
persist({ immediate: true });
// move anexos antigos do localStorage para o IndexedDB (uma vez só)
migrateLegacyAttachments(state).then((changed) => { if (changed) persist({ immediate: true }); }).catch(() => {});
checkAiModel();
