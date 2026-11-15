// Load before paint so every entry page uses the same language and color scheme.
(() => {
  'use strict';
  const root = document.documentElement;
  const languageKey = 'bridgelab.ui.language';
  const themeKey = 'bridgelab.ui.theme';
  const colorQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const remembered = new WeakMap();

  function stored(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function remember(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* Keep this tab's choice. */ }
  }
  function defaultLanguage() {
    const first = navigator.languages?.[0] || navigator.language || '';
    return /^zh(?:[-_]|$)/i.test(first) ? 'zh' : 'en';
  }
  function currentChoice(key, options) {
    const value = stored(key);
    return options.includes(value) ? value : null;
  }

  let language = currentChoice(languageKey, ['en', 'zh']) || defaultLanguage();
  let themeChoice = currentChoice(themeKey, ['light', 'dark']);
  let mounted = false;
  const theme = () => themeChoice || (colorQuery.matches ? 'dark' : 'light');
  const text = (english, chinese) => language === 'zh' ? chinese : english;
  const icons = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M20.6 14.3a8.8 8.8 0 0 1-10.9-11A9.2 9.2 0 1 0 20.6 14.3z"/>'
  };

  function applyRoot() {
    root.lang = text('en', 'zh-CN');
    root.dataset.theme = theme();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme() === 'dark' ? '#0c0d10' : '#f8f9fc';
  }
  function translate(element, attribute, chinese) {
    let originals = remembered.get(element);
    if (!originals) { originals = new Map(); remembered.set(element, originals); }
    if (!originals.has(attribute)) {
      originals.set(attribute, attribute ? element.getAttribute(attribute) : element.textContent);
    }
    const value = text(originals.get(attribute) || '', chinese);
    if (attribute) {
      if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
    } else if (element.textContent !== value) {
      element.textContent = value;
    }
  }
  function updateStatic() {
    for (const el of document.querySelectorAll('[data-zh], [data-zh-aria], [data-zh-title]')) {
      if (el.hasAttribute('data-zh')) translate(el, '', el.dataset.zh);
      if (el.hasAttribute('data-zh-aria')) translate(el, 'aria-label', el.dataset.zhAria);
      if (el.hasAttribute('data-zh-title')) translate(el, 'title', el.dataset.zhTitle);
    }
    for (const controls of document.querySelectorAll('[data-preferences]')) {
      const languageButton = controls.querySelector('[data-language-button]');
      const themeButton = controls.querySelector('[data-theme-button]');
      controls.setAttribute('aria-label', text('Display settings', '显示设置'));
      languageButton.textContent = text('中文', 'EN');
      languageButton.lang = text('zh-CN', 'en');
      languageButton.title = text('切换到中文', 'Switch to English');
      languageButton.setAttribute('aria-label', languageButton.title);
      const dark = theme() === 'dark';
      themeButton.title = dark
        ? text('Switch to light theme', '切换到浅色')
        : text('Switch to dark theme', '切换到深色');
      themeButton.setAttribute('aria-label', themeButton.title);
      themeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[dark ? 'sun' : 'moon']+'</svg>';
    }
  }
  function apply() {
    applyRoot();
    if (!mounted) return;
    updateStatic();
    document.dispatchEvent(new CustomEvent('bridgelab:preferences', {detail: {language, theme: theme()}}));
  }
  function initialize() {
    for (const controls of document.querySelectorAll('[data-preferences]')) {
      controls.setAttribute('role', 'group');
      const languageButton = document.createElement('button');
      const themeButton = document.createElement('button');
      languageButton.type = themeButton.type = 'button';
      languageButton.dataset.languageButton = '';
      themeButton.dataset.themeButton = '';
      languageButton.addEventListener('click', () => {
        language = language === 'en' ? 'zh' : 'en';
        remember(languageKey, language);
        apply();
      });
      themeButton.addEventListener('click', () => {
        themeChoice = theme() === 'dark' ? 'light' : 'dark';
        remember(themeKey, themeChoice);
        apply();
      });
      controls.append(languageButton, themeButton);
    }
    mounted = true;
    apply();
  }

  window.BridgePrefs = {text, get language() { return language; }, get theme() { return theme(); }};
  applyRoot();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once:true});
  else initialize();
  const onSystemTheme = () => { if (!themeChoice) apply(); };
  if (colorQuery.addEventListener) colorQuery.addEventListener('change', onSystemTheme);
  else colorQuery.addListener(onSystemTheme);
  window.addEventListener('languagechange', () => {
    if (!currentChoice(languageKey, ['en', 'zh'])) { language = defaultLanguage(); apply(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== null && event.key !== languageKey && event.key !== themeKey) return;
    language = currentChoice(languageKey, ['en', 'zh']) || defaultLanguage();
    themeChoice = currentChoice(themeKey, ['light', 'dark']);
    apply();
  });
})();
