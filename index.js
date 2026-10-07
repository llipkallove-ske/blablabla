/**
 * Wardrobe Reference Manager for SillyTavern
 *
 * Independent wardrobe-only implementation matching the wardrobe workflow:
 * bottom-bar wardrobe button, bot/user wardrobes, personal/shared modes,
 * outfit types, sorting, pagination, upload/edit/duplicate/delete, active outfit
 * prompt injection, visual references, import/export, and generated-image gallery.
 *
 * Image generation itself is intentionally not included.
 */

const EXT = 'wardrobe_reference_manager';
const STYLE_ID = 'wrm_style';
const OVERLAY_ID = 'wrm_overlay';
const GALLERY_ID = 'wrm_gallery';
const PROMPT_KEY = 'WRM_ACTIVE_OUTFITS';
const PAGE_SIZE = 11;
const MAX_REF_IMAGES = 8;

const DEFAULT_TYPES = [
  { id:'casual', label:'Повседневное', icon:'fa-shirt' },
  { id:'formal', label:'Формальное', icon:'fa-gem' },
  { id:'sport', label:'Спортивное', icon:'fa-person-running' },
  { id:'sleep', label:'Спальное', icon:'fa-bed' },
  { id:'beach', label:'Пляж/купальник', icon:'fa-umbrella-beach' },
  { id:'work', label:'Работа', icon:'fa-briefcase' },
  { id:'outer', label:'Верхняя', icon:'fa-mitten' },
  { id:'other', label:'Другое', icon:'fa-tag' },
];

const DEFAULTS = {
  enabled:true,
  injectDescription:true,
  injectImages:true,
  maxImagesPerRequest:MAX_REF_IMAGES,
  maxDimension:768,
  wardrobeButtonPlacement:'bar',
  wardrobes:{},
  activeOutfits:{},
  sharedBotWardrobe:[],
  sharedUserWardrobe:[],
  sharedBotActive:null,
  sharedUserActive:null,
  useSharedBotWardrobe:false,
  useSharedUserWardrobe:false,
  personaWardrobes:{},
  personaActiveOutfits:{},
  outfitTypes:structuredClone(DEFAULT_TYPES),
};

let viewSide = 'bot';
let filter = 'all';
let sort = 'added';
let page = 0;

function ctx(){ return SillyTavern.getContext(); }
function save(){ ctx().saveSettingsDebounced(); }
function esc(v){ const d=document.createElement('div'); d.textContent=String(v??''); return d.innerHTML; }
function uid(){ return Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9); }
function settings(){
  const c=ctx();
  if(!c.extensionSettings[EXT]) c.extensionSettings[EXT]=structuredClone(DEFAULTS);
  const s=c.extensionSettings[EXT];
  for(const [k,v] of Object.entries(DEFAULTS)) if(!(k in s)) s[k]=structuredClone(v);
  if(!s.outfitTypes?.length) s.outfitTypes=structuredClone(DEFAULT_TYPES);
  if(!s.wardrobes||typeof s.wardrobes!=='object') s.wardrobes={};
  if(!s.activeOutfits||typeof s.activeOutfits!=='object') s.activeOutfits={};
  if(!s.personaWardrobes||typeof s.personaWardrobes!=='object') s.personaWardrobes={};
  if(!s.personaActiveOutfits||typeof s.personaActiveOutfits!=='object') s.personaActiveOutfits={};
  for(const k of ['sharedBotWardrobe','sharedUserWardrobe']) if(!Array.isArray(s[k])) s[k]=[];
  return s;
}
function charName(){ const c=ctx(); return c.characters?.[c.characterId]?.name || 'Персонаж'; }
function charKey(){ const c=ctx(); return String(c.characters?.[c.characterId]?.avatar || c.characterId || charName()); }
function personaId(){ const c=ctx(); return String(c.chatMetadata?.persona || '').trim() || String(c.name1 || 'User'); }
function personaName(){ const c=ctx(); const id=String(c.chatMetadata?.persona||'').trim(); return c.powerUserSettings?.personas?.[id] || c.name1 || 'Юзер'; }
function typeMeta(id){ const s=settings(); return s.outfitTypes.find(x=>x.id===id)||s.outfitTypes.find(x=>x.id==='other')||s.outfitTypes[0]; }
function sanitizeDesc(v){ return String(v||'').replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi,'').replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi,'').replace(/\s+/g,' ').trim(); }

function getList(side=viewSide){
  const s=settings();
  if(side==='bot'){
    if(s.useSharedBotWardrobe) return s.sharedBotWardrobe;
    const k=charKey(); if(!Array.isArray(s.wardrobes[k])) s.wardrobes[k]={bot:[],user:[]};
    if(!Array.isArray(s.wardrobes[k].bot)) s.wardrobes[k].bot=[];
    return s.wardrobes[k].bot;
  }
  if(s.useSharedUserWardrobe) return s.sharedUserWardrobe;
  const k=personaId(); if(!Array.isArray(s.personaWardrobes[k])) s.personaWardrobes[k]=[];
  return s.personaWardrobes[k];
}
function getActive(side=viewSide){
  const s=settings();
  if(side==='bot') return s.useSharedBotWardrobe ? s.sharedBotActive : (s.activeOutfits[charKey()]?.bot||null);
  return s.useSharedUserWardrobe ? s.sharedUserActive : (s.personaActiveOutfits[personaId()]||null);
}
function setActive(side,id){
  const s=settings();
  if(side==='bot'){
    if(s.useSharedBotWardrobe) s.sharedBotActive=id||null;
    else { if(!s.activeOutfits[charKey()]) s.activeOutfits[charKey()]={bot:null,user:null}; s.activeOutfits[charKey()].bot=id||null; }
  } else {
    if(s.useSharedUserWardrobe) s.sharedUserActive=id||null;
    else s.personaActiveOutfits[personaId()]=id||null;
  }
  save(); updateInjection(); updateBar();
}
function makeOutfit(x={}){ return { id:uid(), name:'Новый наряд', description:'', type:'casual', tags:[], imagePath:'', references:[], enabled:true, addedAt:Date.now(), lastWorn:0, ...x }; }
function refShape(r){ return { id:r?.id||uid(), label:String(r?.label||'Референс'), description:String(r?.description||''), src:String(r?.src||r?.imageUrl||''), enabled:r?.enabled!==false, order:Number(r?.order||0) }; }
function imageSrc(o){ return o?.imagePath || o?.src || (o?.base64 ? `data:image/png;base64,${o.base64}` : ''); }

function filtered(){
  const q=(document.querySelector('#wrm-search')?.value||'').trim().toLowerCase();
  let a=getList().filter(o=>filter==='all'||o.type===filter).filter(o=>!q||`${o.name} ${o.description} ${(o.tags||[]).join(' ')}`.toLowerCase().includes(q));
  if(sort==='name') a.sort((x,y)=>(x.name||'').localeCompare(y.name||'',undefined,{numeric:true,sensitivity:'base'}));
  else if(sort==='worn') a.sort((x,y)=>(y.lastWorn||0)-(x.lastWorn||0)||(y.addedAt||0)-(x.addedAt||0));
  else a.sort((x,y)=>(y.addedAt||0)-(x.addedAt||0));
  const aid=getActive(); if(aid){ const i=a.findIndex(x=>x.id===aid); if(i>0) a.unshift(a.splice(i,1)[0]); }
  return a;
}

function openWardrobe(){
  if(document.getElementById(OVERLAY_ID)){ closeWardrobe(); return; }
  const ov=document.createElement('div'); ov.id=OVERLAY_ID; ov.className='wrm-overlay';
  ov.innerHTML=`<section class="wrm-window" role="dialog" aria-label="Гардероб">
    <header class="wrm-header"><div><h2><i class="fa-solid fa-shirt"></i> Гардероб</h2><div class="wrm-subtitle">${esc(charName())} · визуальные референсы</div></div><div class="wrm-header-actions"><button class="menu_button" data-a="quick" title="Быстрые настройки"><i class="fa-solid fa-sliders"></i></button><button class="menu_button" data-a="maintenance" title="Управление гардеробом"><i class="fa-solid fa-toolbox"></i></button><button class="menu_button" data-a="gallery"><i class="fa-solid fa-images"></i></button><button class="menu_button" data-a="close"><i class="fa-solid fa-xmark"></i></button></div></header>
    <div class="wrm-tabs"><button data-side="bot" class="active"><i class="fa-solid fa-robot"></i> Бот</button><button data-side="user"><i class="fa-solid fa-user"></i> Юзер</button></div>
    <div id="wrm-active-info" class="wrm-active-info"></div>
    <main id="wrm-main"></main>
  </section>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',panelClick);
  render();
  document.addEventListener('keydown',escClose);
}
function closeWardrobe(){ document.getElementById(OVERLAY_ID)?.remove(); document.removeEventListener('keydown',escClose); }
function escClose(e){ if(e.key==='Escape') closeWardrobe(); }
function panelClick(e){
  const b=e.target.closest('button,[data-id],[data-filter],[data-sort],[data-action]'); if(!b)return;
  if(e.target===e.currentTarget){ closeWardrobe(); return; }
  if(b.dataset.side){ viewSide=b.dataset.side; filter='all'; page=0; document.querySelectorAll('#wrm-overlay .wrm-tabs button').forEach(x=>x.classList.toggle('active',x.dataset.side===viewSide)); render(); return; }
  const a=b.dataset.a||b.dataset.action;
  if(a==='close'){closeWardrobe();return} if(a==='new'){openEditor(null);return} if(a==='gallery'){openGallery();return} if(a==='quick'){openQuick();return} if(a==='maintenance'){openMaintenance();return}
  if(a==='export'){exportWardrobe();return} if(a==='import'){importWardrobe();return}
  if(a==='prev'){if(page>0){page--;render()}return} if(a==='next'){page++;render();return}
  if(a==='activate'){toggleActive(b.dataset.id);return} if(a==='edit'){openEditor(b.dataset.id);return} if(a==='delete'){deleteOutfit(b.dataset.id);return} if(a==='duplicate'){duplicateOutfit(b.dataset.id);return}
  if(b.dataset.filter){filter=b.dataset.filter;page=0;render();return} if(b.dataset.sort){sort=b.dataset.sort;page=0;render();return}
  if(a==='upload'){uploadNew();return}
}
function render(){
  const main=document.querySelector('#wrm-main'); if(!main)return;
  const s=settings(), list=getList(), aid=getActive();
  const counts={}; for(const o of list) counts[o.type]=(counts[o.type]||0)+1;
  const useShared=viewSide==='bot'?s.useSharedBotWardrobe:s.useSharedUserWardrobe;
  const title=viewSide==='bot'?'Гардероб текущего персонажа':'Гардероб персоны во всех чатах';
  const arr=filtered(), total=Math.max(1,Math.ceil(arr.length/PAGE_SIZE)); if(page>=total)page=total-1;
  const items=arr.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const filters=[`<button class="wrm-chip ${filter==='all'?'active':''}" data-filter="all">Все <span>${list.length}</span></button>`];
  for(const t of s.outfitTypes) if(counts[t.id]) filters.push(`<button class="wrm-chip ${filter===t.id?'active':''}" data-filter="${esc(t.id)}"><i class="fa-solid ${esc(t.icon)}"></i> ${esc(t.label)} <span>${counts[t.id]}</span></button>`);
  const active=list.find(x=>x.id===aid);
  document.querySelector('#wrm-active-info').innerHTML=active?`<i class="fa-solid fa-check"></i> Активно: <b>${esc(active.name)}</b>${active.description?` — ${esc(sanitizeDesc(active.description).slice(0,120))}`:''}`:'Ничего не надето';
  main.innerHTML=`<div class="wrm-mode-row"><button class="wrm-mode ${!useShared?'active':''}" data-action="mode-personal"><i class="fa-solid fa-user"></i> ${viewSide==='bot'?'Персонаж':'Персона'}</button><button class="wrm-mode ${useShared?'active':''}" data-action="mode-shared"><i class="fa-solid fa-earth-europe"></i> Общий</button><span class="wrm-mode-title">${esc(title)}</span><select id="wrm-sort" class="text_pole"><option value="added" ${sort==='added'?'selected':''}>Недавно добавленные</option><option value="worn" ${sort==='worn'?'selected':''}>Недавно надетые</option><option value="name" ${sort==='name'?'selected':''}>По имени</option></select></div>
  <div class="wrm-toolbar"><button class="menu_button" data-a="new"><i class="fa-solid fa-plus"></i> Новый образ</button><button class="menu_button" data-a="upload"><i class="fa-solid fa-upload"></i> Загрузить</button><button class="menu_button" data-a="export"><i class="fa-solid fa-file-export"></i></button><button class="menu_button" data-a="import"><i class="fa-solid fa-file-import"></i></button><input id="wrm-search" class="text_pole" placeholder="Поиск…"></div>
  <div class="wrm-filters">${filters.join('')}</div>
  <div class="wrm-grid"><div class="wrm-card wrm-add-card" data-a="upload"><div><i class="fa-solid fa-plus"></i></div><span>Загрузить</span></div>${items.map(o=>card(o,aid)).join('')}</div>
  ${total>1?`<div class="wrm-pager"><button class="menu_button" data-a="prev" ${page===0?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button><span>Стр. ${page+1} / ${total} <small>(${arr.length})</small></span><button class="menu_button" data-a="next" ${page>=total-1?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button></div>`:''}
  <div class="wrm-footer"><label><input id="wrm-enabled" type="checkbox" ${s.enabled?'checked':''}> Гардероб активен</label><label><input id="wrm-inject-images" type="checkbox" ${s.injectImages?'checked':''}> Отправлять визуальные референсы</label></div>`;
  bindTypeSelect();
  main.querySelector('#wrm-sort').addEventListener('change',e=>{sort=e.target.value;page=0;render()});
  main.querySelector('#wrm-search').addEventListener('input',()=>{page=0;render()});
  main.querySelector('#wrm-enabled').addEventListener('change',e=>{s.enabled=e.target.checked;save();updateInjection()});
  main.querySelector('#wrm-inject-images').addEventListener('change',e=>{s.injectImages=e.target.checked;save()});
  main.querySelector('[data-action="mode-personal"]').addEventListener('click',()=>setMode(false));
  main.querySelector('[data-action="mode-shared"]').addEventListener('click',()=>setMode(true));
}
function card(o,aid){
  const tm=typeMeta(o.type), active=o.id===aid, src=imageSrc(o);
  const thumb=src?`<img src="${esc(src)}" loading="lazy" alt="${esc(o.name)}">`:'<i class="fa-solid fa-shirt"></i>';
  return `<article class="wrm-card ${active?'is-active':''}" data-id="${esc(o.id)}"><div class="wrm-card-image" data-action="activate">${thumb}${active?'<span class="wrm-active-badge"><i class="fa-solid fa-check"></i></span>':''}<span class="wrm-type-badge"><i class="fa-solid ${esc(tm.icon)}"></i></span></div><div class="wrm-card-info"><div class="wrm-card-title">${esc(o.name)}</div><div class="wrm-card-type">${esc(tm.label)}</div><p>${esc(sanitizeDesc(o.description))}</p><div class="wrm-card-tags">${(o.tags||[]).map(t=>`<span>${esc(t)}</span>`).join('')}</div></div><div class="wrm-card-actions"><button data-action="activate" data-id="${esc(o.id)}" title="${active?'Снять':'Надеть'}"><i class="fa-solid ${active?'fa-toggle-on':'fa-toggle-off'}"></i></button><button data-action="duplicate" data-id="${esc(o.id)}"><i class="fa-solid fa-copy"></i></button><button data-action="edit" data-id="${esc(o.id)}"><i class="fa-solid fa-pen"></i></button><button data-action="delete" data-id="${esc(o.id)}"><i class="fa-solid fa-trash-can"></i></button></div><select class="wrm-type-select" data-type-id="${esc(o.id)}">${settings().outfitTypes.map(t=>`<option value="${esc(t.id)}" ${t.id===o.type?'selected':''}>${esc(t.label)}</option>`).join('')}</select></article>`;
}
function bindTypeSelect(){ document.querySelectorAll('.wrm-type-select').forEach(sel=>sel.addEventListener('change',()=>{const o=getList().find(x=>x.id===sel.dataset.typeId);if(o){o.type=sel.value;save();render()}})); }
function toggleActive(id){ const list=getList(), o=list.find(x=>x.id===id); if(!o)return; const now=getActive()===id; setActive(viewSide,now?null:id); if(!now)o.lastWorn=Date.now(); render(); toastr.info(now?`«${o.name}» снят`:`«${o.name}» надет`,'Гардероб',{timeOut:1600}); }
function setMode(shared){ const s=settings(); if(viewSide==='bot')s.useSharedBotWardrobe=shared;else s.useSharedUserWardrobe=shared;save();page=0;render();updateInjection();updateBar(); }

async function resizeImage(file,max=768){
  const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=rej;r.readAsDataURL(file)});
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=data});
  const scale=Math.min(1,max/Math.max(img.width,img.height)); const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h); return canvas.toDataURL('image/jpeg',.88);
}
async function uploadDataUrl(dataUrl,name){
  const c=ctx(), comma=dataUrl.indexOf(','); const mime=dataUrl.slice(5,comma).split(';')[0]||'image/jpeg'; const ext=mime.includes('png')?'png':mime.includes('webp')?'webp':'jpg';
  const r=await fetch('/api/images/upload',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({image:dataUrl.slice(comma+1),format:ext,ch_name:charName(),filename:`wardrobe_${Date.now()}_${String(name||'reference').replace(/[^a-z0-9._-]/gi,'_')}`})});
  if(!r.ok)throw new Error(await r.text()||`HTTP ${r.status}`); const j=await r.json(); if(!j.path)throw new Error('Сервер не вернул путь к изображению'); return j.path;
}
function uploadNew(){ const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{const data=await resizeImage(f,settings().maxDimension);const path=await uploadDataUrl(data,f.name);openEditor(null,makeOutfit({name:f.name.replace(/\.[^.]+$/,''),imagePath:path}));}catch(e){toastr.error(e.message,'Гардероб')}};input.click(); }

function openEditor(id,preset=null){
  const existing=id?getList().find(x=>x.id===id):null; const item=structuredClone(existing||preset||makeOutfit());
  item.references=(item.references||[]).map(refShape);
  const ov=document.createElement('div');ov.className='wrm-overlay';ov.id='wrm_editor';
  ov.innerHTML=`<section class="wrm-editor"><header><h3>${existing?'Редактировать образ':'Новый образ'}</h3><button class="menu_button" data-e="close"><i class="fa-solid fa-xmark"></i></button></header><div class="wrm-editor-scroll"><label>Название<input id="e-name" class="text_pole" value="${esc(item.name)}"></label><label>Тип<select id="e-type" class="text_pole">${settings().outfitTypes.map(t=>`<option value="${esc(t.id)}" ${t.id===item.type?'selected':''}>${esc(t.label)}</option>`).join('')}</select></label><label>Описание<textarea id="e-desc" class="text_pole" rows="5">${esc(item.description)}</textarea></label><label>Теги<input id="e-tags" class="text_pole" value="${esc((item.tags||[]).join(', '))}" placeholder="вечер, чёрный, платье"></label><div class="wrm-ref-head"><h4>Визуальные референсы</h4><button class="menu_button" data-e="addref"><i class="fa-solid fa-plus"></i> Добавить</button></div><div id="e-refs" class="wrm-refs"></div></div><footer><button class="menu_button" data-e="close">Отмена</button><button class="menu_button interactable" data-e="save"><i class="fa-solid fa-check"></i> Сохранить</button></footer></section>`;
  document.body.appendChild(ov);
  const refs=ov.querySelector('#e-refs');
  const drawRefs=()=>{refs.innerHTML=item.references.length?item.references.map((r,i)=>`<div class="wrm-ref" data-ri="${i}"><div class="wrm-ref-preview">${r.src?`<img src="${esc(r.src)}">`:'<i class="fa-solid fa-image"></i>'}</div><div class="wrm-ref-fields"><input class="text_pole r-label" value="${esc(r.label)}" placeholder="Название референса"><textarea class="text_pole r-desc" rows="3" placeholder="Что именно нужно сохранить с этой картинки">${esc(r.description)}</textarea><input class="text_pole r-src" value="${esc(r.src)}" placeholder="URL картинки или локальный путь"><label><input class="r-enabled" type="checkbox" ${r.enabled!==false?'checked':''}> Отправлять этот референс</label><div class="wrm-ref-buttons"><button class="menu_button" data-r="file"><i class="fa-solid fa-upload"></i> Файл</button><button class="menu_button" data-r="remove"><i class="fa-solid fa-trash"></i></button></div></div></div>`).join(''):'<div class="wrm-ref-empty">Добавь картинку наряда — модель сможет использовать её как визуальный референс.</div>'};
  drawRefs();
  ov.addEventListener('click',async e=>{
    const b=e.target.closest('[data-e],[data-r]'); if(!b)return; const a=b.dataset.e;
    if(a==='close'){ov.remove();return} if(a==='addref'){item.references.push(refShape({label:`Референс ${item.references.length+1}`}));drawRefs();return}
    if(a==='save'){item.name=ov.querySelector('#e-name').value.trim()||'Новый образ';item.type=ov.querySelector('#e-type').value;item.description=ov.querySelector('#e-desc').value;item.tags=ov.querySelector('#e-tags').value.split(',').map(x=>x.trim()).filter(Boolean);item.references=[...refs.querySelectorAll('.wrm-ref')].map((el,i)=>refShape({id:item.references[i]?.id,label:el.querySelector('.r-label').value,description:el.querySelector('.r-desc').value,src:el.querySelector('.r-src').value,enabled:el.querySelector('.r-enabled').checked,order:i}));const list=getList();if(existing){const ix=list.findIndex(x=>x.id===existing.id);list[ix]=item;}else{item.id=uid();item.addedAt=Date.now();list.push(item);}save();ov.remove();render();updateInjection();updateBar();toastr.success(existing?'Обновлено':'Добавлено','Гардероб');return}
    if(b.dataset.r==='remove'){const el=b.closest('.wrm-ref');item.references.splice(Number(el.dataset.ri),1);drawRefs();return}
    if(b.dataset.r==='file'){const el=b.closest('.wrm-ref'),idx=Number(el.dataset.ri),input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{const data=await resizeImage(f,settings().maxDimension);item.references[idx].src=await uploadDataUrl(data,f.name);drawRefs()}catch(err){toastr.error(err.message,'Референс')}};input.click();}
  });
}
function deleteOutfit(id){const list=getList(),i=list.findIndex(x=>x.id===id);if(i<0)return;const o=list[i];if(!confirm(`Удалить «${o.name}»?`))return;list.splice(i,1);if(getActive()===id)setActive(viewSide,null);save();render();updateBar();}
function duplicateOutfit(id){const o=getList().find(x=>x.id===id);if(!o)return;const n=structuredClone(o);n.id=uid();n.name=`${o.name} — копия`;n.addedAt=Date.now();getList().push(n);save();render();}
function exportWardrobe(){const p={kind:'sillytavern-wardrobe',version:2,side:viewSide,name:viewSide==='bot'?charName():personaName(),outfits:structuredClone(getList())};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}));a.download='wardrobe.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function importWardrobe(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{const p=JSON.parse(await f.text());if(!Array.isArray(p.outfits))throw new Error('В файле нет outfits');for(const x of p.outfits){const o=makeOutfit(x);o.id=uid();o.references=(x.references||[]).map(refShape);getList().push(o)}save();render();toastr.success(`Импортировано: ${p.outfits.length}`,'Гардероб')}catch(e){toastr.error(e.message,'Импорт')}};input.click()}

function openQuick(){
  const s=settings(), ov=document.createElement('div');ov.className='wrm-overlay';ov.innerHTML=`<section class="wrm-small"><header><h3>Быстрые настройки гардероба</h3><button class="menu_button" data-q="close"><i class="fa-solid fa-xmark"></i></button></header><div class="wrm-editor-scroll"><label><input id="q-enabled" type="checkbox" ${s.enabled?'checked':''}> Использовать гардероб</label><label><input id="q-desc" type="checkbox" ${s.injectDescription?'checked':''}> Отправлять описания активных нарядов</label><label><input id="q-img" type="checkbox" ${s.injectImages?'checked':''}> Отправлять картинки-референсы</label><label>Максимум изображений за запрос<input id="q-max" class="text_pole" type="number" min="1" max="8" value="${Number(s.maxImagesPerRequest)||4}"></label><label>Максимальный размер загружаемых изображений<select id="q-size" class="text_pole"><option value="512">512 px</option><option value="768">768 px</option><option value="1024">1024 px</option></select></label></div><footer><button class="menu_button" data-q="close">Закрыть</button></footer></section>`;document.body.appendChild(ov);ov.querySelector('#q-size').value=String(s.maxDimension);ov.addEventListener('change',()=>{s.enabled=ov.querySelector('#q-enabled').checked;s.injectDescription=ov.querySelector('#q-desc').checked;s.injectImages=ov.querySelector('#q-img').checked;s.maxImagesPerRequest=Math.min(8,Math.max(1,Number(ov.querySelector('#q-max').value)||4));s.maxDimension=Number(ov.querySelector('#q-size').value)||768;save();updateInjection();updateBar()});ov.addEventListener('click',e=>{if(e.target.closest('[data-q="close"]')||e.target===ov)ov.remove()});}
function openMaintenance(){
  const ov=document.createElement('div');ov.className='wrm-overlay';ov.innerHTML=`<section class="wrm-small"><header><h3>Управление гардеробом</h3><button class="menu_button" data-m="close"><i class="fa-solid fa-xmark"></i></button></header><div class="wrm-editor-scroll"><p>Дубликаты и распределение гардеробов.</p><button class="menu_button" data-m="dedup">Удалить дубликаты текущего списка</button><button class="menu_button" data-m="clear">Очистить текущий гардероб</button></div><footer><button class="menu_button" data-m="close">Закрыть</button></footer></section>`;document.body.appendChild(ov);ov.addEventListener('click',e=>{const a=e.target.closest('[data-m]')?.dataset.m;if(!a)return;if(a==='close'){ov.remove();return}const list=getList();if(a==='clear'&&confirm('Очистить весь текущий гардероб?')){list.splice(0);setActive(viewSide,null);save();ov.remove();render();updateBar()}if(a==='dedup'){const seen=new Set(),dups=[];for(const o of list){const key=`${o.name}|${o.description}|${imageSrc(o)}`;if(seen.has(key))dups.push(o.id);else seen.add(key)}for(const id of dups){const i=list.findIndex(x=>x.id===id);if(i>=0)list.splice(i,1)}save();toastr.success(`Удалено дубликатов: ${dups.length}`,'Гардероб');ov.remove();render()}})}

function buildPrompt(outfit,side){const lines=[`[WARDROBE REFERENCE — ${side==='bot'?'CHARACTER':'USER'}]`,`Current outfit: ${outfit.name}`];if(outfit.description)lines.push(`Outfit description: ${sanitizeDesc(outfit.description)}`);if(outfit.tags?.length)lines.push(`Tags: ${outfit.tags.join(', ')}`);const refs=(outfit.references||[]).filter(r=>r.enabled!==false&&r.src);if(refs.length)lines.push('Visual references are attached. Preserve the referenced outfit, garments, colors, materials and silhouette unless the story explicitly changes clothes.');return {text:lines.join('\n'),refs};}
function activeOutfit(side){const list=getListForSide(side);const id=getActiveForSide(side);return list.find(x=>x.id===id)||null;}
function getListForSide(side){const old=viewSide;viewSide=side;const list=getList(side);viewSide=old;return list;}
function getActiveForSide(side){const old=viewSide;viewSide=side;const id=getActive(side);viewSide=old;return id;}
async function toDataUrl(src){if(!src)return null;if(src.startsWith('data:image/'))return src;try{const r=await fetch(src,{credentials:'same-origin'});if(!r.ok)return null;const b=await r.blob();return await new Promise((res,rej)=>{const f=new FileReader();f.onload=()=>res(String(f.result));f.onerror=rej;f.readAsDataURL(b)})}catch{return null}}
async function injectImages(eventData){const s=settings();if(!s.enabled||!s.injectImages||!eventData?.chat?.length)return;const blocks=[];for(const side of ['bot','user']){const o=activeOutfit(side);if(!o)continue;const built=buildPrompt(o,side);const refs=built.refs.slice(0,Math.max(1,Number(s.maxImagesPerRequest)||4));for(const r of refs){const u=await toDataUrl(r.src);if(u)blocks.push({type:'text',text:`Reference: ${r.label}${r.description?`\n${r.description}`:''}`},{type:'image_url',image_url:{url:u}})}}if(!blocks.length)return;const target=eventData.chat.find(x=>x?.role==='system')||eventData.chat.find(x=>x?.role==='user');if(!target)return;const textParts=[];for(const side of ['bot','user']){const o=activeOutfit(side);if(o&&s.injectDescription)textParts.push(buildPrompt(o,side).text)}if(Array.isArray(target.content))target.content.push({type:'text',text:textParts.join('\n\n')},...blocks);else target.content=[{type:'text',text:String(target.content||'')},...(textParts.length?[{type:'text',text:textParts.join('\n\n')}]:[]),...blocks]}
function updateInjection(){const s=settings(),api=ctx().setExtensionPrompt;if(!api)return;const parts=[];for(const side of ['bot','user']){const o=activeOutfit(side);if(o&&s.enabled&&s.injectDescription)parts.push(buildPrompt(o,side).text)}api(PROMPT_KEY,parts.join('\n\n'),0,0,false)}

async function chatImages(){const out=[];document.querySelectorAll('#chat .mes img').forEach((img,i)=>{if(!img.src||img.src.startsWith('data:')||img.classList.contains('avatar'))return;out.push({src:img.src,filename:img.src.split('/').pop()||`image_${i}.png`})});return out}
async function characterImages(){const c=ctx();let folder=charName();try{const r=await fetch('/api/files/sanitize-filename',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({fileName:folder})});if(r.ok)folder=(await r.json()).fileName||folder}catch{}const r=await fetch('/api/images/list',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({folder,sortField:'date',sortOrder:'desc'})});if(!r.ok)throw new Error(`HTTP ${r.status}`);const files=await r.json();return(Array.isArray(files)?files:[]).filter(x=>typeof x==='string').map(f=>({src:`/user/images/${encodeURIComponent(folder)}/${encodeURIComponent(f)}`,filename:f}))}
async function openGallery(){if(document.getElementById(GALLERY_ID))return;const m=document.createElement('div');m.id=GALLERY_ID;m.className='wrm-overlay';m.innerHTML=`<section class="wrm-gallery"><header><h3><i class="fa-solid fa-images"></i> Галерея изображений</h3><div><button class="menu_button" data-g="chat">Текущий чат</button><button class="menu_button" data-g="character">Персонаж</button><button class="menu_button" data-g="close"><i class="fa-solid fa-xmark"></i></button></div></header><main id="wrm-gallery-body"></main></section>`;document.body.appendChild(m);let scope='chat';const draw=async()=>{const body=m.querySelector('#wrm-gallery-body');body.innerHTML='<div class="wrm-loading">Загрузка…</div>';try{const arr=scope==='chat'?await chatImages():await characterImages();body.innerHTML=arr.length?`<div class="wrm-gallery-grid">${arr.map((x,i)=>`<figure data-i="${i}"><img src="${esc(x.src)}"><figcaption>${esc(x.filename)}</figcaption></figure>`).join('')}</div>`:'<div class="wrm-empty">Изображений не найдено.</div>';body.querySelectorAll('[data-i]').forEach(f=>f.onclick=()=>lightbox(arr[Number(f.dataset.i)]))}catch(e){body.innerHTML=`<div class="wrm-empty">${esc(e.message)}</div>`}};m.onclick=e=>{const g=e.target.closest('[data-g]')?.dataset.g;if(g==='close')m.remove();else if(g){scope=g;draw()}};draw()}
function lightbox(x){const m=document.createElement('div');m.className='wrm-lightbox';m.innerHTML=`<img src="${esc(x.src)}"><div><button class="menu_button" data-l="download"><i class="fa-solid fa-download"></i></button><button class="menu_button" data-l="close"><i class="fa-solid fa-xmark"></i></button></div>`;document.body.appendChild(m);m.onclick=async e=>{if(e.target===m||e.target.closest('[data-l="close"]'))m.remove();if(e.target.closest('[data-l="download"]')){const r=await fetch(x.src);const b=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=x.filename||'image.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}}}

function updateBar(){
  const s=settings(); const count=(getActiveForSide('bot')?1:0)+(getActiveForSide('user')?1:0);let b=document.getElementById('wrm-bar-btn');
  if(s.wardrobeButtonPlacement!=='bar'){b?.remove();return}
  const left=document.getElementById('leftSendForm');if(!left)return;
  if(!b){b=document.createElement('div');b.id='wrm-bar-btn';b.title='Гардероб';b.className='wrm-bar-btn';b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openWardrobe()});left.appendChild(b)}
  b.classList.toggle('active',count>0);b.innerHTML=`<i class="fa-solid fa-shirt"></i>${count?`<span>${count}</span>`:''}`;
}
function injectStyle(){if(document.getElementById(STYLE_ID))return;const l=document.createElement('link');l.id=STYLE_ID;l.rel='stylesheet';l.href=new URL('./style.css',import.meta.url).href;document.head.appendChild(l)}
function init(){settings();injectStyle();const c=ctx();const ready=()=>{setTimeout(()=>{updateBar();updateInjection()},400)};if(c.eventSource&&c.event_types){c.eventSource.on(c.event_types.APP_READY,ready);c.eventSource.on(c.event_types.CHAT_CHANGED,()=>setTimeout(()=>{updateBar();updateInjection()},250));if(c.event_types.PERSONA_CHANGED)c.eventSource.on(c.event_types.PERSONA_CHANGED,()=>setTimeout(()=>{updateBar();updateInjection()},100));if(c.event_types.CHAT_COMPLETION_PROMPT_READY)c.eventSource.on(c.event_types.CHAT_COMPLETION_PROMPT_READY,injectImages)}setTimeout(updateBar,500);console.log('[WRM] Wardrobe Reference Manager loaded')}
init();
