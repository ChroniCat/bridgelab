import {experimentScene, loadExperimentScene} from './bridge-experiment.js?v=wb4';

const get = id => document.getElementById(id);
const {text} = window.BridgePrefs;
const view = get('board-view');
const canvas = get('board');
const brush = canvas.getContext('2d');
const detail = get('detail-crop');
const crop = detail.getContext('2d');
const move = get('move-target');
const expand = get('expand-board');
const dialog = get('pair-dialog');
const phone = get('phone-camera');
const link = get('pair-url');
const code = get('pair-code');
let scene, shifted = false, expanded = false, copied = false, timer, failed = false;

function labels() {
  move.textContent = shifted ? text('Restore joint','恢复节点原位') : text('Lower the joint','模拟节点下移');
  get('target-state').textContent = !scene ? '' : shifted ? text('Lowered','已下移') : text('At baseline','原位');
  expand.textContent = expanded ? text('Exit enlarged view','收起画面') : text('Enlarge view','放大画面');
  get('copy-link').textContent = copied ? text('Copied','已复制') : text('Copy link','复制链接');
  if (failed) get('loading').textContent = text('Bridge view unavailable. Reload to retry.','桥梁画面载入失败，请重新打开此页。');
}

function draw() {
  scene.draw(brush, shifted);
  const [x,y] = experimentScene.target;
  // Use a fixed crop for both positions so the displacement is visible in the detail view.
  const width = 215, height = width * detail.height / detail.width;
  crop.drawImage(canvas, x-width/2, y-36, width, height, 0, 0, detail.width, detail.height);
  move.setAttribute('aria-pressed', String(shifted));
  labels();
}

move.addEventListener('click', () => {
  if (!scene) return;
  shifted = !shifted;
  draw();
});
function setExpanded(on) {
  expanded = on;
  view.classList.toggle('expanded',on);
  for (const el of document.querySelectorAll('.site-head,.introduction,.joint-lab footer')) el.inert = on;
  expand.setAttribute('aria-pressed',String(on));
  labels();
  expand.focus();
}
expand.addEventListener('click', () => setExpanded(!expanded));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && expanded) setExpanded(false); });

function openPhoneLink() {
  copied = false;
  labels();
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open','');
}
get('pair-open').addEventListener('click',openPhoneLink);
get('pair-close').addEventListener('click', () => { if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); });
get('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link.value);
    copied = true;
    clearTimeout(timer);
    labels();
    timer = setTimeout(() => { copied = false; labels(); }, 1600);
  } catch { link.focus(); link.select(); }
});
code.addEventListener('error', () => { code.hidden = true; });
document.addEventListener('bridgelab:preferences',labels);

async function start() {
  const url = new URL(location.href);
  if (['bridge','model'].some(key => url.searchParams.get(key) === 'training-span')) {
    location.replace(new URL('./markers.html?bridge=training-span&v=wb4', url));
    return;
  }
  const address = new URL(phone.getAttribute('href'), url);
  phone.href = address.href;
  link.value = address.href;
  if (address.origin === 'https://chronicat.github.io' && address.pathname === '/bridgelab/target/mobile.html') {
    code.src = code.dataset.src || './phone-bridge-joint-wb4.png';
    code.hidden = false;
  }
  try {
    scene = await loadExperimentScene();
    canvas.width = experimentScene.width;
    canvas.height = experimentScene.height;
    draw();
    move.disabled = false;
    get('loading').hidden = true;
  } catch {
    failed = true;
    labels();
  }
}
start();
