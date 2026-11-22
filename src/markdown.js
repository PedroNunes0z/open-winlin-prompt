// Renderizador Markdown: GFM, realce de sintaxe, matemática e sanitização.
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import csharp from 'highlight.js/lib/languages/csharp';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';

for (const [name, language] of Object.entries({
  javascript, js: javascript, typescript, ts: typescript, python, py: python,
  html: xml, xml, css, json, bash, sh: bash, shell: bash, powershell, ps1: powershell,
  sql, yaml, yml: yaml, markdown, md: markdown, csharp, cs: csharp,
  java, go, rust, rs: rust, diff, ini,
})) {
  hljs.registerLanguage(name, language);
}

const mathExtension = {
  name: 'math',
  level: 'inline',
  start(src) { return src.indexOf('$'); },
  tokenizer(src) {
    const block = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (block) {
      return { type: 'math', raw: block[0], text: block[1].trim(), display: true };
    }
    // Matemática inline só quando o cifrão "abraça" o conteúdo: abre sem espaço
    // depois, fecha sem espaço antes e sem dígito depois — assim "Preço: $5 e $10"
    // não vira fórmula.
    const inline = /^\$(?=\S)([^$\n]*?\S)\$(?!\d)/.exec(src);
    if (inline) {
      return { type: 'math', raw: inline[0], text: inline[1].trim(), display: false };
    }
    return undefined;
  },
  renderer(token) {
    try {
      return katex.renderToString(token.text, {
        displayMode: token.display,
        throwOnError: false,
        output: 'htmlAndMathml',
      });
    } catch {
      return token.raw;
    }
  },
};

const renderer = {
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const safeHref = DOMPurify.sanitize(href || '', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    const label = title ? ` title="${DOMPurify.sanitize(title)}"` : '';
    return `<a href="${safeHref}"${label} target="_blank" rel="noopener noreferrer">${text}</a>`;
  },
  image({ href, title, text }) {
    const safeHref = DOMPurify.sanitize(href || '', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    const label = title ? ` title="${DOMPurify.sanitize(title)}"` : '';
    return `<img src="${safeHref}" alt="${DOMPurify.sanitize(text || '')}"${label} loading="lazy">`;
  },
};

const md = new Marked(
  {
    gfm: true,
    // Uma quebra simples no editor aparece como quebra simples na prévia
    // (o editor é pre-wrap). Só a linha EM BRANCO separa parágrafos.
    breaks: true,
    pedantic: false,
  },
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      } catch {
        return code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      }
    },
  }),
);

md.use({ extensions: [mathExtension] });
md.use({ renderer });

export function renderMarkdown(source = '') {
  // Normaliza apenas o estilo de quebra (CRLF/CR do Windows). Nenhuma linha em
  // branco é inserida ou removida: a prévia recebe exatamente o texto digitado.
  const text = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rawHtml = md.parse(text);
  const html = DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel', 'loading', 'align', 'aria-hidden', 'style'],
    ADD_TAGS: ['annotation', 'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msub', 'msup', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mstyle', 'mpadded', 'mphantom', 'menclose', 'mtable', 'mtr', 'mtd', 'maction', 'mglyph', 'mlabeledtr', 'mmultiscripts', 'mover', 'munder', 'munderover', 'none'],
  });
  return decorateCodeBlocks(html);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function decorateCodeBlocks(html) {
  return html.replace(/<pre><code(?: class="hljs language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g, (match, lang, code) => {
    const name = lang || 'texto';
    return `<div class="code-block"><div class="code-block__bar"><span class="code-block__lang">${escapeHtml(name)}</span><button class="code-block__copy" type="button" data-copy-code aria-label="Copiar código">Copiar</button></div><pre><code class="hljs language-${escapeHtml(name)}">${code}</code></pre></div>`;
  });
}

export function highlightPlain(text = '') {
  return hljs.highlightAuto(String(text)).value;
}
