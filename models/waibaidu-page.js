import {sketch} from './viewer.js';

async function startViewer() {
  const embedded = document.getElementById('waibaidu-geometry');
  const model = embedded ? JSON.parse(embedded.textContent) : await fetch('./waibaidu.json').then(response => {
    if (!response.ok) throw new Error('Model unavailable');
    return response.json();
  });
  const viewer = sketch(document.getElementById('geometry'), model);
  for (const button of document.querySelectorAll('[data-view]'))
    button.addEventListener('click', () => viewer.setView(button.dataset.view));
  document.getElementById('zoom-in').addEventListener('click', () => viewer.magnify(1.24));
  document.getElementById('zoom-out').addEventListener('click', () => viewer.magnify(1/1.24));
  document.addEventListener('bridgelab:preferences',viewer.draw);
}
startViewer().catch(() => {
  const hint = document.getElementById('viewer-hint');
  hint.dataset.zh = '模型加载失败，请刷新页面重试。';
  hint.textContent = window.BridgePrefs.text('Model unavailable. Reload to retry.',hint.dataset.zh);
});
