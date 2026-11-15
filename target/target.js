// Physical proportions match the A4 model. On an uncalibrated screen the test uses pixels.
const board=document.querySelector('canvas'),brush=board.getContext('2d');
const button=document.querySelector('#move-target');
const printLink=document.querySelector('#print-board');
const {text}=window.BridgePrefs;
const centres={C1:[120,120],C2:[920,120],C3:[920,620],C4:[120,620],CHECK:[520,370],TARGET:[320,370]};
function draw(offset){
  brush.fillStyle='#fff';brush.fillRect(0,0,board.width,board.height);
  brush.fillStyle='#090909';
  for(const [id,[x,y]] of Object.entries(centres)){
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      if(BoardVision.cell(id,row,col))brush.fillRect(x-40+10*col,y-40+10*row+(id==='TARGET'?offset:0),10,10);
    }
  }
}
let shifted=false,animation=0,position=0;
function renderControls(){
  button.textContent=shifted?text('Return target','目标归位'):text('Move target','移动目标');
  printLink.setAttribute('href',text('../lab/BridgeLab-Board.pdf','../lab/BridgeLab-Board-zh.pdf'));
}
document.addEventListener('bridgelab:preferences',renderControls);
renderControls();
button.addEventListener('click',()=>{
  shifted=!shifted;
  button.setAttribute('aria-pressed',String(shifted));renderControls();
  cancelAnimationFrame(animation);
  const at=performance.now(),start=position,end=shifted?65:0;
  function step(t){const f=Math.min(1,(t-at)/1000);position=start+(end-start)*f;draw(Math.round(position));if(f<1)animation=requestAnimationFrame(step)}
  animation=requestAnimationFrame(step);
});
draw(0);
