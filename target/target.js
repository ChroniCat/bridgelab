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
function draw(offset){
  brush.fillStyle='#fff';brush.fillRect(0,0,board.width,board.height);
  brush.fillStyle='#090909';
  for(const [id,[x,y]] of Object.entries(centres)){
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      if(BoardVision.cell(id,row,col))brush.fillRect(x+(col-4)*markCell,y+(row-4)*markCell+(id==='TARGET'?offset:0),markCell,markCell);
    }
  }
}
function renderControls(){
  moveButton.textContent=shifted?text('Return target','目标归位'):text('Move target','移动目标');
  expandButton.textContent=expanded?text('Exit expanded view','收起测试板'):text('Expand board','放大测试板');
  printLink.setAttribute('href',text('../lab/BridgeLab-Board.pdf','../lab/BridgeLab-Board-zh.pdf'));
  const qrReady=code.hasAttribute('src')&&!code.hidden;
  byId('pair-instruction').textContent=qrReady
    ?text('Scan with your phone camera. Once the AR page opens, show the board on this screen.','用手机系统相机扫码。手机打开 AR 页面后，在这台设备上点「显示测试板」。')
    :text('Open this link on your phone, then show the board on this screen.','在手机上打开此链接，再在这台设备上点「显示测试板」。');
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
model.addEventListener('change',()=>{
  const current=new URL(location.href);current.searchParams.set('bridge',model.value);current.searchParams.delete('model');
  history.replaceState(null,'',current);syncLink();
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
document.addEventListener('bridgelab:preferences',renderControls);
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
