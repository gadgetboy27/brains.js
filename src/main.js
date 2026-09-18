// Application entry point: boot the app into #app (see public/index.html).
import './ui/theme.css';
import { bootApp } from './app.js';

bootApp().catch((err) => {
  // Boot itself failed before the HUD existed; show the plainest possible surface.
  const el = document.querySelector('#app') ?? document.body;
  el.textContent = String(err?.message ?? err);
});
