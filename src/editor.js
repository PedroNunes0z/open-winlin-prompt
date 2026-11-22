// Editor markdown com UMA única fonte de verdade: a string de texto.
//
// O contenteditable é apenas uma renderização determinística dessa string:
//   - cada "\n" do modelo é exatamente um nó de texto com "\n";
//   - nunca deixamos <div>, <p> ou <br> criados pelo navegador virarem linhas;
//   - um único <br class="editor-tail-br"> (ignorado na leitura) existe só para
//     o cursor aparecer na última linha vazia, quando o texto termina em "\n".
//
// Toda edição passa por beforeinput -> modelo -> reconstrução do DOM. O que não
// for interceptado (IME, cortar, arrastar) é normalizado no evento input.
// Assim o texto do usuário é preservado caractere por caractere, sem linhas em
// branco fantasmas surgindo durante a digitação ou a renderização.

const TAIL_BR_CLASS = 'editor-tail-br';

// Blocos que o navegador eventualmente cria sozinho (fallback de leitura).
// Cada bloco "folha" vale uma quebra de linha; containers (ul/ol/blockquote…)
// não criam quebras próprias para não duplicar as dos seus filhos.
const LEAF_BLOCKS = new Set([
  'DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'DT', 'DD', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER',
  'FIGURE', 'FIGCAPTION', 'ADDRESS',
]);

const LIST_MARKER = /^(\s*)(?:(?:\d+[.)])|[-*+])(\s+)(?:\[[ xX]\]\s+)?/;
const QUOTE_MARKER = /^(\s*)>\s?/;
const HEAD_MARKER = /^#{1,6}\s+/;
const EMPTY_LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/;

const normalizeText = (value) => String(value ?? '').replace(/\r\n?/g, '\n');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nodeIndex = (node) => Array.prototype.indexOf.call(node.parentNode.childNodes, node);
const beforeNode = (node) => ({ node: node.parentNode, offset: nodeIndex(node) });
const afterNode = (node) => ({ node: node.parentNode, offset: nodeIndex(node) + 1 });

/* ------------------------------ leitura do DOM ------------------------------ */
// `boundary` = { node, offset } de um caret: a leitura para nesse ponto.
// `segments` permite mapear cada faixa do texto de volta para um nó de texto.
function scan(root, boundary = null) {
  let text = '';
  const segments = [];
  let stopped = false;

  const emit = (value, node = null, boundaryAt = null, chip = null) => {
    if (!value || stopped) return;
    const start = text.length;
    text += value;
    segments.push({ start, end: text.length, node, boundaryAt, chip });
  };
  const atLineStart = () => text === '' || text.endsWith('\n');
  const isFinalDescendant = (node) => {
    let current = node;
    while (current !== root && current.parentNode && current === current.parentNode.lastChild) {
      current = current.parentNode;
    }
    return current === root;
  };

  function visit(node) {
    if (stopped) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const data = normalizeText(node.data);
      const chip = node.parentElement?.classList?.contains('mention-tag') ? node.parentElement : null;
      if (boundary && boundary.node === node) {
        const upTo = normalizeText(node.data.slice(0, boundary.offset)).length;
        emit(data.slice(0, upTo), node, null, chip);
        stopped = true;
      } else {
        emit(data, node, null, chip);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    // Texto fantasma da sugestão da IA nunca faz parte do documento.
    if (node.classList.contains('ghost-suggestion')) {
      if (boundary && (boundary.node === node || node.contains(boundary.node))) stopped = true;
      return;
    }

    if (node.tagName === 'BR') {
      const isTail = node.classList.contains(TAIL_BR_CLASS);
      // Chrome deixa um <br> extra só para o cursor aparecer. Ele não é uma
      // linha nova de verdade (e era a origem das linhas vazias fantasmas).
      const isPhantom = !isTail && isFinalDescendant(node)
        && (atLineStart() || LEAF_BLOCKS.has(node.parentNode.tagName));
      if (isTail || isPhantom) {
        if (boundary && (
          boundary.node === node
          || (boundary.node === node.parentNode && boundary.offset > nodeIndex(node))
        )) stopped = true;
        return;
      }
      emit('\n', null, () => beforeNode(node));
      return;
    }

    const children = node.childNodes;
    const limit = boundary?.node === node ? Math.min(boundary.offset, children.length) : children.length;
    const isLeaf = LEAF_BLOCKS.has(node.tagName);
    // separa o bloco anterior deste sem duplicar uma quebra já existente
    if (isLeaf && !atLineStart()) emit('\n', null, () => beforeNode(node));
    let previousWasLeaf = false;
    for (let i = 0; i < limit; i++) {
      if (stopped) break;
      const child = children[i];
      if (previousWasLeaf && !atLineStart()) emit('\n', null, () => beforeNode(child));
      visit(child);
      previousWasLeaf = child.nodeType === Node.ELEMENT_NODE && LEAF_BLOCKS.has(child.tagName);
    }
    if (boundary?.node === node) stopped = true;
  }

  visit(root);
  return { text, segments };
}

export function readEditor(editor) {
  return scan(editor).text;
}

export function caretOffsets(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const inside = (node) => node === editor || editor.contains(node);
  if (!inside(range.startContainer) || !inside(range.endContainer)) return null;
  const start = scan(editor, { node: range.startContainer, offset: range.startOffset }).text.length;
  const end = scan(editor, { node: range.endContainer, offset: range.endOffset }).text.length;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function placeCaret(editor, caret) {
  if (!caret) return;
  const { text, segments } = scan(editor);
  const total = text.length;
  const start = clamp(caret.start, 0, total);
  const end = clamp(caret.end ?? start, 0, total);
  const tail = editor.lastChild?.nodeType === Node.ELEMENT_NODE
    && editor.lastChild.classList.contains(TAIL_BR_CLASS) ? editor.lastChild : null;

  const locate = (target) => {
    // Fim de texto que termina em "\n": o cursor fica ANTES do <br> sentinela,
    // que é justamente a linha vazia visível no fim do documento.
    if (tail && target === total && text.endsWith('\n')) {
      return { node: editor, offset: nodeIndex(tail) };
    }
    for (const segment of segments) {
      if (target < segment.start || target > segment.end) continue;
      if (segment.node && !segment.chip) {
        return { node: segment.node, offset: clamp(target - segment.start, 0, segment.node.data.length) };
      }
      // Chip de @menção é atômico: o cursor fica antes ou depois dele.
      if (segment.chip) {
        const middle = segment.start + (segment.end - segment.start) / 2;
        return target <= middle ? beforeNode(segment.chip) : afterNode(segment.chip);
      }
      if (segment.boundaryAt) return segment.boundaryAt();
    }
    const last = [...segments].reverse().find((segment) => segment.node && !segment.chip);
    return last
      ? { node: last.node, offset: last.node.data.length }
      : { node: editor, offset: editor.childNodes.length };
  };

  const from = locate(start);
  const to = locate(end);
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/* ----------------------------- escrita do DOM ------------------------------ */

export function makeChip(name) {
  const chip = document.createElement('span');
  chip.className = 'mention-tag';
  chip.dataset.mention = name;
  chip.contentEditable = 'false';
  chip.textContent = `@${name}`;
  return chip;
}

export function fenceFor(content = '') {
  const runs = String(content).match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fenceOpen(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[1];
  // info string de cerca com crases não contém crases
  if (marker[0] === '`' && match[2].includes('`')) return null;
  return { char: marker[0], length: marker.length };
}

function fenceClose(line, fence) {
  if (!fence) return false;
  const char = fence.char === '`' ? '`' : '~';
  return new RegExp(`^ {0,3}${char}{${fence.length},}\\s*$`).test(line);
}

// Formatação inline: código e links vêm primeiro para não serem reprocessados
// por ênfase; "_" só delimita itálico fora de palavras.
const INLINE_RE = /(`+[^`\n]*?`+)|(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|(?<![\p{L}\p{N}])_[^_\n]+_(?![\p{L}\p{N}]))|(\[[^\]\n]+\]\([^)\s]+\))|(\$(?=\S)[^$\n]*?\S\$(?!\d))|(https?:\/\/[^\s<>()]+)/gu;

function appendInline(parent, text) {
  INLINE_RE.lastIndex = 0;
  let last = 0;
  let match;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const span = document.createElement('span');
    if (match[1]) span.className = 'fmt-code';
    else if (match[2]) {
      span.className = /^\*\*|^__/.test(match[2])
        ? 'fmt-bold'
        : (/^~~/.test(match[2]) ? 'fmt-strike' : 'fmt-italic');
    } else if (match[3] || match[5]) span.className = 'fmt-link';
    else if (match[4]) span.className = 'fmt-math';
    span.textContent = match[0];
    parent.appendChild(span);
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function makeMentionRe(names) {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!sorted.length) return null;
  const escaped = sorted.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`@(${escaped.join('|')})(?![\p{L}\p{N}_])`, 'gu');
}

function appendWithMentions(parent, text, mentionRe) {
  if (!mentionRe) { appendInline(parent, text); return; }
  mentionRe.lastIndex = 0;
  let last = 0;
  let match;
  while ((match = mentionRe.exec(text)) !== null) {
    if (match.index > last) appendInline(parent, text.slice(last, match.index));
    parent.appendChild(makeChip(match[1]));
    last = match.index + match[0].length;
  }
  if (last < text.length) appendInline(parent, text.slice(last));
}

// Classes de BLOCO aplicadas em <span> INLINE: as quebras de linha continuam
// sendo apenas os "\n" do texto. (Com display:block havia uma quebra visual
// extra de cada lado -> linhas vazias indevidas.)
function lineClasses(line) {
  const heading = /^(#{1,6})(?:\s+|$)/.exec(line);
  if (heading) return ['editor-heading', `editor-h${heading[1].length}`];

  const list = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/.exec(line);
  if (list) {
    const spaces = list[1].replace(/\t/g, '  ').length;
    const level = Math.min(5, Math.floor(spaces / 2));
    return [
      'editor-list',
      ...(level ? [`editor-list-level-${level}`] : []),
      ...(list[4] ? ['editor-task'] : []),
    ];
  }
  if (/^\s*>/.test(line)) return ['editor-quote'];
  if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return ['editor-hr'];
  if (/^\s*\|.*\|\s*$/.test(line)) return ['editor-table'];
  return null;
}

function appendLine(parent, line, mentionRe) {
  if (!line) return;
  const classes = lineClasses(line);
  if (!classes) { appendWithMentions(parent, line, mentionRe); return; }
  const span = document.createElement('span');
  span.className = classes.join(' ');
  appendWithMentions(span, line, mentionRe);
  parent.appendChild(span);
}

export function writeEditor(editor, text = '', names = [], options = {}) {
  const value = normalizeText(text);
  const caret = options.caret ?? (options.preserveCaret ? caretOffsets(editor) : null);
  editor.innerHTML = '';
  const fragment = document.createDocumentFragment();
  const lines = value.split('\n');

  // Agrupa cercas de código (``` ou ~~~) como uma única unidade: o conteúdo
  // interno fica cru, inclusive as quebras, sem formatação inline.
  const units = [];
  for (let i = 0; i < lines.length;) {
    const open = fenceOpen(lines[i]);
    if (!open) {
      units.push({ kind: 'line', lines: [lines[i]] });
      i += 1;
      continue;
    }
    const group = [lines[i]];
    let closed = false;
    i += 1;
    while (i < lines.length) {
      group.push(lines[i]);
      if (fenceClose(lines[i], open)) { i += 1; closed = true; break; }
      i += 1;
    }
    units.push({ kind: 'code', lines: group, closed });
  }

  const mentionRe = makeMentionRe(names);
  units.forEach((unit, index) => {
    if (index > 0) fragment.appendChild(document.createTextNode('\n'));
    if (unit.kind === 'code') {
      const span = document.createElement('span');
      span.className = unit.closed ? 'editor-codeblock' : 'editor-codeblock editor-codeblock--open';
      span.textContent = unit.lines.join('\n');
      fragment.appendChild(span);
    } else {
      appendLine(fragment, unit.lines[0], mentionRe);
    }
  });

  editor.appendChild(fragment);
  if (value.endsWith('\n')) {
    const tail = document.createElement('br');
    tail.className = TAIL_BR_CLASS;
    editor.appendChild(tail);
  }
  if (caret) placeCaret(editor, caret);
}

/* --------------------------- edições sobre o modelo --------------------------- */

function prevChar(text, position) {
  if (position <= 0) return 0;
  let index = position - 1;
  const low = text.charCodeAt(index);
  if (low >= 0xdc00 && low <= 0xdfff && index > 0) {
    const high = text.charCodeAt(index - 1);
    if (high >= 0xd800 && high <= 0xdbff) return index - 1;
  }
  return index;
}

function nextChar(text, position) {
  if (position >= text.length) return text.length;
  const high = text.charCodeAt(position);
  let index = position + 1;
  if (high >= 0xd800 && high <= 0xdbff && index < text.length) {
    const low = text.charCodeAt(index);
    if (low >= 0xdc00 && low <= 0xdfff) index += 1;
  }
  return index;
}

function wordBackward(text, position) {
  let index = position;
  while (index > 0 && /[ \t]/.test(text[index - 1])) index -= 1;
  if (index > 0 && text[index - 1] === '\n') return index - 1;
  while (index > 0 && !/\s/.test(text[index - 1])) index -= 1;
  return index;
}

function wordForward(text, position) {
  let index = position;
  while (index < text.length && /[ \t]/.test(text[index])) index += 1;
  if (index < text.length && text[index] === '\n') return index + 1;
  while (index < text.length && !/\s/.test(text[index])) index += 1;
  return index;
}

function replace(text, from, to, value, caret) {
  return {
    text: text.slice(0, from) + value + text.slice(to),
    caret,
  };
}

function editForInput(text, caret, type, event) {
  const { start, end } = caret;
  const data = event.dataTransfer?.getData('text/plain');
  const insertions = {
    insertText: event.data ?? data ?? '',
    insertReplacementText: event.data ?? data ?? '',
    insertFromPasteWithoutFormatting: data ?? event.data ?? '',
    insertLineBreak: '\n',
    insertParagraph: '\n',
  };
  if (Object.prototype.hasOwnProperty.call(insertions, type)) {
    const value = normalizeText(insertions[type]);
    if (!value) return null; // sem dados: não mexe na seleção
    const position = start + value.length;
    return replace(text, start, end, value, position);
  }

  switch (type) {
    case 'deleteContentBackward': {
      if (start !== end) return replace(text, start, end, '', start);
      const from = prevChar(text, start);
      return replace(text, from, start, '', from);
    }
    case 'deleteContentForward': {
      if (start !== end) return replace(text, start, end, '', start);
      const to = nextChar(text, start);
      return replace(text, start, to, '', start);
    }
    case 'deleteWordBackward': {
      const from = start === end ? wordBackward(text, start) : start;
      return replace(text, from, end, '', from);
    }
    case 'deleteWordForward': {
      const to = start === end ? wordForward(text, start) : end;
      return replace(text, start, to, '', start);
    }
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward': {
      const from = start === end ? text.lastIndexOf('\n', start - 1) + 1 : start;
      return replace(text, from, end, '', from);
    }
    case 'deleteSoftLineForward':
    case 'deleteHardLineForward': {
      const newline = text.indexOf('\n', end);
      const to = newline === -1 ? text.length : newline + 1;
      return replace(text, start, to, '', start);
    }
    case 'deleteEntireSoftLine': {
      const from = text.lastIndexOf('\n', start - 1) + 1;
      const newline = text.indexOf('\n', end);
      const to = newline === -1 ? text.length : newline + 1;
      return replace(text, from, to, '', from);
    }
    case 'deleteByCut':
    case 'deleteContent':
    case 'deleteByDrag':
      return replace(text, start, end, '', start);
    default:
      return null; // tipo desconhecido: deixa nativo e normaliza no input
  }
}

// Intervalos linha a linha dos blocos cerca (``` ... ```), usados para
// desfazer a formatação mesmo quando o cursor está DENTRO do bloco.
function fenceRanges(text) {
  const lines = text.split('\n');
  const offsets = [];
  let cursor = 0;
  for (const line of lines) { offsets.push(cursor); cursor += line.length + 1; }
  const ranges = [];
  let open = null;
  let openLine = -1;
  lines.forEach((line, index) => {
    if (open) {
      if (fenceClose(line, open)) {
        ranges.push({ openLine, closeLine: index, start: offsets[openLine], end: Math.min(text.length, offsets[index + 1] ?? text.length) });
        open = null;
      }
    } else {
      const found = fenceOpen(line);
      if (found) { open = found; openLine = index; }
    }
  });
  // Cerca sem fechamento vai até o fim do documento (é assim que marked lê).
  if (open) ranges.push({ openLine, closeLine: lines.length - 1, start: offsets[openLine], end: text.length, unterminated: true });
  return { lines, offsets, ranges };
}

// Retorna o intervalo do bloco cerca que contém `position`, ou null.
export function codeBlockAt(text, position) {
  return fenceRanges(normalizeText(text)).ranges.find(
    (range) => position >= range.start && position <= range.end,
  ) || null;
}

function continuationFor(line) {
  const ordered = /^(\s*)(\d+)([.)])(\s+)/.exec(line);
  if (ordered) return `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]}${ordered[4]}`;
  const task = /^(\s*)([-*+])(\s+)\[[ xX]\]\s+/.exec(line);
  if (task) return `${task[1]}${task[2]}${task[3]}[ ] `;
  const bullet = /^(\s*)([-*+])(\s+)/.exec(line);
  if (bullet) return `${bullet[1]}${bullet[2]}${bullet[3]}`;
  const quote = /^((?:\s*>\s?)+)/.exec(line);
  if (quote) return quote[1];
  const indent = /^([ \t]+)\S/.exec(line);
  if (indent) return indent[1];
  return '';
}

/* ------------------------- melhoria local do prompt ------------------------- */
// Limpeza determinística e opcional (botão "Melhorar prompt" sem IA local).
// Nunca toca no conteúdo de blocos de código cercados e nunca cria linhas em
// branco dentro de listas/citações.
export function improvePromptText(source = '') {
  const lines = normalizeText(source).split('\n');
  const result = [];
  let fence = null;
  let blankRun = 0;
  let blankAfterFence = false;

  for (const raw of lines) {
    if (fence) {
      result.push(raw); // código: preserva exatamente, inclusive espaços
      if (fenceClose(raw, fence)) { fence = null; blankAfterFence = true; }
      continue;
    }
    const open = fenceOpen(raw);
    if (open) {
      fence = open;
      if (result.length && result[result.length - 1] !== '') result.push('');
      result.push(raw);
      blankRun = 0;
      continue;
    }

    let line = raw.replace(/[ \t]+$/, '');
    line = line.replace(/^(#{1,6})(?=[^\s#])/, '$1 ');
    line = line.replace(/^(\s*)([-*+]|\d+[.)])(?=[^\s])/, '$1$2 ');
    line = line.replace(/^(\s*)>(?=[^\s>])/, '$1> ');

    if (!line.trim()) {
      blankRun += 1;
      if (blankRun > 1) continue; // no máximo UMA linha em branco
      result.push('');
      continue;
    }
    blankRun = 0;
    if (blankAfterFence && result[result.length - 1] !== '') result.push('');
    blankAfterFence = false;
    result.push(line);
  }

  while (result.length && !result[result.length - 1].trim()) result.pop();
  const body = result.join('\n');
  return body ? `${body}\n` : '';
}

/* --------------------------------- controlador -------------------------------- */

export class MarkdownEditor {
  constructor({
    element,
    getNames = () => [],
    onCommit = () => {},
    onHistory = () => {},
    onFormat = () => {},
    onEditStart = () => {},
  }) {
    this.element = element;
    this.getNames = getNames;
    this.onCommit = onCommit;
    this.onHistory = onHistory;
    this.onFormat = onFormat;
    this.onEditStart = onEditStart;
    this.composing = false;
    this.selfDispatch = false;
    this.attach();
  }

  get text() { return readEditor(this.element); }
  get caret() { return caretOffsets(this.element); }
  get names() { return this.getNames() || []; }

  attach() {
    const element = this.element;
    element.addEventListener('beforeinput', (event) => this.onBeforeInput(event));
    element.addEventListener('input', (event) => this.onInput(event));
    element.addEventListener('compositionstart', () => { this.composing = true; });
    element.addEventListener('compositionend', () => {
      this.composing = false;
      // Espera o input final da composição antes de reconstruir o DOM.
      setTimeout(() => this.normalizeFromDom(), 0);
    });
    element.addEventListener('keydown', (event) => this.onKeyDown(event));
    element.addEventListener('paste', (event) => this.onPaste(event));
    element.addEventListener('cut', (event) => this.onCut(event));
    element.addEventListener('copy', (event) => this.onCopy(event));
    element.addEventListener('drop', (event) => this.onDrop(event));
  }

  // Escreve o modelo no DOM, reposiciona o caret e avisa a aplicação.
  commit(text, caret = null, { notify = true } = {}) {
    const value = normalizeText(text);
    const bounds = caret ? {
      start: clamp(caret.start, 0, value.length),
      end: clamp(caret.end ?? caret.start, 0, value.length),
    } : null;
    if (bounds && document.activeElement !== this.element) {
      this.element.focus({ preventScroll: true });
    }
    writeEditor(this.element, value, this.names, { caret: bounds });
    this.onCommit({ text: value, caret: bounds });
    if (notify) {
      this.selfDispatch = true;
      this.element.dispatchEvent(new Event('input', { bubbles: true }));
      this.selfDispatch = false;
    }
  }

  normalizeFromDom() {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    this.commit(text, caret, { notify: false });
  }

  onInput(event) {
    if (this.selfDispatch || this.composing || event.isComposing) return;
    this.normalizeFromDom();
  }

  onBeforeInput(event) {
    const type = event.inputType;
    if (this.composing || event.isComposing
      || type === 'insertCompositionText' || type === 'deleteCompositionText') return;

    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      this.onHistory(type === 'historyUndo' ? 'undo' : 'redo');
      return;
    }
    if (type.startsWith('format')) {
      event.preventDefault();
      this.onFormat(type);
      return;
    }
    // paste/cut/drop têm eventos próprios, com acesso ao clipboard/drag data
    if (type === 'insertFromPaste' || type === 'insertFromDrop' || type === 'deleteByCut') return;

    const caret = this.caret;
    if (!caret) return;
    const text = this.text;
    const edit = editForInput(text, caret, type, event);
    if (!edit) return; // tipo não mapeado: nativo + normalização no input

    event.preventDefault();
    this.onEditStart();
    this.commit(edit.text, { start: edit.caret, end: edit.caret }, { notify: true });
  }

  onKeyDown(event) {
    // Outros listeners (atalhos, IA, dropdown de @) têm prioridade.
    if (event.defaultPrevented || this.composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      this.onEditStart();
      this.indent(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      this.onEditStart();
      this.newLine(true);
    }
  }

  onPaste(event) {
    event.preventDefault();
    const text = normalizeText(event.clipboardData?.getData('text/plain') || '');
    if (text) this.insert(text);
  }

  onCopy(event) {
    const caret = this.caret;
    if (!caret || caret.start === caret.end) return;
    const selected = this.text.slice(caret.start, caret.end);
    event.clipboardData?.setData('text/plain', selected);
    event.preventDefault();
  }

  onCut(event) {
    // Só garante que o texto copiado é o modelo canônico. A exclusão fica com
    // o navegador e é normalizada no evento input (evita apagar duas vezes).
    const caret = this.caret;
    if (!caret || caret.start === caret.end) return;
    const selected = this.text.slice(caret.start, caret.end);
    event.clipboardData?.setData('text/plain', selected);
  }

  onDrop(event) {
    event.preventDefault();
    const text = normalizeText(event.dataTransfer?.getData('text/plain') || '');
    if (!text) return;
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range && (range.startContainer === this.element || this.element.contains(range.startContainer))) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    this.insert(text);
  }

  /* ------------------------------- primitives ------------------------------- */

  replaceRange(start, end, value, caret = null) {
    const text = this.text;
    const from = clamp(start, 0, text.length);
    const to = clamp(end, from, text.length);
    const inserted = normalizeText(value);
    const position = from + inserted.length;
    this.commit(
      text.slice(0, from) + inserted + text.slice(to),
      caret ?? { start: position, end: position },
      { notify: true },
    );
  }

  insert(value, options = {}) {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    const inserted = normalizeText(value);
    const next = text.slice(0, caret.start) + inserted + text.slice(caret.end);
    const base = caret.start;
    const bounds = Number.isInteger(options.selectFrom) ? {
      start: base + clamp(options.selectFrom, 0, inserted.length),
      end: base + clamp(options.selectTo ?? inserted.length, 0, inserted.length),
    } : { start: base + inserted.length, end: base + inserted.length };
    this.commit(next, bounds, { notify: true });
  }

  newLine(smart = false) {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    if (!smart) { this.replaceRange(caret.start, caret.end, '\n'); return; }

    const lineStart = text.lastIndexOf('\n', caret.start - 1) + 1;
    const before = text.slice(lineStart, caret.start);
    const nextBreak = text.indexOf('\n', caret.end);
    const after = text.slice(caret.end, nextBreak === -1 ? text.length : nextBreak);

    // Item de lista vazio + Enter = sai da lista (sem linha em branco extra).
    if (EMPTY_LIST_ITEM.test(before) && !after.trim()) {
      this.replaceRange(lineStart, caret.end, '');
      return;
    }
    let value = '\n';
    if (!after.trim()) {
      const continuation = continuationFor(before);
      if (continuation) value = `\n${continuation}`;
    }
    this.replaceRange(caret.start, caret.end, value);
  }

  // Tab / Shift+Tab: 2 espaços por nível. Em seleção multilinha, indenta ou
  // recua todas as linhas — é assim que se cria/remove o aninhamento de listas.
  indent(direction) {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    const from = text.lastIndexOf('\n', caret.start - 1) + 1;
    const searchFrom = caret.end > caret.start ? caret.end - 1 : caret.start;
    const breakIndex = text.indexOf('\n', searchFrom);
    const to = breakIndex === -1 ? text.length : breakIndex;
    const lines = text.slice(from, to).split('\n');

    // Cursor parado no meio de uma linha comum: Tab insere 2 espaços.
    // Em linha de lista/citação/título (ou na indentação), Tab recua a linha
    // inteira — é assim que se cria o aninhamento.
    if (caret.start === caret.end && direction > 0 && lines.length === 1) {
      const line = lines[0];
      const inIndent = /^[ \t]*$/.test(line.slice(0, caret.start - from));
      if (!inIndent && !LIST_MARKER.test(line) && !QUOTE_MARKER.test(line) && !HEAD_MARKER.test(line)) {
        this.replaceRange(caret.start, caret.end, '  ');
        return;
      }
    }

    const changedLines = lines.map((line) => {
      if (!line.trim()) return line;
      return direction > 0 ? `  ${line}` : line.replace(/^(?: {1,2}|\t)/, '');
    });
    const changed = changedLines.join('\n');
    if (changed === lines.join('\n')) return;
    const deltaFirst = changedLines[0].length - lines[0].length;
    const position = clamp(caret.start + deltaFirst, from, from + changed.length);
    const bounds = caret.start === caret.end
      ? { start: position, end: position }
      : { start: from, end: from + changed.length };
    this.commit(
      text.slice(0, from) + changed + text.slice(to),
      bounds,
      { notify: true },
    );
  }

  transformLines(transform) {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    const from = text.lastIndexOf('\n', caret.start - 1) + 1;
    const searchFrom = caret.end > caret.start ? caret.end - 1 : caret.start;
    const breakIndex = text.indexOf('\n', searchFrom);
    const to = breakIndex === -1 ? text.length : breakIndex;
    const lines = text.slice(from, to).split('\n');
    const changed = transform(lines);
    if (!changed || changed.join('\n') === lines.join('\n')) return;
    const replacement = changed.join('\n');
    const delta = changed[0].length - lines[0].length;
    const position = clamp(caret.start + delta, from, from + replacement.length);
    const bounds = caret.start === caret.end
      ? { start: position, end: position }
      : { start: from, end: from + replacement.length };
    this.commit(text.slice(0, from) + replacement + text.slice(to), bounds, { notify: true });
  }

  /* ------------------------------- formatação ------------------------------- */

  wrapSelection(prefix, suffix = '', placeholder = '') {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    const body = text.slice(caret.start, caret.end) || placeholder;
    const inserted = `${prefix}${body}${suffix}`;
    const next = text.slice(0, caret.start) + inserted + text.slice(caret.end);
    this.commit(next, {
      start: caret.start + prefix.length,
      end: caret.start + prefix.length + body.length,
    }, { notify: true });
  }

  toggleWrap(prefix, suffix = '', placeholder = '') {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    const { start, end } = caret;
    const selected = text.slice(start, end);

    // 1) a seleção já inclui os marcadores
    if (selected.length > prefix.length + suffix.length
      && selected.startsWith(prefix)
      && (!suffix || selected.endsWith(suffix))) {
      const inner = selected.slice(prefix.length, suffix ? -suffix.length : undefined);
      this.commit(text.slice(0, start) + inner + text.slice(end),
        { start, end: start + inner.length }, { notify: true });
      return;
    }
    // 2) os marcadores estão logo fora da seleção
    if (text.slice(Math.max(0, start - prefix.length), start) === prefix
      && (!suffix || text.slice(end, end + suffix.length) === suffix)) {
      const from = start - prefix.length;
      const to = end + (suffix ? suffix.length : 0);
      this.commit(text.slice(0, from) + selected + text.slice(to),
        { start: from, end: from + selected.length }, { notify: true });
      return;
    }
    // 3) cursor solto dentro de um trecho já marcado
    if (start === end && suffix) {
      const open = text.lastIndexOf(prefix, Math.max(0, start - 1));
      const close = text.indexOf(suffix, start);
      if (open !== -1 && close !== -1 && open + prefix.length <= start && close >= start) {
        const inner = text.slice(open + prefix.length, close);
        if (!inner.includes('\n')) {
          const next = text.slice(0, open) + inner + text.slice(close + suffix.length);
          this.commit(next, { start: open, end: open + inner.length }, { notify: true });
          return;
        }
      }
    }
    // 4) aplica os marcadores
    const body = selected || placeholder;
    const inserted = `${prefix}${body}${suffix}`;
    const next = text.slice(0, start) + inserted + text.slice(end);
    this.commit(next, {
      start: start + prefix.length,
      end: start + prefix.length + body.length,
    }, { notify: true });
  }

  toggleList() {
    this.transformLines((lines) => {
      const meaningful = lines.filter((line) => line.trim());
      const all = meaningful.length > 0 && meaningful.every((line) => LIST_MARKER.test(line));
      return lines.map((line) => {
        if (!line.trim()) return line; // nunca transforma linha em branco em item
        if (all) return line.replace(LIST_MARKER, '$1');
        if (LIST_MARKER.test(line)) return line;
        const indent = /^(\s*)/.exec(line)[1];
        return `${indent}- ${line.slice(indent.length)}`;
      });
    });
  }

  toggleQuote() {
    this.transformLines((lines) => {
      const meaningful = lines.filter((line) => line.trim());
      const all = meaningful.length > 0 && meaningful.every((line) => QUOTE_MARKER.test(line));
      return lines.map((line) => {
        if (!line.trim()) return line;
        if (all) return line.replace(QUOTE_MARKER, '$1');
        if (QUOTE_MARKER.test(line)) return line;
        const indent = /^(\s*)/.exec(line)[1];
        return `${indent}> ${line.slice(indent.length)}`;
      });
    });
  }

  // Título é um PREFIXO DE LINHA, não um "wrap": "## " no meio da linha não
  // cria um título em markdown.
  toggleHeading(level = 2) {
    const marker = `${'#'.repeat(clamp(level, 1, 6))} `;
    this.transformLines((lines) => {
      const meaningful = lines.filter((line) => line.trim());
      const all = meaningful.length > 0 && meaningful.every((line) => line.startsWith(marker));
      return lines.map((line) => {
        if (!line.trim()) return line;
        if (all) return line.replace(HEAD_MARKER, '');
        return marker + line.replace(HEAD_MARKER, '');
      });
    });
  }

  toggleCodeBlock(placeholder = 'cole o código aqui') {
    const text = this.text;
    const caret = this.caret ?? { start: text.length, end: text.length };
    const { lines, ranges } = fenceRanges(text);

    // Cursor/seleção dentro de uma cerca existente: remove as duas linhas da
    // cerca, preservando exatamente o conteúdo (e qualquer indentação).
    const enclosing = ranges.find((range) => caret.start >= range.start && caret.start <= range.end);
    if (enclosing) {
      const inner = enclosing.unterminated
        ? lines.slice(enclosing.openLine + 1).join('\n')
        : lines.slice(enclosing.openLine + 1, enclosing.closeLine).join('\n');
      const next = text.slice(0, enclosing.start) + inner + text.slice(enclosing.end);
      this.commit(next, { start: enclosing.start, end: enclosing.start + inner.length }, { notify: true });
      return;
    }

    const from = text.lastIndexOf('\n', caret.start - 1) + 1;
    const searchFrom = caret.end > caret.start ? caret.end - 1 : caret.start;
    const breakIndex = text.indexOf('\n', searchFrom);
    const to = breakIndex === -1 ? text.length : breakIndex;
    const block = text.slice(from, to);

    const body = block.trim() ? block : placeholder;
    const fence = fenceFor(body);
    const prefix = text.slice(0, from);
    const suffix = to < text.length ? text.slice(to + 1) : '';
    // Uma (e apenas uma) linha em branco separa a cerca do texto adjacente.
    const before = from > 0 && prefix.replace(/\n+$/, '').length > 0 && !/\n\s*\n$/.test(prefix) ? '\n' : '';
    const after = suffix.trim() && !/^\s*\n/.test(suffix) ? '\n' : '';
    const inserted = `${before}${fence}\n${body}\n${fence}${after}`;
    const next = text.slice(0, from) + inserted + text.slice(to);
    const bodyStart = from + before.length + fence.length + 1;
    this.commit(next, { start: bodyStart, end: bodyStart + body.length }, { notify: true });
  }

  insertSnippet(text) {
    this.insert(text);
  }
}
