
const MODULE = 'silly_wardrobe_reference_manager';
const KEY_PREFIX = 'swrm:';
const DEFAULT_TYPES = [
    { id: 'casual', label: 'Повседневное', icon: 'fa-shirt' },
    { id: 'formal', label: 'Формальное', icon: 'fa-gem' },
    { id: 'sport', label: 'Спортивное', icon: 'fa-person-running' },
    { id: 'sleep', label: 'Спальное', icon: 'fa-bed' },
    { id: 'beach', label: 'Пляж/купальник', icon: 'fa-umbrella-beach' },
    { id: 'work', label: 'Работа', icon: 'fa-briefcase' },
    { id: 'outer', label: 'Верхняя', icon: 'fa-mitten' },
    { id: 'other', label: 'Другое', icon: 'fa-tag' },
];

const defaults = {
    wardrobes: {},
    sharedBot: [],
    sharedUser: [],
    activeBot: {},
    activeUser: {},
    useSharedBot: false,
    useSharedUser: false,
    outfitTypes: DEFAULT_TYPES,
    buttonPlacement: 'bar',
    galleryPerPage: 12,
};

let state = {
    tab: 'bot',
    mode: 'personal',
    filter: 'all',
    sort: 'added',
    page: 0,
    modalOpen: false,
};

function ctx() { return SillyTavern.getContext(); }
function settings() {
    const c = ctx();
    if (!c.extensionSettings[MODULE]) c.extensionSettings[MODULE] = structuredClone(defaults);
    const s = c.extensionSettings[MODULE];
    for (const [k,v] of Object.entries(defaults)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    if (!Array.isArray(s.outfitTypes) || !s.outfitTypes.length) s.outfitTypes = structuredClone(DEFAULT_TYPES);
    return s;
}
function save() { ctx().saveSettingsDebounced(); }
function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
function esc(v) {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
}
function notify(kind, msg, title='Гардероб') {
    if (globalThis.toastr?.[kind]) toastr[kind](msg, title);
    else console.log(`[${title}] ${msg}`);
}
function currentCharacterName() {
    const c = ctx();
    if (c.characterId !== undefined && c.characters?.[c.characterId]) {
        return c.characters[c.characterId].name || 'Персонаж';
    }
    if (c.groupId !== undefined) return 'Группа';
    return 'Персонаж';
}
function currentCharacterKey() {
    const c = ctx();
    if (c.characterId !== undefined && c.characters?.[c.characterId]) {
        const ch = c.characters[c.characterId];
        return `char:${ch.avatar || ch.name || c.characterId}`;
    }
    if (c.groupId !== undefined) return `group:${c.groupId}`;
    return 'char:default';
}
function personaName() {
    const c = ctx();
    return c.name1 || 'Юзер';
}
function personaKey() {
    const c = ctx();
    return `persona:${c.name1 || 'default'}`;
}
function getView(tab) {
    const s = settings();
    const side = tab === 'bot' ? 'bot' : 'user';
    const shared = side === 'bot' ? s.useSharedBot : s.useSharedUser;
    if (shared) {
        return {
            side,
            shared: true,
            list: side === 'bot' ? s.sharedBot : s.sharedUser,
            active: side === 'bot' ? (s.activeBot.shared || null) : (s.activeUser.shared || null),
            setActive(id) {
                if (side === 'bot') s.activeBot.shared = id;
                else s.activeUser.shared = id;
            },
        };
    }
    const key = side === 'bot' ? currentCharacterKey() : personaKey();
    if (!s.wardrobes[key]) s.wardrobes[key] = { bot: [], user: [] };
    const list = s.wardrobes[key][side];
    const activeMap = side === 'bot' ? s.activeBot : s.activeUser;
    return {
        side, shared: false, list,
        active: activeMap[key] || null,
        setActive(id) { if (id) activeMap[key] = id; else delete activeMap[key]; },
    };
}
function allTypes() { return settings().outfitTypes; }
function typeMeta(id) { return allTypes().find(x => x.id === id) || allTypes().find(x => x.id === 'other') || DEFAULT_TYPES.at(-1); }
function typeOf(o) { return allTypes().some(x => x.id === o.type) ? o.type : 'other'; }
function imageKey(outfitId, refId) { return `${KEY_PREFIX}${outfitId}:${refId}`; }
async function putImage(key, data) {
    try {
        if (SillyTavern.libs?.localforage) return SillyTavern.libs.localforage.setItem(key, data);
    } catch {}
    localStorage.setItem(key, data);
}
async function getImage(key) {
    try {
        if (SillyTavern.libs?.localforage) return await SillyTavern.libs.localforage.getItem(key);
    } catch {}
    return localStorage.getItem(key);
}
async function removeImage(key) {
    try {
        if (SillyTavern.libs?.localforage) return SillyTavern.libs.localforage.removeItem(key);
    } catch {}
    localStorage.removeItem(key);
}
async function readFileData(file, max = 1600) {
    return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        r.onload = () => {
            const img = new Image();
            img.onload = () => {
                let w = img.naturalWidth, h = img.naturalHeight;
                const scale = Math.min(1, max / Math.max(w,h));
                w = Math.max(1, Math.round(w*scale)); h = Math.max(1, Math.round(h*scale));
                const c = document.createElement('canvas');
                c.width=w; c.height=h;
                c.getContext('2d').drawImage(img,0,0,w,h);
                resolve(c.toDataURL('image/jpeg', .88));
            };
            img.onerror = () => resolve(String(r.result));
            img.src = String(r.result);
        };
        r.readAsDataURL(file);
    });
}
async function addReference(outfit, dataUrl, name='Референс', description='') {
    const ref = { id: uid(), name, description, enabled: true };
    await putImage(imageKey(outfit.id, ref.id), dataUrl);
    outfit.refs = Array.isArray(outfit.refs) ? outfit.refs : [];
    outfit.refs.push(ref);
}
async function refData(outfit, ref) { return await getImage(imageKey(outfit.id, ref.id)); }
async function deleteReference(outfit, ref) {
    await removeImage(imageKey(outfit.id, ref.id));
    outfit.refs = (outfit.refs || []).filter(x => x.id !== ref.id);
}
async function deleteOutfit(view, id) {
    const o = view.list.find(x => x.id === id);
    if (!o) return;
    for (const r of (o.refs || [])) await removeImage(imageKey(o.id, r.id));
    const i = view.list.findIndex(x => x.id === id);
    if (i >= 0) view.list.splice(i,1);
    if (view.active === id) view.setActive(null);
}
function activeOutfit(side) {
    const v = getView(side);
    return v.list.find(o => o.id === v.active) || null;
}
function activeCount() {
    return (activeOutfit('bot') ? 1 : 0) + (activeOutfit('user') ? 1 : 0);
}
function injectText() {
    const bot = activeOutfit('bot');
    const user = activeOutfit('user');
    const parts = [];
    if (bot) parts.push(`${currentCharacterName()}: ${bot.description || bot.name}`);
    if (user) parts.push(`${personaName()}: ${user.description || user.name}`);
    return parts.length ? `[Текущая одежда]\n${parts.join('\n')}` : '';
}
async function updatePrompt() {
    const c = ctx();
    if (typeof c.setExtensionPrompt !== 'function') return;
    await c.setExtensionPrompt('swrm_outfit', injectText(), 1, 0, false, 0);
}
async function buildReferenceParts() {
    const parts = [];
    for (const side of ['bot','user']) {
        const o = activeOutfit(side);
        if (!o) continue;
        for (const r of (o.refs || [])) {
            if (!r.enabled) continue;
            const data = await refData(o,r);
            if (!data) continue;
            parts.push({ type:'image_url', image_url:{ url:data, detail:'auto' } });
        }
    }
    return parts;
}
/*
 * SillyTavern's multimodal message format is an array of content blocks.
 * We keep the normal wardrobe text injection in the stable extension-prompt API.
 * For compatible chat-completion builds, the interceptor also adds active visual
 * references to the last user message as image_url blocks.
 */
globalThis.swrmWardrobeInterceptor = async function(chat) {
    try {
        const refs = await buildReferenceParts();
        if (!refs.length || !Array.isArray(chat)) return;
        const last = [...chat].reverse().find(m => m && m.is_user && !m.is_system);
        if (!last) return;
        if (last.__swrmInjected) return;
        const text = typeof last.mes === 'string' ? last.mes : '';
        last.mes = [
            { type:'text', text: text },
            ...refs
        ];
        last.__swrmInjected = true;
    } catch (e) { console.warn('[SillyWardrobe] reference injection failed', e); }
};

function injectBarButton() {
    const placement = settings().buttonPlacement;
    const wantBar = placement === 'bar' || placement === 'both';
    const wantMenu = placement === 'menu' || placement === 'both';
    document.getElementById('swrm-bar-btn')?.remove();
    document.getElementById('swrm-menu-btn')?.remove();

    if (wantBar) {
        const left = document.getElementById('leftSendForm');
        if (left) {
            const b = document.createElement('div');
            b.id='swrm-bar-btn';
            b.className='swrm-bar-btn';
            b.title='Гардероб';
            b.innerHTML=`<i class="fa-solid fa-shirt"></i>${activeCount()?`<span>${activeCount()}</span>`:''}`;
            b.addEventListener('click', e=>{e.preventDefault();e.stopPropagation();openWardrobe();});
            left.appendChild(b);
        }
    }
    if (wantMenu) {
        const menu = document.getElementById('extensionsMenu');
        if (menu) {
            const b=document.createElement('div');
            b.id='swrm-menu-btn';
            b.className='list-group-item flex-container flexGap5';
            b.innerHTML=`<div class="fa-solid fa-shirt extensionsMenuExtensionButton"></div><span>Гардероб${activeCount()?` (${activeCount()})`:''}</span>`;
            b.addEventListener('click', e=>{e.preventDefault();e.stopPropagation();openWardrobe();});
            menu.appendChild(b);
        }
    }
}

function openWardrobe() {
    closeAll();
    const ov=document.createElement('div');
    ov.id='swrm-overlay';
    ov.innerHTML=`
      <div id="swrm-modal">
        <div class="swrm-header">
          <div class="swrm-title">Гардероб — <b>${esc(currentCharacterName())}</b></div>
          <div class="swrm-header-actions">
            <button class="swrm-icon-btn" id="swrm-gallery" title="Галерея"><i class="fa-solid fa-images"></i></button>
            <button class="swrm-icon-btn" id="swrm-types" title="Типы одежды"><i class="fa-solid fa-tags"></i></button>
            <button class="swrm-icon-btn" id="swrm-close"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div class="swrm-tabs">
          <button class="swrm-tab active" data-tab="bot">Бот</button>
          <button class="swrm-tab" data-tab="user">Юзер</button>
        </div>
        <div class="swrm-active" id="swrm-active">Ничего не надето</div>
        <div class="swrm-body" id="swrm-body"></div>
      </div>`;
    document.body.appendChild(ov);
    state.modalOpen=true;
    ov.addEventListener('click',e=>{if(e.target===ov) closeWardrobe();});
    ov.querySelector('#swrm-close').onclick=closeWardrobe;
    ov.querySelector('#swrm-gallery').onclick=openGallery;
    ov.querySelector('#swrm-types').onclick=openTypes;
    ov.querySelectorAll('.swrm-tab').forEach(b=>b.onclick=()=>{
        state.tab=b.dataset.tab; state.page=0; state.filter='all';
        ov.querySelectorAll('.swrm-tab').forEach(x=>x.classList.toggle('active',x===b));
        renderWardrobe();
    });
    document.addEventListener('keydown', escClose, true);
    renderWardrobe();
}
function escClose(e){if(e.key==='Escape'){if(document.getElementById('swrm-ref-form')) return;if(document.getElementById('swrm-form')) return;closeWardrobe();}}
function closeWardrobe(){document.getElementById('swrm-overlay')?.remove(); state.modalOpen=false; document.removeEventListener('keydown',escClose,true);}
function closeAll(){document.querySelectorAll('#swrm-overlay,#swrm-form-overlay,#swrm-gallery-overlay,#swrm-types-overlay').forEach(x=>x.remove());}

function renderWardrobe() {
    const body=document.getElementById('swrm-body');
    const active=document.getElementById('swrm-active');
    if(!body) return;
    const v=getView(state.tab);
    const list=[...v.list];
    const counts={};
    list.forEach(o=>counts[typeOf(o)]=(counts[typeOf(o)]||0)+1);
    if(state.filter!=='all' && !counts[state.filter]) state.filter='all';
    const activeOutfit = v.active ? v.list.find(x => x.id === v.active) : null;
    active.innerHTML = activeOutfit
        ? `Активно: <b>${esc(activeOutfit.name)}</b>${activeOutfit.description ? ` — ${esc(activeOutfit.description.slice(0,90))}${activeOutfit.description.length > 90 ? '…' : ''}` : ''}`
        : 'Ничего не надето';
    const modeShared=v.shared;
    const personalLabel=state.tab==='user'?'Персона':'Персонаж';
    const sorted=list.filter(o=>state.filter==='all'||typeOf(o)===state.filter).sort((a,b)=>{
        if(state.sort==='name') return String(a.name).localeCompare(String(b.name));
        if(state.sort==='worn') return (b.lastWorn||0)-(a.lastWorn||0);
        return (b.added||0)-(a.added||0);
    });
    const per=12, pages=Math.max(1,Math.ceil(sorted.length/per));
    state.page=Math.min(state.page,pages-1);
    const items=sorted.slice(state.page*per,(state.page+1)*per);
    let html=`
      <div class="swrm-mode-row">
        <button class="swrm-mode ${!modeShared?'active':''}" data-mode="personal"><i class="fa-solid fa-user"></i> ${personalLabel}</button>
        <button class="swrm-mode ${modeShared?'active':''}" data-mode="shared"><i class="fa-solid fa-earth-americas"></i> Общий</button>
        <select id="swrm-sort" class="swrm-sort"><option value="added">Недавно добавленные</option><option value="worn">Недавно надетые</option><option value="name">По имени</option></select>
      </div>
      <div class="swrm-filters">
        <button class="${state.filter==='all'?'active':''}" data-filter="all">Все <small>${list.length}</small></button>
        ${allTypes().map(t=>counts[t.id]?`<button class="${state.filter===t.id?'active':''}" data-filter="${esc(t.id)}"><i class="fa-solid ${esc(t.icon)}"></i> ${esc(t.label)} <small>${counts[t.id]}</small></button>`:'').join('')}
      </div>
      <div class="swrm-grid">
        <button class="swrm-card swrm-add" id="swrm-add"><i class="fa-solid fa-plus"></i><span>Загрузить</span></button>
        ${items.map(o=>cardHtml(o,v)).join('')}
      </div>
      ${pages>1?`<div class="swrm-pager"><button id="swrm-prev" ${state.page===0?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button><span>Стр. ${state.page+1} / ${pages} <small>(${sorted.length})</small></span><button id="swrm-next" ${state.page>=pages-1?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button></div>`:''}
    `;
    body.innerHTML=html;
    body.querySelector('#swrm-sort').value=state.sort;
    body.querySelector('#swrm-sort').onchange=e=>{state.sort=e.target.value;state.page=0;renderWardrobe();};
    body.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;state.page=0;renderWardrobe();});
    body.querySelectorAll('[data-mode]').forEach(b=>b.onclick=async()=>{
        const s=settings(), side=state.tab;
        const shared=b.dataset.mode==='shared';
        if(side==='bot') s.useSharedBot=shared; else s.useSharedUser=shared;
        save(); state.page=0; renderWardrobe();
    });
    body.querySelector('#swrm-add').onclick=()=>openOutfitForm({mode:'new',view:v});
    body.querySelector('#swrm-prev')?.addEventListener('click',()=>{state.page--;renderWardrobe();});
    body.querySelector('#swrm-next')?.addEventListener('click',()=>{state.page++;renderWardrobe();});
    body.querySelectorAll('[data-action]').forEach(el=>el.onclick=async e=>{
        e.preventDefault(); e.stopPropagation();
        const id=el.closest('[data-id]')?.dataset.id, o=v.list.find(x=>x.id===id);
        if(!o)return;
        const action=el.dataset.action;
        if(action==='toggle'){
            v.setActive(v.active===id?null:id);
            if(v.active===id)o.lastWorn=Date.now();
            save(); await updatePrompt(); injectBarButton(); renderWardrobe();
            notify(v.active===id?'success':'info',v.active===id?`«${o.name}» надет`:`«${o.name}» снят`);
        } else if(action==='edit') openOutfitForm({mode:'edit',view:v,item:o});
        else if(action==='delete'){
            if(!confirm(`Удалить «${o.name}»?`))return;
            await deleteOutfit(v,id); save(); await updatePrompt(); injectBarButton(); renderWardrobe();
        }
    });
}
function cardHtml(o,v){
    const a=v.active===o.id, t=typeMeta(typeOf(o)), ref=o.refs?.find(x=>x.enabled)||o.refs?.[0];
    const src=ref?`swrm:${o.id}:${ref.id}`:'';
    return `<div class="swrm-card outfit ${a?'active':''}" data-id="${esc(o.id)}">
      <div class="swrm-img" data-image-key="${esc(src)}" data-id="${esc(o.id)}"><div class="swrm-img-placeholder"><i class="fa-solid fa-shirt"></i></div></div>
      ${a?'<div class="swrm-check"><i class="fa-solid fa-check"></i></div>':''}
      <div class="swrm-type" title="${esc(t.label)}"><i class="fa-solid ${esc(t.icon)}"></i></div>
      <div class="swrm-card-footer"><span title="${esc(o.description||o.name)}">${esc(o.name)}</span>
        <div class="swrm-actions">
          <button data-action="toggle" title="${a?'Снять':'Надеть'}"><i class="fa-solid ${a?'fa-toggle-on':'fa-toggle-off'}"></i></button>
          <button data-action="edit" title="Редактировать"><i class="fa-solid fa-pen"></i></button>
          <button data-action="delete" title="Удалить"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>
      <select class="swrm-type-select" data-id="${esc(o.id)}">${allTypes().map(x=>`<option value="${esc(x.id)}" ${typeOf(o)===x.id?'selected':''}>${esc(x.label)}</option>`).join('')}</select>
    </div>`;
}
async function paintImages(root=document) {
    for(const el of root.querySelectorAll?.('[data-image-key]')||[]){
        if(el.dataset.loaded)return;
        el.dataset.loaded='1';
        const data=await getImage(el.dataset.imageKey);
        if(data) el.innerHTML=`<img src="${esc(data)}" alt="">`;
    }
}
async function openOutfitForm({mode,view,item=null}) {
    document.getElementById('swrm-form-overlay')?.remove();
    const isEdit=mode==='edit';
    const o=isEdit?item:{id:uid(),name:'',description:'',type:'other',added:Date.now(),lastWorn:0,refs:[]};
    const ov=document.createElement('div');
    ov.id='swrm-form-overlay';
    ov.innerHTML=`<div id="swrm-form">
      <div class="swrm-form-head"><b>${isEdit?'Редактировать образ':'Новый образ'}</b><button id="swrm-form-close"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="swrm-form-body">
        <label>Название<input id="swrm-name" class="text_pole" value="${esc(o.name)}"></label>
        <label>Описание<textarea id="swrm-desc" class="text_pole" rows="5">${esc(o.description||'')}</textarea></label>
        <label>Тип<select id="swrm-type" class="text_pole">${allTypes().map(x=>`<option value="${esc(x.id)}" ${typeOf(o)===x.id?'selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
        <div class="swrm-ref-head"><b>Визуальные референсы</b><button id="swrm-add-ref" class="menu_button"><i class="fa-solid fa-plus"></i> Добавить</button></div>
        <div id="swrm-refs"></div>
        <input id="swrm-file" type="file" accept="image/*" hidden>
        <div class="swrm-form-actions"><button id="swrm-save" class="menu_button">Сохранить</button><button id="swrm-cancel" class="menu_button">Отмена</button></div>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const close=()=>ov.remove();
    ov.querySelector('#swrm-form-close').onclick=close;
    ov.querySelector('#swrm-cancel').onclick=close;
    const refsEl=ov.querySelector('#swrm-refs');
    async function renderRefs(){
        refsEl.innerHTML='';
        for(const r of (o.refs||[])){
            const data=await refData(o,r);
            const row=document.createElement('div'); row.className='swrm-ref-row';
            row.innerHTML=`<div class="swrm-ref-thumb">${data?`<img src="${esc(data)}">`:'<i class="fa-regular fa-image"></i>'}</div>
              <div class="swrm-ref-fields"><input class="text_pole ref-name" value="${esc(r.name||'Референс')}" placeholder="Название референса"><textarea class="text_pole ref-desc" rows="2" placeholder="Описание">${esc(r.description||'')}</textarea>
              <label class="swrm-checkline"><input type="checkbox" class="ref-enabled" ${r.enabled!==false?'checked':''}> Использовать в контексте</label></div>
              <button class="swrm-ref-del" title="Удалить"><i class="fa-solid fa-trash"></i></button>`;
            row.querySelector('.ref-name').oninput=e=>r.name=e.target.value;
            row.querySelector('.ref-desc').oninput=e=>r.description=e.target.value;
            row.querySelector('.ref-enabled').onchange=e=>r.enabled=e.target.checked;
            row.querySelector('.swrm-ref-del').onclick=async()=>{await deleteReference(o,r);renderRefs();};
            refsEl.appendChild(row);
        }
        if(!o.refs?.length) refsEl.innerHTML='<div class="swrm-empty">Нет изображений. Добавь хотя бы один визуальный референс.</div>';
    }
    ov.querySelector('#swrm-add-ref').onclick=()=>{
        const inp=ov.querySelector('#swrm-file');
        inp.onchange=async()=>{
            const f=inp.files?.[0]; if(!f)return;
            try{const data=await readFileData(f);await addReference(o,data,f.name.replace(/\.[^.]+$/,''),'');await renderRefs();}catch(e){notify('error',e.message);}
            inp.value='';
        };
        inp.click();
    };
    ov.querySelector('#swrm-save').onclick=async()=>{
        o.name=ov.querySelector('#swrm-name').value.trim()||'Без названия';
        o.description=ov.querySelector('#swrm-desc').value.trim();
        o.type=ov.querySelector('#swrm-type').value;
        o.refs=o.refs||[];
        if(!isEdit)view.list.unshift(o);
        save(); close(); renderWardrobe(); notify('success',isEdit?'Изменения сохранены':'Наряд добавлен');
    };
    await renderRefs();
}
async function openTypes(){
    const ov=document.createElement('div');ov.id='swrm-types-overlay';
    ov.innerHTML=`<div id="swrm-types"><div class="swrm-form-head"><b>Типы одежды</b><button id="swrm-types-close"><i class="fa-solid fa-xmark"></i></button></div><div class="swrm-types-body"></div></div>`;
    document.body.appendChild(ov);
    const body=ov.querySelector('.swrm-types-body');
    function render(){
        body.innerHTML=allTypes().map((t,i)=>`<div class="swrm-type-row"><i class="fa-solid ${esc(t.icon)}"></i><input class="text_pole" value="${esc(t.label)}" data-i="${i}"><button data-del="${i}" class="swrm-ref-del"><i class="fa-solid fa-trash"></i></button></div>`).join('')+
          `<button id="swrm-type-add" class="menu_button"><i class="fa-solid fa-plus"></i> Добавить тип</button>`;
        body.querySelectorAll('input').forEach(x=>x.onchange=e=>{settings().outfitTypes[+x.dataset.i].label=e.target.value;save();renderWardrobe();});
        body.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{if(allTypes().length<=1)return;settings().outfitTypes.splice(+b.dataset.del,1);save();render();renderWardrobe();});
        body.querySelector('#swrm-type-add').onclick=()=>{settings().outfitTypes.push({id:`custom_${uid()}`,label:'Новый тип',icon:'fa-tag'});save();render();};
    }
    ov.querySelector('#swrm-types-close').onclick=()=>ov.remove();
    render();
}
function collectChatImages(){
    const out=[];
    document.querySelectorAll('#chat .mes img').forEach((img,i)=>{
        if(!img.src || img.src.startsWith('data:') && img.src.length<100) return;
        out.push({src:img.src,name:img.alt||`image_${i}`,index:i});
    });
    return out;
}
async function collectCharacterImages(){
    const c=ctx();
    let folder=currentCharacterName();
    try{
        const r=await fetch('/api/files/sanitize-filename',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({fileName:folder})});
        if(r.ok){const d=await r.json();if(d.fileName)folder=d.fileName;}
    }catch{}
    try{
        const r=await fetch('/api/images/list',{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({folder,sortField:'date',sortOrder:'asc'})});
        if(!r.ok)return [];
        const files=await r.json();
        return (Array.isArray(files)?files:[]).filter(x=>typeof x==='string').map(f=>({src:`user/images/${encodeURIComponent(folder)}/${encodeURIComponent(f)}`,name:f}));
    }catch{return []}
}
async function openGallery(){
    closeAll();
    const ov=document.createElement('div');ov.id='swrm-gallery-overlay';
    ov.innerHTML=`<div id="swrm-gallery"><div class="swrm-gallery-head"><b><i class="fa-solid fa-images"></i> Галерея</b><div><button data-scope="chat" class="active">Чат</button><button data-scope="character">Все</button><select id="swrm-g-sort"><option value="new">Новые</option><option value="old">Старые</option><option value="az">A → Z</option></select><button id="swrm-g-close"><i class="fa-solid fa-xmark"></i></button></div></div><div id="swrm-gallery-body"></div></div>`;
    document.body.appendChild(ov);
    let scope='chat', sort='new';
    async function render(){
        const body=ov.querySelector('#swrm-gallery-body');
        let imgs=scope==='chat'?collectChatImages():await collectCharacterImages();
        if(sort==='old')imgs.reverse(); else if(sort==='az')imgs.sort((a,b)=>a.name.localeCompare(b.name));
        body.innerHTML=imgs.length?`<div class="swrm-gallery-grid">${imgs.map((x,i)=>`<div class="swrm-gallery-card"><img src="${esc(x.src)}" data-gi="${i}"><div title="${esc(x.name)}">${esc(x.name)}</div></div>`).join('')}</div>`:'<div class="swrm-empty">Изображений нет</div>';
        body.querySelectorAll('img').forEach(img=>img.onclick=()=>openLightbox(img.src));
    }
    ov.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{scope=b.dataset.scope;ov.querySelectorAll('[data-scope]').forEach(x=>x.classList.toggle('active',x===b));render();});
    ov.querySelector('#swrm-g-sort').onchange=e=>{sort=e.target.value;render();};
    ov.querySelector('#swrm-g-close').onclick=()=>ov.remove();
    ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
    await render();
}
function openLightbox(src){
    const ov=document.createElement('div');ov.className='swrm-lightbox';
    ov.innerHTML=`<button><i class="fa-solid fa-xmark"></i></button><img src="${esc(src)}">`;
    document.body.appendChild(ov);ov.querySelector('button').onclick=()=>ov.remove();ov.onclick=e=>{if(e.target===ov)ov.remove();};
}
function init(){
    settings();
    const c=ctx();
    const ready=()=>setTimeout(()=>{injectBarButton();updatePrompt();},400);
    const ev=c.event_types||{};
    if(ev.APP_READY)c.eventSource.on(ev.APP_READY,ready); else ready();
    if(ev.CHAT_CHANGED)c.eventSource.on(ev.CHAT_CHANGED,()=>setTimeout(()=>{injectBarButton();updatePrompt();},200));
    if(ev.PERSONA_CHANGED)c.eventSource.on(ev.PERSONA_CHANGED,()=>{injectBarButton();updatePrompt();});
    if(ev.MESSAGE_SENT)c.eventSource.on(ev.MESSAGE_SENT,updatePrompt);
    console.log('[SillyWardrobe] Reference Manager loaded');
}
export function onActivate(){init();}
export function onInstall(){console.log('[SillyWardrobe] installed');}
export function onUpdate(){console.log('[SillyWardrobe] updated');}
