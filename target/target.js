// Marker centres match the A4 reference. Larger screen codes remain readable at a distance.
const byId=id=>document.getElementById(id);
const board=byId('board'),brush=board.getContext('2d');
const moveButton=byId('move-target'),expandButton=byId('expand-board'),stage=byId('board-view');
const printLink=byId('print-board'),phone=byId('phone-camera'),model=byId('pair-model');
const pairDialog=byId('pair-dialog'),code=byId('pair-code'),linkField=byId('pair-url'),copyButton=byId('copy-link');
const {text}=window.BridgePrefs;
const centres={C1:[120,120],C2:[920,120],C3:[920,620],C4:[120,620],CHECK:[520,370],TARGET:[320,370]};
const markCell=14;
let shifted=false,animation=0,position=0,expanded=false,copied=false,copyTimer=0;
const page=new URL(location.href);
const initial=page.searchParams.get('bridge')||page.searchParams.get('model');
model.value=initial==='training-span'?initial:'waibaidu';
const artwork = {
  photo: byId('art-photo'),
  waibaidu: byId('art-waibaidu'),
  'training-span': byId('art-training-span')
};

function draw(offset) {
  brush.fillStyle = '#fff';
  brush.fillRect(0, 0, board.width, board.height);
  const photo = model.value === 'waibaidu' && byId('scene-view').value === 'photo';
  const scene = photo ? artwork.photo : artwork[model.value];
  if (scene.complete && scene.naturalWidth) brush.drawImage(scene, 0, 0, board.width, board.height);

  const isWaibaidu = model.value === 'waibaidu';
  brush.textAlign = 'center';
  if (!photo) {
    brush.fillStyle = '#34525a';
    brush.font = '600 19px system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    brush.fillText(isWaibaidu ? text('SHANGHAI  /  SUZHOU CREEK', '上海  /  苏州河') : text('TEACHING MODEL', '教学模型'), 520, 86);
    brush.fillStyle = '#203840';
    brush.font = 'bold 38px system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    brush.fillText(isWaibaidu ? text('Waibaidu Bridge', '外白渡桥') : text('Teaching truss', '教学桁架桥'), 520, 135, 520);
  }

  for (const [id, [x, baseY]] of Object.entries(centres)) {
    const target = id === 'TARGET';
    const y = baseY + (target ? offset : 0);
    const label = target ? text('MOVING TARGET', '可移动测点')
      : id === 'CHECK' ? text('FIXED CHECK', '固定校验点') : id;
    brush.fillStyle = '#fff';
    // Keep a full cell of white on every side, even over dense steelwork.
    brush.fillRect(x - 70, y - 70, 140, 168);
    brush.fillStyle = '#090909';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (BoardVision.cell(id, row, col)) {
          brush.fillRect(x + (col - 4) * markCell, y + (row - 4) * markCell, markCell, markCell);
        }
      }
    }
    brush.font = 'bold 17px system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    brush.fillStyle = target ? '#884221' : id === 'CHECK' ? '#275f55' : '#50636b';
    brush.fillText(label, x, y + 85, 132);
  }
}

function renderControls(){
  const detail = byId('detail-link');
  const waibaidu = model.value === 'waibaidu';
  detail.hidden = !waibaidu;
  byId('scene-control').hidden = !waibaidu;
  byId('photo-credit').hidden = !waibaidu || byId('scene-view').value !== 'photo';
  moveButton.textContent=shifted?text('Return target','让测点归位'):text('Lower target','让测点下移');
  byId('target-state').textContent=shifted
    ?text('Target set lower. Check the pixel reading on your phone.','测点已设为下移。请在手机上查看偏差读数。')
    :text('Target at its starting position.','测点在初始位置。');
  expandButton.textContent=expanded?text('Exit expanded view','收起测试板'):text('Expand board','放大测试板');
  printLink.setAttribute('href',text('../lab/BridgeLab-Board.pdf','../lab/BridgeLab-Board-zh.pdf'));
  const qrReady=code.hasAttribute('src')&&!code.hidden;
  byId('pair-instruction').textContent=qrReady
    ?text('Scan with your phone and allow camera access. Then return to the board on this screen.','用手机系统相机扫码并允许使用相机，再在电脑上点「返回测试板」。')
    :text('Open this link on your phone, then show the board on this screen.','在手机上打开此链接并允许使用相机，再在电脑上点「返回测试板」。');
  copyButton.textContent=copied?text('Copied','已复制'):text('Copy link','复制链接');
  code.alt=text('QR code for the mobile AR camera','手机 AR 相机二维码');
}
function syncLink(){
  copied=false;
  const href=new URL('../ar/',location.href);
  href.searchParams.set('mode','camera');
  href.searchParams.set('bridge',model.value);
  phone.href=href.href;linkField.value=href.href;
  // These two QR assets encode the deployed Pages URLs. On forks use their own link.
  code.hidden=href.origin!=='https://chronicat.github.io'||href.pathname!=='/bridgelab/ar/';
  if(code.hidden)code.removeAttribute('src');
  else code.src='./phone-'+model.value+'.png';
  renderControls();
}
code.addEventListener('error',()=>{code.hidden=true;renderControls()});
byId('scene-view').addEventListener('change',()=>{renderControls();draw(Math.round(position))});
model.addEventListener('change',()=>{
  const current=new URL(location.href);current.searchParams.set('bridge',model.value);current.searchParams.delete('model');
  history.replaceState(null,'',current);syncLink();draw(Math.round(position));
});
byId('pair-open').addEventListener('click',()=>{
  copied=false;renderControls();
  if(typeof pairDialog.showModal==='function')pairDialog.showModal();
  else pairDialog.setAttribute('open','');
});
byId('pair-close').addEventListener('click',()=>{
  if(typeof pairDialog.close==='function')pairDialog.close();else pairDialog.removeAttribute('open');
});
copyButton.addEventListener('click',async()=>{
  try{
    if(!navigator.clipboard?.writeText)throw Error();
    await navigator.clipboard.writeText(linkField.value);copied=true;renderControls();
    clearTimeout(copyTimer);copyTimer=setTimeout(()=>{copied=false;renderControls()},2000);
  }catch{linkField.focus();linkField.select();byId('pair-instruction').textContent=text('Copy the selected link and open it on your phone.','请复制选中的链接，在手机上打开。')}
});
function setExpanded(on){
  expanded=on;stage.classList.toggle('expanded',expanded);
  expandButton.setAttribute('aria-pressed',String(expanded));
  if('inert' in stage){
    document.querySelector('.site-head').inert=expanded;
    document.querySelector('.board-head').inert=expanded;
    document.querySelector('.board-footer').inert=expanded;
  }
  renderControls();expandButton.focus();
}
expandButton.addEventListener('click',()=>setExpanded(!expanded));
document.addEventListener('keydown',event=>{if(expanded&&event.key==='Escape')setExpanded(false)});
document.addEventListener('bridgelab:preferences',()=>{renderControls();draw(Math.round(position))});
for (const scene of Object.values(artwork)) scene.addEventListener('load', () => draw(Math.round(position)));
moveButton.addEventListener('click',()=>{
  shifted=!shifted;moveButton.setAttribute('aria-pressed',String(shifted));renderControls();
  cancelAnimationFrame(animation);
  const at=performance.now(),start=position,end=shifted?65:0;
  function step(t){
    const fraction=Math.min(1,(t-at)/1000);
    position=start+(end-start)*fraction;draw(Math.round(position));
    if(fraction<1)animation=requestAnimationFrame(step);
  }
  animation=requestAnimationFrame(step);
});
syncLink();draw(0);
