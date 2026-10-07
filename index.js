/**
 * Wardrobe Reference Manager for SillyTavern
 *
 * A lightweight wardrobe/reference extension inspired by the wardrobe concept
 * in SillyImages/SillyWardrobe, but implemented independently.
 *
 * Features:
 * - Multiple outfits per character/persona
 * - Outfit descriptions and tags
 * - Multiple visual references per outfit
 * - Local file upload to SillyTavern's image storage
 * - URL references
 * - Active outfit injection into prompts
 * - Visual references injected as image_url blocks for Chat Completions
 * - JSON import/export
 * - Generated-image gallery for current chat / current character folder
 *
 * This extension DOES NOT generate images and contains no image-generation API.
 */

const EXT = 'wardrobe_reference_manager';
const STYLE_ID = 'wrm_style';
const PANEL_ID = 'wrm_panel';
const GALLERY_ID = 'wrm_gallery';
const PROMPT_KEY = 'WRM_ACTIVE_OUTFIT';
const MAX_REF_IMAGES = 8;

const DEFAULTS = {
  enabled: true,
  injectDescription: true,
  injectImages: true,
  injectPosition: 'system',
  maxImagesPerRequest: 4,
  showFloatingButton: true,
  wardrobes: {},
  activeByCharacter: {},
  personaWardrobes: {},
  activeByPersona: {},
  sharedWardrobe: [],
  outfitTypes: [
    { id: 'casual', label: 'Повседневное', icon: 'fa-shirt' },
    { id: 'formal', label: 'Формальное', icon: 'fa-gem' },
    { id: 'sport', label: 'Спортивное', icon: 'fa-person-running' },
    { id: 'sleep', label: 'Домашнее / сон', icon: 'fa-bed' },
    { id: 'work', label: 'Работа / учёба', icon: 'fa-briefcase' },
    { id: 'special', label: 'Особое', icon: 'fa-star' },
    { id: 'other', label: 'Другое', icon: 'fa-tag' }
  ]
};

let state = { tab: 'character', filter: 'all', search: '' };

function ctx() { return SillyTavern.getContext(); }
function save() { ctx().saveSettingsDebounced(); }
function settings() {
  const c = ctx();
  if (!c.extensionSettings[EXT]) c.extensionSettings[EXT] = structuredClone(DEFAULTS);
  const s = c.extensionSettings[EXT];
  for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in s)) s[k] = structuredClone(v);
  if (!s.wardrobes || typeof s.wardrobes !== 'object') s.wardrobes = {};
  if (!s.activeByCharacter || typeof s.activeByCharacter !== 'object') s.activeByCharacter = {};
  if (!s.personaWardrobes || typeof s.personaWardrobes !== 'object') s.personaWardrobes = {};
  if (!s.activeByPersona || typeof s.activeByPersona !== 'object') s.activeByPersona = {};
  if (!Array.isArray(s.sharedWardrobe)) s.sharedWardrobe = [];
  if (!Array.isArray(s.outfitTypes) || !s.outfitTypes.length) s.outfitTypes = structuredClone(DEFAULTS.outfitTypes);
  return s;
}

function uid() { return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
function esc(value) { const d = document.createElement('div'); d.textContent = String(value ?? ''); return d.innerHTML; }
function charName() {
  const c = ctx();
  return c.characterId !== undefined && c.characters?.[c.characterId]
    ? String(c.characters[c.characterId].name || 'Character')
    : 'Character';
}
function personaKey() {
  const c = ctx();
  const id = String(c.chatMetadata?.persona || '').trim();
  if (id) return `persona:${id}`;
  return `name:${String(c.name1 || 'User').trim() || 'User'}`;
}
function personaName() {
  const c = ctx();
  const key = String(c.chatMetadata?.persona || '').trim();
  return String(c.powerUserSettings?.personas?.[key] || c.name1 || 'User');
}
function characterKey() {
  const c = ctx();
  if (c.characterId !== undefined && c.characters?.[c.characterId]) {
    return String(c.characters[c.characterId].avatar || c.characterId);
  }
  return `name:${charName()}`;
}
function typeMeta(id) { return settings().outfitTypes.find(x => x.id === id) || settings().outfitTypes.at(-1); }

function activeList() {
  const s = settings();
  if (state.tab === 'shared') return s.sharedWardrobe;
  if (state.tab === 'persona') {
    const k = personaKey();
    if (!Array.isArray(s.personaWardrobes[k])) s.personaWardrobes[k] = [];
    return s.personaWardrobes[k];
  }
  const k = characterKey();
  if (!Array.isArray(s.wardrobes[k])) s.wardrobes[k] = [];
  return s.wardrobes[k];
}
function activeId() {
  const s = settings();
  if (state.tab === 'shared') return s.activeShared || null;
  if (state.tab === 'persona') return s.activeByPersona[personaKey()] || null;
  return s.activeByCharacter[characterKey()] || null;
}
function setActive(id) {
  const s = settings();
  if (state.tab === 'shared') s.activeShared = id || null;
  else if (state.tab === 'persona') s.activeByPersona[personaKey()] = id || null;
  else s.activeByCharacter[characterKey()] = id || null;
  save(); updateInjection(); renderWardrobe();
}
function outfitForCurrentCharacter() {
  const s = settings();
  const id = s.activeByCharacter[characterKey()];
  return s.wardrobes[characterKey()]?.find(x => x.id === id) || null;
}

async function readDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function uploadDataUrl(dataUrl, originalName = 'reference.png') {
  const c = ctx();
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('Неверный формат изображения');
  const mime = dataUrl.slice(5, comma).split(';')[0] || 'image/png';
  const format = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  const safeFormat = ['jpg', 'png', 'webp', 'gif'].includes(format) ? format : 'png';
  const base64 = dataUrl.slice(comma + 1);
  const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: c.getRequestHeaders(),
    body: JSON.stringify({
      image: base64,
      format: safeFormat,
      ch_name: charName(),
      filename: `wrm_${Date.now()}_${String(originalName).replace(/[^a-z0-9._-]/gi, '_')}`
    })
  });
  if (!response.ok) throw new Error(await response.text() || `Upload failed: ${response.status}`);
  const result = await response.json();
  if (!result.path) throw new Error('Сервер не вернул путь к изображению');
  return result.path;
}

async function imageToDataUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:image/')) return src;
  try {
    const response = await fetch(src, { credentials: 'same-origin' });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function normalizedSrc(src) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (value.startsWith('data:') || /^https?:\/\//i.test(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function makeOutfit(overrides = {}) {
  return {
    id: uid(),
    name: 'Новый наряд',
    description: '',
    type: 'casual',
    tags: [],
    references: [],
    enabled: true,
    addedAt: Date.now(),
    ...overrides
  };
}

function ensureRefShape(ref) {
  return {
    id: ref.id || uid(),
    label: String(ref.label || 'Visual reference'),
    description: String(ref.description || ''),
    src: String(ref.src || ref.imageUrl || ''),
    enabled: ref.enabled !== false,
    order: Number(ref.order || 0)
  };
}

function filteredOutfits() {
  const q = state.search.trim().toLowerCase();
  return activeList()
    .filter(o => state.filter === 'all' || o.type === state.filter)
    .filter(o => !q || `${o.name} ${o.description} ${(o.tags || []).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function openPanel() {
  if (document.getElementById(PANEL_ID)) { closePanel(); return; }
  const overlay = document.createElement('div');
  overlay.id = PANEL_ID;
  overlay.className = 'wrm-overlay';
  overlay.innerHTML = `<section class="wrm-window" role="dialog" aria-label="Wardrobe">
    <header class="wrm-header">
      <div><h2><i class="fa-solid fa-shirt"></i> Гардероб</h2><div class="wrm-subtitle">Визуальные референсы для персонажей</div></div>
      <div class="wrm-header-actions"><button class="menu_button" data-action="gallery"><i class="fa-solid fa-images"></i> Галерея</button><button class="menu_button" data-action="close"><i class="fa-solid fa-xmark"></i></button></div>
    </header>
    <nav class="wrm-tabs">
      <button data-tab="character">${esc(charName())}</button>
      <button data-tab="persona">${esc(personaName())}</button>
      <button data-tab="shared">Общий</button>
    </nav>
    <div class="wrm-toolbar">
      <button class="menu_button" data-action="new"><i class="fa-solid fa-plus"></i> Новый наряд</button>
      <button class="menu_button" data-action="export"><i class="fa-solid fa-file-export"></i></button>
      <button class="menu_button" data-action="import"><i class="fa-solid fa-file-import"></i></button>
      <input class="text_pole wrm-search" placeholder="Поиск наряда…">
    </div>
    <div class="wrm-filters" id="wrm_filters"></div>
    <main class="wrm-body" id="wrm_body"></main>
    <footer class="wrm-footer"><label><input id="wrm-enabled" type="checkbox"> Гардероб активен</label><label><input id="wrm-images" type="checkbox"> Отправлять изображения модели</label></footer>
  </section>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', onPanelClick);
  overlay.querySelector('.wrm-search').addEventListener('input', e => { state.search = e.target.value; renderWardrobe(); });
  overlay.querySelector('#wrm-enabled').checked = settings().enabled;
  overlay.querySelector('#wrm-images').checked = settings().injectImages;
  overlay.querySelector('#wrm-enabled').addEventListener('change', e => { settings().enabled = e.target.checked; save(); updateInjection(); });
  overlay.querySelector('#wrm-images').addEventListener('change', e => { settings().injectImages = e.target.checked; save(); updateInjection(); });
  renderWardrobe();
}
function closePanel() { document.getElementById(PANEL_ID)?.remove(); }

function onPanelClick(e) {
  const a = e.target.closest('[data-action]');
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; state.filter = 'all'; state.search = ''; renderWardrobe(); return; }
  if (!a) return;
  const action = a.dataset.action;
  if (action === 'close') closePanel();
  if (action === 'new') editOutfit(makeOutfit());
  if (action === 'gallery') openGallery();
  if (action === 'export') exportWardrobe();
  if (action === 'import') importWardrobe();
  if (action === 'edit') { const o = activeList().find(x => x.id === a.dataset.id); if (o) editOutfit(o); }
  if (action === 'active') setActive(a.dataset.id === activeId() ? null : a.dataset.id);
  if (action === 'delete') deleteOutfit(a.dataset.id);
  if (action === 'duplicate') { const o = activeList().find(x => x.id === a.dataset.id); if (o) { const clone = structuredClone(o); clone.id = uid(); clone.name += ' — копия'; clone.addedAt = Date.now(); activeList().push(clone); save(); renderWardrobe(); } }
}

function renderWardrobe() {
  const panel = document.getElementById(PANEL_ID); if (!panel) return;
  panel.querySelectorAll('.wrm-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const filters = panel.querySelector('#wrm_filters');
  filters.innerHTML = `<button data-filter="all" class="${state.filter === 'all' ? 'active' : ''}">Все</button>` + settings().outfitTypes.map(t => `<button data-filter="${esc(t.id)}" class="${state.filter === t.id ? 'active' : ''}"><i class="fa-solid ${esc(t.icon)}"></i> ${esc(t.label)}</button>`).join('');
  filters.onclick = e => { const b = e.target.closest('[data-filter]'); if (b) { state.filter = b.dataset.filter; renderWardrobe(); } };
  const list = filteredOutfits();
  const active = activeId();
  panel.querySelector('#wrm_body').innerHTML = list.length ? `<div class="wrm-grid">${list.map(o => outfitCard(o, o.id === active)).join('')}</div>` : `<div class="wrm-empty"><i class="fa-solid fa-shirt"></i><h3>Гардероб пуст</h3><p>Добавь наряд и прикрепи одну или несколько картинок-референсов.</p><button class="menu_button" data-action="new"><i class="fa-solid fa-plus"></i> Создать наряд</button></div>`;
}

function outfitCard(o, active) {
  const first = o.references?.find(r => r.enabled !== false && r.src)?.src || '';
  const meta = typeMeta(o.type);
  return `<article class="wrm-card ${active ? 'is-active' : ''}">
    <div class="wrm-card-image">${first ? `<img src="${esc(normalizedSrc(first))}" loading="lazy">` : `<i class="fa-solid fa-image"></i>`}${active ? '<span class="wrm-active-badge">ACTIVE</span>' : ''}</div>
    <div class="wrm-card-info"><div class="wrm-card-title">${esc(o.name)}</div><div class="wrm-card-type"><i class="fa-solid ${esc(meta?.icon || 'fa-tag')}"></i> ${esc(meta?.label || 'Другое')}</div><p>${esc(o.description || 'Без описания')}</p><div class="wrm-card-tags">${(o.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div></div>
    <div class="wrm-card-actions"><button data-action="active" data-id="${esc(o.id)}" title="Сделать активным"><i class="fa-solid fa-check"></i></button><button data-action="edit" data-id="${esc(o.id)}" title="Изменить"><i class="fa-solid fa-pen"></i></button><button data-action="duplicate" data-id="${esc(o.id)}" title="Дублировать"><i class="fa-solid fa-copy"></i></button><button data-action="delete" data-id="${esc(o.id)}" title="Удалить"><i class="fa-solid fa-trash"></i></button></div>
  </article>`;
}

function editOutfit(outfit) {
  const existing = activeList().some(x => x.id === outfit.id);
  const working = structuredClone(outfit);
  working.references = (working.references || []).map(ensureRefShape);
  const modal = document.createElement('div');
  modal.className = 'wrm-modal';
  modal.innerHTML = `<section class="wrm-editor">
    <header><h3><i class="fa-solid fa-shirt"></i> ${existing ? 'Редактирование наряда' : 'Новый наряд'}</h3><button class="menu_button" data-e="close"><i class="fa-solid fa-xmark"></i></button></header>
    <div class="wrm-editor-scroll">
      <label>Название<input id="e-name" class="text_pole" value="${esc(working.name)}"></label>
      <label>Категория<select id="e-type" class="text_pole">${settings().outfitTypes.map(t => `<option value="${esc(t.id)}" ${t.id === working.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label>Описание для модели<textarea id="e-desc" class="text_pole" rows="6" placeholder="Подробно опиши наряд…">${esc(working.description)}</textarea></label>
      <label>Теги<input id="e-tags" class="text_pole" value="${esc((working.tags || []).join(', '))}" placeholder="вечер, чёрный, платье"></label>
      <div class="wrm-ref-head"><h4>Визуальные референсы</h4><button class="menu_button" data-e="add-ref"><i class="fa-solid fa-plus"></i> Добавить</button></div>
      <div id="e-refs" class="wrm-refs"></div>
    </div>
    <footer><button class="menu_button" data-e="close">Отмена</button><button class="menu_button primary" data-e="save">Сохранить</button></footer>
  </section>`;
  document.body.appendChild(modal);
  const refsEl = modal.querySelector('#e-refs');
  const renderRefs = () => {
    refsEl.innerHTML = working.references.map((r, i) => `<div class="wrm-ref" data-ref="${esc(r.id)}"><div class="wrm-ref-preview">${r.src ? `<img src="${esc(normalizedSrc(r.src))}">` : '<i class="fa-solid fa-image"></i>'}</div><div class="wrm-ref-fields"><input class="text_pole ref-label" value="${esc(r.label)}" placeholder="Название референса"><textarea class="text_pole ref-desc" rows="3" placeholder="Что именно нужно учитывать по картинке?">${esc(r.description)}</textarea><input class="text_pole ref-url" value="${esc(r.src)}" placeholder="URL изображения (необязательно)"><div class="wrm-ref-buttons"><button class="menu_button" data-ref-action="upload"><i class="fa-solid fa-upload"></i> Загрузить</button><button class="menu_button" data-ref-action="toggle">${r.enabled === false ? 'Выключен' : 'Включён'}</button><button class="menu_button" data-ref-action="remove"><i class="fa-solid fa-trash"></i></button></div></div></div>`).join('') || '<div class="wrm-ref-empty">Нет референсов. Добавь изображение.</div>';
    refsEl.querySelectorAll('.wrm-ref').forEach(row => {
      const r = working.references.find(x => x.id === row.dataset.ref); if (!r) return;
      row.querySelector('.ref-label').addEventListener('input', e => r.label = e.target.value);
      row.querySelector('.ref-desc').addEventListener('input', e => r.description = e.target.value);
      row.querySelector('.ref-url').addEventListener('change', e => { r.src = e.target.value.trim(); renderRefs(); });
      row.querySelector('[data-ref-action="toggle"]').addEventListener('click', () => { r.enabled = r.enabled === false; renderRefs(); });
      row.querySelector('[data-ref-action="remove"]').addEventListener('click', () => { working.references = working.references.filter(x => x.id !== r.id); renderRefs(); });
      row.querySelector('[data-ref-action="upload"]').addEventListener('click', () => chooseImage(async file => { const data = await readDataUrl(file); try { r.src = await uploadDataUrl(data, file.name); renderRefs(); } catch (err) { toastr.error(err.message, 'Гардероб'); } }));
    });
  };
  renderRefs();
  modal.addEventListener('click', e => {
    const a = e.target.closest('[data-e]'); if (!a) return;
    if (a.dataset.e === 'close') modal.remove();
    if (a.dataset.e === 'add-ref') { if (working.references.length >= MAX_REF_IMAGES) return toastr.warning(`Максимум ${MAX_REF_IMAGES} референсов на наряд`, 'Гардероб'); working.references.push(ensureRefShape({ label: `Reference ${working.references.length + 1}` })); renderRefs(); }
    if (a.dataset.e === 'save') {
      working.name = modal.querySelector('#e-name').value.trim() || 'Новый наряд';
      working.type = modal.querySelector('#e-type').value;
      working.description = modal.querySelector('#e-desc').value.trim();
      working.tags = modal.querySelector('#e-tags').value.split(',').map(x => x.trim()).filter(Boolean);
      working.references = working.references.map((r, i) => ({ ...ensureRefShape(r), order: i }));
      if (existing) { const i = activeList().findIndex(x => x.id === working.id); activeList()[i] = working; }
      else activeList().push(working);
      save(); modal.remove(); renderWardrobe(); updateInjection();
    }
  });
}

function chooseImage(callback) { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = () => { const f = input.files?.[0]; if (f) callback(f); }; input.click(); }
function deleteOutfit(id) { const o = activeList().find(x => x.id === id); if (!o || !confirm(`Удалить «${o.name}»?`)) return; const arr = activeList(); const i = arr.findIndex(x => x.id === id); arr.splice(i, 1); if (activeId() === id) setActive(null); save(); renderWardrobe(); }

function exportWardrobe() {
  const payload = { kind: 'sillytavern-wardrobe-references', version: 1, name: state.tab === 'character' ? charName() : state.tab === 'persona' ? personaName() : 'Shared', outfits: structuredClone(activeList()) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `wardrobe_${String(payload.name).replace(/[^a-z0-9_-]/gi, '_')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importWardrobe() { const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json'; input.onchange = async () => { const file = input.files?.[0]; if (!file) return; try { const data = JSON.parse(await file.text()); if (!Array.isArray(data.outfits)) throw new Error('В JSON нет массива outfits'); const arr = activeList(); for (const raw of data.outfits) { const o = makeOutfit(raw); o.id = uid(); o.references = (raw.references || []).map(ensureRefShape); arr.push(o); } save(); renderWardrobe(); toastr.success(`Импортировано: ${data.outfits.length}`, 'Гардероб'); } catch (err) { toastr.error(err.message, 'Импорт гардероба'); } }; input.click(); }

function buildInjectionText(outfit) {
  const lines = ['[WARDROBE REFERENCE]'];
  lines.push(`Current outfit: ${outfit.name}`);
  if (outfit.description) lines.push(`Outfit description: ${outfit.description}`);
  if (outfit.tags?.length) lines.push(`Tags: ${outfit.tags.join(', ')}`);
  const refs = (outfit.references || []).filter(r => r.enabled !== false && r.src);
  if (refs.length) lines.push('Visual references are attached to this instruction. Use them as visual references for the character\'s current outfit. Do not invent a different outfit when describing or continuing the scene unless the story explicitly changes clothes.');
  return lines.join('\n');
}

function extensionPromptApi() {
  try {
    return ctx().setExtensionPrompt || null;
  } catch { return null; }
}
async function updateInjection() {
  const s = settings();
  const outfit = outfitForCurrentCharacter();
  const api = extensionPromptApi();
  if (api) api(PROMPT_KEY, s.enabled && outfit && s.injectDescription ? buildInjectionText(outfit) : '', 0, 0, false);
}

async function injectImagesIntoPrompt(eventData) {
  const s = settings();
  if (!s.enabled || !s.injectImages) return;
  const outfit = outfitForCurrentCharacter();
  if (!outfit) return;
  const refs = (outfit.references || []).filter(r => r.enabled !== false && r.src).slice(0, Math.max(1, Number(s.maxImagesPerRequest) || 4));
  if (!refs.length || !eventData?.chat || !Array.isArray(eventData.chat)) return;

  const dataUrls = [];
  for (const ref of refs) {
    const dataUrl = await imageToDataUrl(normalizedSrc(ref.src));
    if (dataUrl) dataUrls.push({ ref, dataUrl });
  }
  if (!dataUrls.length) return;

  let target = eventData.chat.find(m => m && m.role === 'system');
  if (!target) target = eventData.chat.find(m => m && m.role === 'user');
  if (!target) return;

  const description = buildInjectionText(outfit);
  const textBlock = { type: 'text', text: description };
  const imageBlocks = [];
  for (const item of dataUrls) {
    imageBlocks.push({ type: 'text', text: item.ref.description ? `Reference: ${item.ref.label}\n${item.ref.description}` : `Reference: ${item.ref.label}` });
    imageBlocks.push({ type: 'image_url', image_url: { url: item.dataUrl } });
  }

  if (Array.isArray(target.content)) {
    target.content.push(textBlock, ...imageBlocks);
  } else {
    target.content = [{ type: 'text', text: String(target.content ?? '') }, textBlock, ...imageBlocks];
  }
}

// ── Generated image gallery ────────────────────────────────────────────────
async function collectChatImages() {
  const c = ctx();
  const result = [];
  document.querySelectorAll('#chat .mes').forEach((mes, mi) => {
    const messageId = Number.parseInt(mes.getAttribute('mesid'), 10);
    mes.querySelectorAll('img').forEach((img, i) => {
      if (!img.src || img.src.startsWith('data:') || img.classList.contains('avatar')) return;
      result.push({ src: img.src, filename: img.src.split('/').pop() || `image_${mi}_${i}`, messageId, order: result.length, label: c.chat?.[messageId]?.name || '' });
    });
  });
  return result;
}
async function characterFolder() {
  const c = ctx();
  let name = charName();
  try {
    const r = await fetch('/api/files/sanitize-filename', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ fileName: name }) });
    if (r.ok) name = (await r.json()).fileName || name;
  } catch {}
  return name;
}
async function collectCharacterImages() {
  const c = ctx();
  const folder = await characterFolder();
  const r = await fetch('/api/images/list', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ folder, sortField: 'date', sortOrder: 'desc' }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const files = await r.json();
  return (Array.isArray(files) ? files : []).filter(x => typeof x === 'string').map(file => ({ src: `/user/images/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`, filename: file, label: charName() }));
}
async function openGallery() {
  if (document.getElementById(GALLERY_ID)) return;
  const modal = document.createElement('div'); modal.id = GALLERY_ID; modal.className = 'wrm-modal';
  modal.innerHTML = `<section class="wrm-gallery"><header><h3><i class="fa-solid fa-images"></i> Галерея сгенерированных изображений</h3><div><button class="menu_button" data-gscope="chat">Текущий чат</button><button class="menu_button" data-gscope="character">Персонаж</button><button class="menu_button" data-g="close"><i class="fa-solid fa-xmark"></i></button></div></header><main id="wrm-gallery-body"><div class="wrm-loading">Загрузка…</div></main></section>`;
  document.body.appendChild(modal);
  let scope = 'chat';
  const render = async () => {
    const body = modal.querySelector('#wrm-gallery-body'); body.innerHTML = '<div class="wrm-loading">Загрузка…</div>';
    try {
      const images = scope === 'chat' ? await collectChatImages() : await collectCharacterImages();
      body.innerHTML = images.length ? `<div class="wrm-gallery-grid">${images.map((x, i) => `<figure data-gi="${i}"><img src="${esc(x.src)}"><figcaption>${esc(x.filename || x.label)}</figcaption></figure>`).join('')}</div>` : '<div class="wrm-empty">Изображений не найдено.</div>';
      body.querySelectorAll('[data-gi]').forEach(card => card.addEventListener('click', () => lightbox(images[Number(card.dataset.gi)])));
    } catch (err) { body.innerHTML = `<div class="wrm-empty">Не удалось загрузить галерею.<br>${esc(err.message)}</div>`; }
  };
  modal.addEventListener('click', e => { const b = e.target.closest('[data-gscope]'); if (b) { scope = b.dataset.gscope; render(); } if (e.target.closest('[data-g="close"]')) modal.remove(); });
  render();
}
function lightbox(item) {
  const m = document.createElement('div'); m.className = 'wrm-lightbox'; m.innerHTML = `<img src="${esc(item.src)}"><div class="wrm-lightbox-actions"><button class="menu_button" data-l="download"><i class="fa-solid fa-download"></i></button><button class="menu_button" data-l="close"><i class="fa-solid fa-xmark"></i></button></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target.closest('[data-l="close"]') || e.target === m) m.remove(); if (e.target.closest('[data-l="download"]')) downloadSrc(item.src, item.filename); });
}
async function downloadSrc(src, name = 'image.png') { try { const r = await fetch(src); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } catch { window.open(src, '_blank'); } }

function addFloatingButton() {
  if (document.getElementById('wrm-float')) return;
  const b = document.createElement('button'); b.id = 'wrm-float'; b.className = 'wrm-floating'; b.title = 'Гардероб'; b.innerHTML = '<i class="fa-solid fa-shirt"></i>'; b.addEventListener('click', openPanel); document.body.appendChild(b);
}
function injectStyle() { if (document.getElementById(STYLE_ID)) return; const link = document.createElement('link'); link.id = STYLE_ID; link.rel = 'stylesheet'; link.href = new URL('./style.css', import.meta.url).href; document.head.appendChild(link); }

function init() {
  settings(); injectStyle();
  const c = ctx();
  if (c.eventSource && c.event_types) {
    c.eventSource.on(c.event_types.APP_READY, () => { if (settings().showFloatingButton) addFloatingButton(); updateInjection(); });
    c.eventSource.on(c.event_types.CHAT_CHANGED, () => setTimeout(updateInjection, 50));
    if (c.event_types.CHAT_COMPLETION_PROMPT_READY) c.eventSource.on(c.event_types.CHAT_COMPLETION_PROMPT_READY, injectImagesIntoPrompt);
  }
  if (settings().showFloatingButton) addFloatingButton();
  console.log('[WRM] Wardrobe Reference Manager loaded');
}

init();
