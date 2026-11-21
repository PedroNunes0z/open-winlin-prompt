// Site do Open Winlin Prompt: tema claro/escuro + troca de telas.
(function () {
  const STORAGE_KEY = 'open-winlin-prompt.site-theme';
  const root = document.documentElement;

  function applyTheme(theme) {
    root.dataset.theme = theme === 'light' ? 'light' : 'dark';
    document.querySelectorAll('[data-theme-icon]').forEach((el) => {
      el.setAttribute('aria-pressed', String((el.dataset.themeIcon === 'light') === (root.dataset.theme === 'light')));
    });
    // imagens com versão clara e escura
    document.querySelectorAll('img[data-light-src][data-dark-src]').forEach((img) => {
      const next = root.dataset.theme === 'light' ? img.dataset.lightSrc : img.dataset.darkSrc;
      if (img.getAttribute('src') !== next) img.setAttribute('src', next);
    });
  }

  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* modo privado */ }
  if (!stored) {
    stored = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(stored);

  document.querySelectorAll('[data-theme-icon]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = root.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignora */ }
      applyTheme(next);
    });
  });

  // galeria de telas
  document.querySelectorAll('[data-shot-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const group = tab.closest('[data-shot-group]');
      if (!group) return;
      group.querySelectorAll('[data-shot-tab]').forEach((item) => {
        item.setAttribute('aria-selected', String(item === tab));
      });
      group.querySelectorAll('[data-shot-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.shotPanel !== tab.dataset.shotTab;
      });
    });
  });

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
