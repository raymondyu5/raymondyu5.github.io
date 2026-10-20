// light/dark toggle: remembers the choice; the canvas recolours via 'themechange'
(function () {
  const btn = document.querySelector('.theme-toggle'), root = document.documentElement;
  if (!btn) return;
  const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const SUN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';
  // show what you'd switch to: the sun in dark mode, the moon in light mode
  const label = () => { btn.innerHTML = dark() ? SUN : MOON; btn.setAttribute('aria-label', dark() ? 'Switch to light mode' : 'Switch to dark mode'); };
  btn.addEventListener('click', () => {
    root.dataset.theme = dark() ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
    label(); document.dispatchEvent(new Event('themechange'));
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  label();
})();
