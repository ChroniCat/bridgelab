import {attachPicker} from './setup.js';
import {readGeometry} from './model-overlay.js';
import {createBaseline} from './tracker.js';
import {newId,saveSite} from './storage.js';

const el=id=>document.getElementById(id);
const text=(en,zh)=>window.BridgePrefs.text(en,zh);
export function workingSize(width,height){
  const ratio=Math.min(1,480/Math.max(width,height));
  return [Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio))];
}
export function referenceFrame(canvas){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  return {image:canvas.toDataURL('image/jpeg',.91),frame:ctx.getImageData(0,0,canvas.width,canvas.height)};
}
const errors={
  spacing:['Use separate landmarks, at least 22 processing pixels apart.','请改选间距较大的标志（处理画面中至少相隔 22 像素）。'],
  geometry:['Place four corners around both the check and the target.','四个角点应包围检查点和目标点。'],
  repetitive:['Some features look alike. Choose a distinctive detail or a different view.','部分纹理太相似，请换一处独特细节或换个视角。'],
  texture:['Choose sharper landmarks with more visible texture.','请改选边缘清晰、有纹理的标志。'],
  points:['Select all six points away from the image edges.','请在画面边缘以内选满六个点。']
};
const cornerNames=[['upper left','左上角'],['upper right','右上角'],['lower right','右下角'],['lower left','左下角'],['independent stable check','独立且稳定的检查点'],['monitoring target','监测目标']];
export function manageBaselines({getSite,onSite,cameraFrame,openPreview,models,notify}){
  let frozen=null,busy=false;
  const mode=()=>el('picker-mode').value;
  const picker=attachPicker(el('picker'),(_,reason)=>{if(frozen)renderForm();if(reason&&errors[reason])notify(...errors[reason])});
  function cancel(){
    frozen=null;picker.clear();el('baseline-form').hidden=true;el('photo').value='';
  }
  function renderForm(){
    if(!frozen)return;
    const n=picker.points.length;el('scale').hidden=mode()!=='metric';el('model-binding').hidden=mode()!=='model';
    el('neighbor-row').hidden=mode()==='auto'||!getSite().sections.length;
    el('save-section').disabled=n!==6||busy;
    el('pick-prompt').textContent=mode()==='auto'
      ? n===6?text('Check the four fixed features and the independent check share the target plane.','核对四个固定标志与独立检查点是否稳定，并与目标共面。'):text('Tap the feature you want to monitor.','点一下你想监测的特征。')
      : n===6?text('Check all six roles before saving.','请核对六个点的角色后保存。'):(mode()==='metric'?text('Use a measured, flat rectangle. ','选择实测矩形，六点须共面。'):text('Choose stable points on the target plane. ','选择与目标共面的稳定特征。'))+text('Select ','请点选')+text(...cornerNames[n])+'.';
    if(mode()==='model'&&n<4){
      el('pick-prompt').textContent=text('Tap the physical joint at ','请点选实物')+text(...cornerNames[n])+text(' corresponding to model node ','对应的模型节点 ')+(models.cornerIds()[n]||'')+text('.','。');
    }
  }
  el('model-panel').onchange=el('model-reverse').onchange=()=>{if(frozen){picker.clear();renderForm()}};
  el('field-model-file').onchange=async e=>{
    const file=e.target.files[0],site=getSite();if(!file)return;
    try{
      if(file.size>5e6)throw Error('size');
      const data=JSON.parse(await file.text());data.assetKey=newId();readGeometry(data);
      const next=await saveSite({...site,geometry:data});
      cancel();await onSite(next);notify('3D model saved to this project on this device.','三维模型已保存到此设备的当前项目。');
    }catch(err){
      if(err.code==='site-changed')notify('This project changed in another tab. Reload before importing.','另一标签页已修改此项目，请刷新后重新导入。');
      else notify('Import a BridgeLab node/member JSON under 5 MB. See the repository README for the panel format.','请导入 5 MB 以内的 BridgeLab 节点和构件 JSON；片区格式见仓库 README。');
    }finally{e.target.value=''}
  };
  function list(){
    const site=getSite();el('neighbor').replaceChildren(new Option(text('No shared edge','不共用边'),''));
    const sel=document.createElement('span');
    sel.textContent=site.sections.length?text('Saved sections: ','已建档桥段：')+site.sections.map(s=>s.name).join(' · '):text('No field references yet.','暂无现场基准。');
    el('sections-list').replaceChildren(sel);
    for(const s of site.sections)el('neighbor').add(new Option(s.name,s.id));
  }
  function edit(f){
    if(!f)return;
    frozen=f;el('setup').open=true;el('baseline-form').hidden=false;el('section-input').value='';
    el('picker-mode').value='auto';el('model-reverse').checked=false;el('width-mm').value=el('height-mm').value='';
    el('limit-mm').value='5';el('neighbor').value='';
    picker.setMode('auto');picker.setFrame(f.frame);renderForm();
  }
  el('picker-mode').onchange=()=>{picker.clear();picker.setMode(mode()==='auto'?'auto':'manual');renderForm()};
  el('undo').onclick=()=>{picker.undo();renderForm()};
  el('cancel').onclick=cancel;
  el('photo').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    const siteId=getSite().id,objectUrl=URL.createObjectURL(file);
    try {
      const image=new Image();image.src=objectUrl;await image.decode();
      if(siteId!==getSite().id)return;
      const canvas=document.createElement('canvas');[canvas.width,canvas.height]=workingSize(image.naturalWidth,image.naturalHeight);
      canvas.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,canvas.width,canvas.height);
      edit(referenceFrame(canvas));notify('','');
    }catch{notify('This photo could not be read. Try JPEG or PNG.','无法读取这张照片，请尝试 JPG 或 PNG。')}
    finally{URL.revokeObjectURL(objectUrl);e.target.value=''}
  };
  el('freeze').onclick=async()=>{const f=cameraFrame();if(f){edit(f);notify('','')}else await openPreview()};
  el('save-section').onclick=async()=>{
    if(!frozen||busy)return;const site=getSite(),name=el('section-input').value.trim();
    if(!name||site.sections.some(s=>s.name.toLowerCase()===name.toLowerCase())){notify('Enter a unique member or section ID.','请输入尚未使用的构件或桥段编号。');el('section-input').focus();return}
    const calibration=mode()==='metric'?{widthMm:Number(el('width-mm').value),heightMm:Number(el('height-mm').value),limitMm:Number(el('limit-mm').value)}:null;
    if(calibration&&!Object.values(calibration).every(v=>v>0&&Number.isFinite(v))){notify('Enter measured dimensions and a positive review threshold.','请填写实测宽高和大于零的复查阈值。');return}
    const neighbor=mode()==='auto'?'':el('neighbor').value;
    const overlap=neighbor?{sectionId:neighbor,pairs:[['C1','C2'],['C4','C3']]}:null;
    busy=true;renderForm();
    try{
      const made=createBaseline({...frozen,id:newId(),name,points:picker.points,bridgeId:site.id,revision:site.revision+1,calibration,overlap});
      if(!made.ok){notify(...(errors[made.reason]||errors.points));return}
      if(mode()==='model'){
        const binding=models.binding();if(!binding){notify('Choose a model panel.','请选择模型片区。');return}
        made.baseline.modelBinding=binding;
      }
      const next=await saveSite({...site,sections:[...site.sections,made.baseline]});
      cancel();await onSite(next);notify('Reference saved. Start a walk when ready.','基准已保存，可以开始走查。');
    }catch(e){notify(...(e.code==='site-changed'?['This project changed in another tab. Reload before saving.','项目已在另一标签页更新，请刷新后保存。']:['Could not save the reference on this device.','此设备未能保存基准。']))}
    finally{busy=false;renderForm()}
  };
  el('new-site').onclick=()=>{el('site-form').hidden=false;el('site-name').focus()};
  el('site-form').onsubmit=async e=>{
    e.preventDefault();const name=el('site-name').value.trim();if(!name)return;
    try{const next=await saveSite({id:newId(),name,sections:[]});cancel();await onSite(next);el('site-form').hidden=true;el('site-name').value='';notify('Project created. Add a section reference.','项目已创建，请添加桥段基准。')}
    catch{notify('Could not save this project.','未能保存项目。')}
  };
  return {list,cancel,renderForm,get editing(){return !!frozen}};
}
