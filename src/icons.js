const svg = (paths, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  sparkle: svg('<path d="M10 1.8l1.6 4.6L16.2 8l-4.6 1.6L10 14.2 8.4 9.6 3.8 8l4.6-1.6L10 1.8z"/><path d="M16 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/>'),
  'folder-add': svg('<path d="M2.5 5.5A1.5 1.5 0 014 4h4l1.6 2H16a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0116 16H4a1.5 1.5 0 01-1.5-1.5v-9z"/><path d="M10 9v5M7.5 11.5h5"/>'),
  search: svg('<circle cx="8.8" cy="8.8" r="5.3"/><path d="M12.7 12.7L17 17"/>'),
  'arrow-import': svg('<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M3.5 13.5v2A1.5 1.5 0 005 17h10a1.5 1.5 0 001.5-1.5v-2"/>'),
  'arrow-export': svg('<path d="M10 12V3M6.5 6.5L10 3l3.5 3.5"/><path d="M3.5 13.5v2A1.5 1.5 0 005 17h10a1.5 1.5 0 001.5-1.5v-2"/>'),
  moon: svg('<path d="M16.2 12.8A7 7 0 017.2 3.8a7 7 0 109 9z"/>'),
  sun: svg('<circle cx="10" cy="10" r="3.4"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4"/>'),
  add: svg('<path d="M10 4v12M4 10h12"/>'),
  attach: svg('<path d="M14.7 8.1l-5.4 5.4a2.6 2.6 0 01-3.7-3.7l6.1-6.1a1.8 1.8 0 012.5 2.5l-6 6a1 1 0 01-1.4-1.4l5.3-5.3"/>'),
  copy: svg('<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M13 4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13"/>'),
  download: svg('<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M3.5 14v1.5A1.5 1.5 0 005 17h10a1.5 1.5 0 001.5-1.5V14"/>'),
  split: svg('<rect x="2.5" y="3.5" width="15" height="13" rx="1.8"/><path d="M10 3.5v13"/>'),
  'file-text': svg('<path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.5v4h4M7.5 10h5M7.5 13h5"/>'),
  'code-file': svg('<path d="M7.5 7L4.5 10l3 3M12.5 7l3 3-3 3"/>'),
  eye: svg('<path d="M1.8 10S4.5 5.5 10 5.5 18.2 10 18.2 10 15.5 14.5 10 14.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.2"/>'),
  'eye-off': svg('<path d="M3.5 3.5l13 13M7.4 6.2A9.6 9.6 0 0110 5.5c5.5 0 8.2 4.5 8.2 4.5a17 17 0 01-3 3.4M5 8A16.5 16.5 0 001.8 10S4.5 14.5 10 14.5c1.2 0 2.3-.2 3.3-.6"/>'),
  folder: svg('<path d="M2.5 5.5A1.5 1.5 0 014 4h4l1.6 2H16a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0116 16H4a1.5 1.5 0 01-1.5-1.5v-9z"/>'),
  'folder-open': svg('<path d="M2.5 6.5V5A1.5 1.5 0 014 3.5h4l1.6 2H16A1.5 1.5 0 0117.5 7v1"/><path d="M2.5 8.5h15l-1.7 6.2a1.5 1.5 0 01-1.4 1.1H4a1.5 1.5 0 01-1.5-1.5v-5.8z"/>'),
  file: svg('<path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.5v4h4"/>'),
  trash: svg('<path d="M4 6h12M8 6V4h4v2M6 6l.7 10.5h6.6L14 6M8.5 9v4.5M11.5 9v4.5"/>'),
  rename: svg('<path d="M4 16h12M5.5 12.5l7.8-7.8 2 2-7.8 7.8-2.7.7.7-2.7z"/>'),
  send: svg('<path d="M17 3L8.5 11.5M17 3l-5.5 14-3-6.5L2 7.5 17 3z"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  chevron: svg('<path d="M7 5l5 5-5 5"/>'),
  check: svg('<path d="M4 10.5l4 4 8-9"/>'),
  refresh: svg('<path d="M17 10a7 7 0 11-2.3-5.1M17 2.5v3h-3"/>'),
  settings: svg('<circle cx="10" cy="10" r="2.6"/><path d="M10 2.2l1.1 2 2.2-.4.6 2.2 2 .9-.9 2 .9 2-2 .9-.6 2.2-2.2-.4-1.1 2-1.1-2-2.2.4-.6-2.2-2-.9.9-2-.9-2 2-.9.6-2.2 2.2.4L10 2.2z"/>'),
  link: svg('<path d="M8.2 11.8a3.4 3.4 0 004.8 0l3-3a3.4 3.4 0 10-4.8-4.8l-1.5 1.5"/><path d="M11.8 8.2a3.4 3.4 0 00-4.8 0l-3 3a3.4 3.4 0 104.8 4.8l1.5-1.5"/>'),
  list: svg('<path d="M7 5h10M7 10h10M7 15h10"/><path d="M3.2 5h.4M3.2 10h.4M3.2 15h.4"/>'),
  quote: svg('<path d="M3.5 6.5c0-1 .8-2 2-2H8v2H6.2c.2 1-.4 1.8-1.2 2.2.7.4 1.2 1.2 1.2 2.1 0 1.5-1.2 2.7-2.7 2.7S1 12.3 1 10.8C1 8.2 2 6.5 3.5 6.5zM11 6.5c0-1 .8-2 2-2h2.5v2h-1.8c.2 1-.4 1.8-1.2 2.2.7.4 1.2 1.2 1.2 2.1 0 1.5-1.2 2.7-2.7 2.7s-2.5-1.2-2.5-2.7C8.5 8.2 9.5 6.5 11 6.5z"/>'),
  // --- biblioteca: APIs / IDEs / WebSites ---
  api: svg('<circle cx="7.5" cy="7.5" r="4.5"/><circle cx="12.5" cy="12.5" r="4.5"/><path d="M10.5 9.5l2 2"/>'),
  ide: svg('<rect x="2" y="3.5" width="16" height="13" rx="1.6"/><path d="M2 6.8h16M5 5.2h.4M7 5.2h.4"/><path d="M8.5 9.5L6.8 11l1.7 1.5M11.5 9.5L13.2 11l-1.7 1.5"/>'),
  globe: svg('<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2 2 3 4.6 3 7.5s-1 5.5-3 7.5c-2-2-3-4.6-3-7.5S8 4.5 10 2.5z"/>'),
  key: svg('<circle cx="7" cy="12.5" r="4"/><path d="M10 9.5L17.5 2M14.5 4.5l2.5 2.5M12 7l2 2"/>'),
  external: svg('<path d="M12.5 3.5h4v4"/><path d="M16.5 3.5L9 11"/><path d="M7 5.5H5A1.5 1.5 0 003.5 7v8A1.5 1.5 0 005 16.5h8A1.5 1.5 0 0014.5 15v-2"/>'),
  // --- quadro de tarefas e notas ---
  board: svg('<rect x="2.5" y="3.5" width="4.6" height="13" rx="1.2"/><rect x="8.4" y="3.5" width="4.6" height="9" rx="1.2"/><rect x="14.3" y="3.5" width="3.2" height="11" rx="1.2"/>'),
  note: svg('<path d="M4 3.5h9.5L17 7v9.5H4z"/><path d="M13.5 3.5V7H17"/><path d="M6.5 10h6M6.5 13h4"/>'),
  bell: svg('<path d="M5.5 8.5a4.5 4.5 0 019 0c0 3.4 1.3 4.6 1.3 5.5H4.2c0-.9 1.3-2.1 1.3-5.5z"/><path d="M8.2 16.2a1.9 1.9 0 003.6 0"/>'),
  calendar: svg('<rect x="3" y="4.5" width="14" height="12" rx="1.6"/><path d="M3 8h14M7 3v3M13 3v3"/>'),
  drag: svg('<circle cx="8" cy="6" r="1"/><circle cx="12" cy="6" r="1"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="8" cy="14" r="1"/><circle cx="12" cy="14" r="1"/>'),
  'arrow-down': svg('<path d="M10 3v12M5.5 10.5L10 15l4.5-4.5"/>'),
  // --- ícones por tipo de arquivo anexado ---
  'file-image': svg('<rect x="2.5" y="3.5" width="15" height="13" rx="1.8"/><circle cx="7" cy="8" r="1.8"/><path d="M3 16.5l4.5-4.5 2.5 2.5 3-3 4 4"/>'),
  'file-video': svg('<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M8.5 8l4.5 2.5L8.5 13V8z"/>'),
  'file-audio': svg('<path d="M7 15.5V6l8-2v9.5"/><circle cx="5" cy="15.5" r="2.2"/><circle cx="13" cy="13.5" r="2.2"/>'),
  'file-pdf': svg('<path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.5v4h4"/><path d="M7 9.5c1 .2 2 .2 3-.3.5.8 1.4 1.2 2.5 1M7 12.5v3M10 12.5v3M7 14h3M10 14h3"/>'),
  'file-archive': svg('<path d="M3.5 3.5h13v4h-13z"/><path d="M5 7.5v8A1.5 1.5 0 006.5 17h7a1.5 1.5 0 001.5-1.5v-8"/><path d="M10 10v2.5"/>'),
  'file-data': svg('<path d="M6 3.5C4 3.5 3 5.5 3 8v4c0 2.5 1 4.5 3 4.5M14 3.5c2 0 3 2 3 4.5v4c0 2.5-1 4.5-3 4.5"/>'),
  'file-sheet': svg('<rect x="3" y="2.5" width="14" height="15" rx="1.6"/><path d="M3 7.5h14M3 12.5h14M8 7.5v10M13 7.5v10"/>'),
  'file-slides': svg('<rect x="2.5" y="3" width="15" height="11" rx="1.6"/><path d="M8.5 6.5l5 2.5-5 2.5v-5zM7 17h6M10 14v3"/>'),
  'file-font': svg('<path d="M4 16V4.5h7M4 10h6M13.5 16l3.5-8 3.5 8M14.8 13.5h4.4"/>'),
  'file-app': svg('<rect x="3" y="3" width="14" height="14" rx="3"/><circle cx="10" cy="10" r="3.2"/><path d="M10 1.8V3M10 17v1.2"/>'),
  'file-markdown': svg('<path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.5v4h4M7 10.5l1.8 1.8L7 14.1M9.5 10.5v3.6M11.5 12.3l1.5 1.8 1.5-1.8"/>'),
};

/** Ícone personalizado conforme extensão/MIME do anexo. */
export function fileIcon(name = '', type = '') {
  const ext = String(name).split('.').pop().toLowerCase();
  const mime = String(type || '').toLowerCase();
  if (mime.startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp','avif','tif','tiff','ico','svg'].includes(ext)) return 'file-image';
  if (mime.startsWith('video/') || ['mp4','mov','avi','mkv','webm','wmv','flv'].includes(ext)) return 'file-video';
  if (mime.startsWith('audio/') || ['mp3','wav','ogg','flac','m4a','aac','opus'].includes(ext)) return 'file-audio';
  if (ext === 'pdf' || mime === 'application/pdf') return 'file-pdf';
  if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext) || mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return 'file-archive';
  if (['xls','xlsx','csv','tsv','ods'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) return 'file-sheet';
  if (['ppt','pptx','odp','key'].includes(ext) || mime.includes('presentation')) return 'file-slides';
  if (['ttf','otf','woff','woff2','eot'].includes(ext) || mime.includes('font')) return 'file-font';
  if (['exe','msi','dmg','apk','deb','rpm','appimage','bat','cmd','com','scr'].includes(ext)) return 'file-app';
  if (['md','markdown','mdx'].includes(ext)) return 'file-markdown';
  if (['json','jsonc','xml','yml','yaml','toml','ini','cfg','conf','env','csv','tsv','sql','graphql','lock'].includes(ext)) return 'file-data';
  if (['js','mjs','cjs','ts','jsx','tsx','py','java','cs','go','rs','c','h','cpp','hpp','php','rb','swift','kt','sh','bash','ps1','html','htm','css','scss','less','vue','svelte','lua','pl','r','dart','scala','clj'].includes(ext) || mime.includes('javascript') || mime.includes('typescript') || mime.includes('html') || mime.includes('css')) return 'code-file';
  if (['doc','docx','odt','rtf','txt','log','epub','mobi'].includes(ext) || mime.startsWith('text/') || mime.includes('word') || mime.includes('document')) return 'file-text';
  return 'file';
}

export function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.dataset.icon;
    if (icons[name]) el.innerHTML = icons[name];
  });
}
