// Dropdown de sugestões @ e tags de referência atômicas no editor contenteditable.
import { icons, fileIcon } from './icons.js';

export class MentionController {
  constructor({ editor, container, dropdown, getFiles, onSelect }) {
    this.editor = editor;
    this.container = container;
    this.dropdown = dropdown;
    this.getFiles = getFiles;
    this.onSelect = onSelect;
    this.items = [];
    this.activeIndex = 0;
    this.open = false;
    this.replaceRange = null;

    editor.addEventListener('input', () => this.update());
    editor.addEventListener('click', () => this.update());
    editor.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) this.update();
    });
    editor.addEventListener('scroll', () => this.position());
    editor.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !this.dropdown.contains(e.target) && !this.editor.contains(e.target)) this.close();
    });
    window.addEventListener('resize', () => this.position());
  }

  caretRange() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!this.editor.contains(range.startContainer)) return null;
    return range;
  }

  textBeforeCaret() {
    const range = this.caretRange();
    if (!range) return '';
    const prefix = range.cloneRange();
    prefix.selectNodeContents(this.editor);
    prefix.setEnd(range.startContainer, range.startOffset);
    return prefix.toString();
  }

  // Range que cobre os últimos "count" caracteres antes do cursor.
  rangeBefore(count) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const caret = selection.getRangeAt(0);
    const walker = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    let caretIndex = nodes.indexOf(caret.startContainer);
    if (caretIndex === -1) return null;

    let remaining = count;
    let startNode = caret.startContainer;
    let startOffset = caret.startOffset;
    for (let i = caretIndex; i >= 0 && remaining > 0; i--) {
      const node = nodes[i];
      const available = i === caretIndex ? caret.startOffset : node.textContent.length;
      if (available >= remaining) {
        startNode = node;
        startOffset = available - remaining;
        remaining = 0;
      } else {
        remaining -= available;
        startNode = node;
        startOffset = 0;
      }
    }
    if (remaining > 0) return null;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(caret.startContainer, caret.startOffset);
    return range;
  }

  update() {
    const before = this.textBeforeCaret();
    const match = /(?:^|[\s(])@([^@\n]*)$/.exec(before);
    if (!match) {
      this.close();
      return;
    }

    const query = match[1].toLowerCase();
    const files = this.getFiles().filter((file) =>
      file.name.toLowerCase().includes(query),
    ).slice(0, 8);

    if (!files.length) {
      this.close();
      return;
    }

    this.replaceRange = this.rangeBefore(1 + match[1].length);
    this.items = files;
    this.activeIndex = Math.min(this.activeIndex, files.length - 1);
    this.open = true;
    this.render();
    this.dropdown.classList.add('is-visible');
    this.position();
  }

  render() {
    this.dropdown.innerHTML = `
      <div class="mention-dropdown__head">Arquivos do projeto <span>↑↓ navegar · Enter inserir · Esc fechar</span></div>
      ${this.items.map((file, index) => `
        <button type="button" class="mention-item ${index === this.activeIndex ? 'is-active' : ''}" data-index="${index}">
          <span class="mention-item__icon">${file.kind === 'attachment' ? (icons[fileIcon(file.name, file.type)] || icons.file) : (icons['file-text'] || '')}</span>
          <span class="mention-item__name">${escapeHtml(file.name)}</span>
          <span class="mention-item__kind">${file.kind === 'attachment' ? 'Anexo' : 'Prompt'}</span>
        </button>`).join('')}
    `;
    this.dropdown.querySelectorAll('.mention-item').forEach((button) => {
      button.addEventListener('mouseenter', () => {
        this.activeIndex = Number(button.dataset.index);
        this.highlight();
      });
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.select(this.items[Number(button.dataset.index)]);
      });
    });
  }

  highlight() {
    this.dropdown.querySelectorAll('.mention-item').forEach((el, index) => {
      el.classList.toggle('is-active', index === this.activeIndex);
    });
  }

  position() {
    if (!this.open) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const caret = selection.getRangeAt(0).cloneRange();
    caret.collapse(true);
    let rect = caret.getBoundingClientRect();
    if (!rect || (!rect.top && !rect.left)) rect = this.editor.getBoundingClientRect();

    const containerRect = this.container.getBoundingClientRect();
    const left = rect.left - containerRect.left;
    const top = rect.bottom - containerRect.top + 8;
    const dropdownWidth = 340;
    const maxLeft = Math.max(8, containerRect.width - dropdownWidth - 8);
    this.dropdown.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
    this.dropdown.style.top = `${Math.max(8, Math.min(top, containerRect.height - 250))}px`;
  }

  onKeyDown(e) {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const chip = adjacentChip(e.key === 'Backspace' ? 'before' : 'after');
      if (chip) {
        e.preventDefault();
        chip.remove();
        this.editor.dispatchEvent(new Event('input', { bubbles: true }));
        this.close();
      }
      return;
    }
    if (!this.open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.items.length;
      this.highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.activeIndex = (this.activeIndex - 1 + this.items.length) % this.items.length;
      this.highlight();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      this.select(this.items[this.activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  select(file) {
    if (!file) return;
    const range = this.replaceRange;
    if (range) {
      range.deleteContents();
      const chip = document.createElement('span');
      chip.className = 'mention-tag';
      chip.dataset.mention = file.name;
      chip.contentEditable = 'false';
      chip.textContent = `@${file.name}`;
      range.insertNode(chip);
      const space = document.createTextNode(' ');
      chip.after(space);

      const after = document.createRange();
      after.setStart(space, 1);
      after.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(after);
    }
    this.close();
    this.editor.focus();
    this.editor.dispatchEvent(new Event('input', { bubbles: true }));
    this.onSelect?.(file);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.items = [];
    this.replaceRange = null;
    this.dropdown.classList.remove('is-visible');
    this.dropdown.innerHTML = '';
  }
}

function adjacentChip(direction) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  const offset = range.startOffset;
  const before = direction === 'before';

  if (node.nodeType === Node.TEXT_NODE) {
    const atBoundary = before ? offset === 0 : offset === node.textContent.length;
    if (!atBoundary) return null;
    const sibling = before ? node.previousSibling : node.nextSibling;
    return sibling?.classList?.contains('mention-tag') ? sibling : null;
  }

  const sibling = node.childNodes[before ? offset - 1 : offset];
  return sibling?.classList?.contains('mention-tag') ? sibling : null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
