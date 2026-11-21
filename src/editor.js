// Editor markdown com pré-visualização simples das formatações no próprio editor.
// O texto continua sendo markdown cru (editável); os trechos formatados recebem
// apenas classes visuais (negrito, título, código, link etc.).

// Blocos que o próprio navegador cria ao apertar Enter (<div>, <p>…).
// Cada um deles vale por uma linha — sem isso, o Enter some na releitura
// e era preciso apertar várias vezes para a linha realmente quebrar.
const BLOCK_TAGS = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/;

function readNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.classList?.contains('mention-tag')) {
    return `@${node.dataset.mention || node.textContent.replace(/^@/, '')}`;
  }
  // o texto fantasma da sugestão nunca faz parte do documento
  if (node.classList?.contains('ghost-suggestion')) return '';
  if (node.tagName === 'BR') return '\n';
  if (BLOCK_TAGS.test(node.tagName)) {
    const inner = readChildren(node);
    return inner === '' ? '\n' : `${inner.endsWith('\n') ? inner : `${inner}\n`}`;
  }
  return readChildren(node);
}

function readChildren(parent) {
  let text = '';
  const nodes = parent.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    // O navegador deixa um <br> extra no final apenas para o cursor aparecer
    // ("texto<br><br>"): esse último não é uma linha nova de verdade.
      if (node.tagName === 'BR' && i === nodes.length - 1 && (text === '' || text.endsWith('\n'))) continue;
    const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.test(node.tagName);
    // separa o bloco anterior do próximo sem duplicar quebras já existentes
    if (isBlock && text && !text.endsWith('\n')) text += '\n';
    text += readNode(node);
  }
  return text;
}

export function readEditor(editor) {
  return readChildren(editor);
}

export function makeChip(name) {
  const chip = document.createElement('span');
  chip.className = 'mention-tag';
  chip.dataset.mention = name;
  chip.contentEditable = 'false';
  chip.textContent = `@${name}`;
  return chip;
}

function caretOffset(editor) {
  const offsets = selectionOffsets(editor);
  return offsets ? { start: offsets.start, end: offsets.end } : null;
}

function placeCaret(editor, saved) {
  if (saved == null) return;
  const offset = typeof saved === 'object' ? saved.start : saved;
  const endOffset = typeof saved === 'object' ? saved.end : saved;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
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
  const from = locate(offset);
  const to = locate(endOffset);
  const selection = window.getSelection();
  if (from && to) {
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  const end = document.createRange();
  end.selectNodeContents(editor);
  end.collapse(false);
  selection.removeAllRanges();
  selection.addRange(end);
}

const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))|(\$(?=\S)[^$\n]*?\S\$(?!\d))|(https?:\/\/[^\s<>()]+)/g;

function appendInline(parent, text) {
  INLINE_RE.lastIndex = 0;
  let last = 0;
  let match;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const span = document.createElement('span');
    if (match[1]) span.className = (/^\*\*|^__/.test(match[1]) ? 'fmt-bold' : (/^~~/.test(match[1]) ? 'fmt-strike' : 'fmt-italic'));
    else if (match[2]) span.className = 'fmt-code';
    else if (match[3] || match[5]) span.className = 'fmt-link';
    else if (match[4]) span.className = 'fmt-math';
    span.textContent = match[0];
    parent.appendChild(span);
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function blockSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  appendInline(span, text);
  return span;
}

function lineClass(line) {
  if (/^#{1,6}\s/.test(line)) return `editor-heading editor-h${Math.min(6, line.match(/^#+/)[0].length)}`;
  if (/^\s*([-*+]|\d+\.)\s/.test(line) || /^\s*-\s\[[ xX]\]/.test(line)) return 'editor-list';
  if (/^>\s?/.test(line)) return 'editor-quote';
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return 'editor-hr';
  if (/^\|.*\|\s*$/.test(line)) return 'editor-table';
  return null;
}

export function writeEditor(editor, text = '', names = [], { preserveCaret = false } = {}) {
  const savedCaret = preserveCaret ? caretOffset(editor) : null;
  editor.innerHTML = '';
  const fragment = document.createDocumentFragment();

  // 1) separa blocos de código cercados (``` ... ```) — sem formatação interna.
  const units = [];
  const fenceRe = /(```[\s\S]*?(?:```|$))/g;
  let fenceMatch;
  let lastFence = 0;
  const pushTextWithMentions = (chunk) => {
    if (!chunk) return;
    const sorted = [...names].sort((a, b) => b.length - a.length);
    if (!sorted.length) { units.push({ kind: 'text', text: chunk }); return; }
    const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mentionRe = new RegExp(`@(${escaped.join('|')})`, 'g');
    let last = 0;
    let m;
    while ((m = mentionRe.exec(chunk)) !== null) {
      if (m.index > last) units.push({ kind: 'text', text: chunk.slice(last, m.index) });
      units.push({ kind: 'chip', text: m[1] });
      last = m.index + m[0].length;
    }
    if (last < chunk.length) units.push({ kind: 'text', text: chunk.slice(last) });
  };
  while ((fenceMatch = fenceRe.exec(text)) !== null) {
    pushTextWithMentions(text.slice(lastFence, fenceMatch.index));
    units.push({ kind: 'code', text: fenceMatch[1] });
    lastFence = fenceMatch.index + fenceMatch[1].length;
  }
  pushTextWithMentions(text.slice(lastFence));

  // 2) converte unidades em nós, com estilos simples de bloco/inline.
  let atLineStart = true;
  for (const unit of units) {
    if (unit.kind === 'chip') {
      fragment.appendChild(makeChip(unit.text));
      atLineStart = false;
      continue;
    }
    if (unit.kind === 'code') {
      const span = document.createElement('span');
      span.className = 'editor-codeblock';
      span.textContent = unit.text;
      fragment.appendChild(span);
      atLineStart = true;
      continue;
    }
    const parts = unit.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        fragment.appendChild(document.createTextNode('\n'));
        atLineStart = true;
      }
      if (!part) return;
      const cls = atLineStart ? lineClass(part) : null;
      if (cls) fragment.appendChild(blockSpan(cls, part));
      else appendInline(fragment, part);
      atLineStart = false;
    });
  }

  editor.appendChild(fragment);
  ensureTrailingBreak(editor);
  if (savedCaret != null) placeCaret(editor, savedCaret);
}

// Em pre-wrap, uma quebra no fim do documento não aparece (o cursor ficaria no
// fim da linha anterior). Um <br> no final cria a linha vazia de verdade.
function ensureTrailingBreak(editor) {
  const last = editor.lastChild;
  if (!last) { editor.appendChild(document.createElement('br')); return; }
  if (last.nodeName === 'BR') return;
  const text = last.textContent || '';
  if (text.endsWith('\n')) editor.appendChild(document.createElement('br'));
}

export function insertText(editor, text, { selectFrom, selectTo } = {}) {
  const selection = window.getSelection();
  let node;
  if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).startContainer)) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    node = document.createTextNode(text);
    range.insertNode(node);
    const caret = document.createRange();
    caret.setStart(node, text.length);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  } else {
    node = document.createTextNode(text);
    editor.appendChild(node);
  }
  ensureTrailingBreak(editor);
  editor.focus();

  if (Number.isInteger(selectFrom)) {
    const range = document.createRange();
    range.setStart(node, selectFrom);
    range.setEnd(node, Number.isInteger(selectTo) ? selectTo : text.length);
    const selectionAfter = window.getSelection();
    selectionAfter.removeAllRanges();
    selectionAfter.addRange(range);
  }

  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return node;
}

export function wrapSelection(editor, prefix, suffix = '', placeholder = '') {
  const selection = window.getSelection();
  const selected = selection?.toString() || placeholder;
  insertText(editor, `${prefix}${selected}${suffix}`, {
    selectFrom: prefix.length,
    selectTo: prefix.length + selected.length,
  });
}

function selectionOffsets(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).startContainer)) return null;
  const range = selection.getRangeAt(0);
  const offsetOf = (node, offset) => {
    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(node, offset);
    return pre.toString().length;
  };
  return {
    start: offsetOf(range.startContainer, range.startOffset),
    end: offsetOf(range.endContainer, range.endOffset),
    range,
  };
}

function rangeFromOffsets(editor, start, end) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
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

function replaceRange(editor, start, end, text) {
  const range = rangeFromOffsets(editor, start, end);
  if (!range) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  insertText(editor, text);
}

// Liga/desliga a formatação: clicar de novo no mesmo botão remove os marcadores,
// em vez de empilhar asteriscos (****texto****).
export function toggleWrap(editor, prefix, suffix = '', placeholder = '') {
  const info = selectionOffsets(editor);
  const text = editor.textContent;
  if (!info) {
    insertText(editor, `${prefix}${placeholder}${suffix}`, {
      selectFrom: prefix.length,
      selectTo: prefix.length + placeholder.length,
    });
    return;
  }
  const { start, end } = info;
  const selected = text.slice(start, end);
  // a seleção já inclui os marcadores: remove
  if (selected.length > prefix.length + suffix.length && selected.startsWith(prefix) && selected.endsWith(suffix)) {
    const inner = selected.slice(prefix.length, suffix.length ? -suffix.length : undefined);
    replaceRange(editor, start, end, inner);
    return;
  }
  // os marcadores estão logo fora da seleção: remove
  if (suffix && text.slice(start - prefix.length, start) === prefix && text.slice(end, end + suffix.length) === suffix) {
    replaceRange(editor, start - prefix.length, end + suffix.length, selected);
    return;
  }
  // prefixo sem sufixo (título): remove se está logo antes da seleção
  if (!suffix && text.slice(start - prefix.length, start) === prefix) {
    replaceRange(editor, start - prefix.length, end, selected);
    return;
  }
  // cursor (sem seleção) dentro de um trecho já marcado: desmarca o trecho
  if (start === end && suffix) {
    const standalone = (pos, marker) => text[pos - 1] !== marker[0] && text[pos + marker.length] !== marker[0];
    const openIdx = text.lastIndexOf(prefix, start - 1);
    const closeIdx = text.indexOf(suffix, end);
    if (openIdx !== -1 && closeIdx !== -1 && standalone(openIdx, prefix) && standalone(closeIdx, suffix)) {
      replaceRange(editor, openIdx, closeIdx + suffix.length, text.slice(openIdx + prefix.length, closeIdx));
      return;
    }
  }
  wrapSelection(editor, prefix, suffix, placeholder || selected);
}

// Liga/desliga um prefixo de linha (- , > ): clicar de novo remove das linhas.
export function toggleLinePrefix(editor, prefix) {
  const info = selectionOffsets(editor);
  const text = editor.textContent;
  if (!info) {
    insertText(editor, prefix);
    return;
  }
  const lineStart = text.lastIndexOf('\n', info.start - 1) + 1;
  const lineEndIdx = text.indexOf('\n', info.end);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const has = lines.some((l) => l.startsWith(prefix));
  const next = lines.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : (has ? l : prefix + l))).join('\n');
  replaceRange(editor, lineStart, lineEnd, next);
}

export function insertSnippet(editor, text) {
  insertText(editor, text);
}
