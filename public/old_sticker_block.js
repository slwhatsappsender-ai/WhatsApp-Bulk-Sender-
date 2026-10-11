let stkSourceImage = null;
let stkShape = 'original'; // 'original', 'circle', 'rounded'
let stkBorderEnabled = true;
let stkBorderWidth = 8;
let stkText = '';
let stkTextPos = 'bottom'; // 'top', 'center', 'bottom'
let stkFontSize = 38;
let stkTextColor = '#ffffff';
let stkStrokeColor = '#000000';
let stkStrokeWidth = 4;
let stkTextDrag = { x: 256, y: 440, isDragging: false };
let activeCampaignSticker = null;

function handleStickerImageUpload(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      stkSourceImage = img;
      drawStickerCanvas();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function drawStickerCanvas() {
  const canvas = document.getElementById('stk-editor-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  if (!stkSourceImage) {
    // Empty state placeholder
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, 512, 512);
    ctx.font = '72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎨', 256, 210);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = 'var(--txt, #94a3b8)';
    ctx.fillText('Click "Upload Image" to create a Sticker', 256, 290);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Auto-scaled to 512x512 WebP WhatsApp Sticker', 256, 325);
    ctx.restore();
    return;
  }

  // Calculate proportional 512x512 fit
  const padding = stkBorderEnabled ? (stkBorderWidth * 2 + 10) : 10;
  const availW = 512 - padding * 2;
  const availH = 512 - padding * 2;
  const scale = Math.min(availW / stkSourceImage.width, availH / stkSourceImage.height);
  const dw = Math.round(stkSourceImage.width * scale);
  const dh = Math.round(stkSourceImage.height * scale);
  const dx = Math.round((512 - dw) / 2);
  const dy = Math.round((512 - dh) / 2);

  // 1. Draw Optional Die-Cut White Outline / Border
  if (stkBorderEnabled && stkBorderWidth > 0) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = stkBorderWidth * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (stkShape === 'circle') {
      const radius = Math.min(dw, dh) / 2 + stkBorderWidth;
      ctx.beginPath();
      ctx.arc(256, 256, radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (stkShape === 'rounded') {
      const rw = dw + stkBorderWidth * 2;
      const rh = dh + stkBorderWidth * 2;
      const rx = (512 - rw) / 2;
      const ry = (512 - rh) / 2;
      roundRectPath(ctx, rx, ry, rw, rh, 28);
      ctx.fill();
    } else {
      // Original outline
      ctx.strokeRect(dx - stkBorderWidth, dy - stkBorderWidth, dw + stkBorderWidth * 2, dh + stkBorderWidth * 2);
      ctx.fillRect(dx - stkBorderWidth, dy - stkBorderWidth, dw + stkBorderWidth * 2, dh + stkBorderWidth * 2);
    }
    ctx.restore();
  }

  // 2. Draw Clipped Image
  ctx.save();
  if (stkShape === 'circle') {
    const radius = Math.min(dw, dh) / 2;
    ctx.beginPath();
    ctx.arc(256, 256, radius, 0, Math.PI * 2);
    ctx.clip();
  } else if (stkShape === 'rounded') {
    roundRectPath(ctx, dx, dy, dw, dh, 22);
    ctx.clip();
  }
  ctx.drawImage(stkSourceImage, dx, dy, dw, dh);
  ctx.restore();

  // 3. Draw Text / Meme Overlay
  if (stkText && stkText.trim()) {
    ctx.save();
    ctx.font = `bold ${stkFontSize}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let tx = 256;
    let ty = 440;
    if (stkTextPos === 'top') ty = 70;
    if (stkTextPos === 'center') ty = 256;
    if (stkTextPos === 'custom') { tx = stkTextDrag.x; ty = stkTextDrag.y; }

    // Thick black outline
    ctx.strokeStyle = stkStrokeColor || '#000000';
    ctx.lineWidth = stkStrokeWidth * 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(stkText.toUpperCase(), tx, ty);

    // Text fill
    ctx.fillStyle = stkTextColor || '#ffffff';
    ctx.fillText(stkText.toUpperCase(), tx, ty);
    ctx.restore();
  }
}

function roundRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function setStickerShape(shape) {
  stkShape = shape;
  document.querySelectorAll('.stk-shape-btn').forEach(btn => {
    btn.className = (btn.getAttribute('data-shape') === shape) ? 'btn btn-sm btn-primary stk-shape-btn active' : 'btn btn-sm btn-ghost stk-shape-btn';
  });
  drawStickerCanvas();
}

function toggleStickerBorder(enabled) {
  stkBorderEnabled = Boolean(enabled);
  drawStickerCanvas();
}

function onStickerBorderSlider(val) {
  stkBorderWidth = parseInt(val) || 8;
  const lbl = document.getElementById('stk-border-val');
  if (lbl) lbl.textContent = stkBorderWidth + 'px';
  drawStickerCanvas();
}

function onStickerTextInput(val) {
  stkText = val || '';
  drawStickerCanvas();
}

function clearStickerText() {
  stkText = '';
  const input = document.getElementById('stk-text-input');
  if (input) input.value = '';
  drawStickerCanvas();
}

function setStickerTextPos(pos) {
  stkTextPos = pos;
  drawStickerCanvas();
}

function onStickerFontSize(val) {
  stkFontSize = parseInt(val) || 38;
  const lbl = document.getElementById('stk-font-size-val');
  if (lbl) lbl.textContent = stkFontSize + 'px';
  drawStickerCanvas();
}

function onStickerTextColor(val) {
  stkTextColor = val;
  drawStickerCanvas();
}

function onStickerStrokeColor(val) {
  stkStrokeColor = val;
  drawStickerCanvas();
}

function setStickerBg(bg) {
  const container = document.getElementById('stk-canvas-container');
  if (!container) return;
  document.querySelectorAll('.stk-bg-btn').forEach(b => {
    b.className = (b.getAttribute('data-bg') === bg) ? 'btn btn-ghost btn-xs stk-bg-btn active' : 'btn btn-ghost btn-xs stk-bg-btn';
  });
  if (bg === 'dark') {
    container.style.background = '#0b141a';
  } else if (bg === 'light') {
    container.style.background = '#efeae2';
  } else {
    container.style.background = 'repeating-conic-gradient(rgba(0,0,0,0.06) 0% 25%, transparent 0% 50%) 50% / 16px 16px';
  }
}

async function exportStickerWebpDataUrl() {
  const canvas = document.getElementById('stk-editor-canvas');
  if (!canvas) return null;
  // Ensure drawn
  drawStickerCanvas();
  return canvas.toDataURL('image/webp', 0.9);
}

async function saveStickerToCatalog() {
  if (!stkSourceImage) return alert('Please upload an image first!');
  const dataUrl = await exportStickerWebpDataUrl();
  const name = (document.getElementById('stk-text-input')?.value || '').trim() || 'Sticker ' + new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const newSticker = {
    id: `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    base64: dataUrl,
    createdAt: new Date().toISOString()
  };

  // Try API first
  try {
    await fetch('/api/stickers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSticker)
    });
  } catch (e) {
    console.warn('Saving sticker to localStorage fallback');
  }

  // Also persist in localStorage
  let localList = [];
  try { localList = JSON.parse(localStorage.getItem('wa_saved_stickers') || '[]'); } catch (_) {}
  localList.unshift(newSticker);
  if (localList.length > 50) localList = localList.slice(0, 50);
  localStorage.setItem('wa_saved_stickers', JSON.stringify(localList));

  loadSavedStickersCatalog();
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'success',
      title: 'Saved to Library!',
      text: 'Sticker has been saved. You can now use it in your campaigns.',
      timer: 1600,
      showConfirmButton: false
    });
  }
}

async function useStickerInCampaign() {
  if (!stkSourceImage) return alert('Please upload an image first!');
  const dataUrl = await exportStickerWebpDataUrl();
  const name = (document.getElementById('stk-text-input')?.value || '').trim() || 'Custom Sticker';
  addStickerToCampaignMedia(name, dataUrl);
}

async function downloadStickerWebp() {
  if (!stkSourceImage) return alert('Please upload an image first!');
  const dataUrl = await exportStickerWebpDataUrl();
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `sticker_${Date.now()}.webp`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function loadSavedStickersCatalog() {
  let list = [];
  try {
    const res = await fetch('/api/stickers').then(r => r.json());
    if (res.ok && Array.isArray(res.stickers) && res.stickers.length > 0) {
      list = res.stickers;
    }
  } catch (e) {}

  if (!list.length) {
    try { list = JSON.parse(localStorage.getItem('wa_saved_stickers') || '[]'); } catch (_) {}
  }

  renderStickerCatalogGrid(list);

  // Also populate Campaign Step 1 sticker grid
  const campGrid = document.getElementById('camp-saved-stickers-grid');
  const campCount = document.getElementById('camp-saved-stickers-count');
  if (campCount) campCount.textContent = list.length;
  if (campGrid) {
    if (!list.length) {
      campGrid.innerHTML = '<div style="text-align:center; font-size:11px; color:var(--txt3); grid-column:1/-1; padding:12px;">No stickers in library yet. Create one in the Sticker Studio tab!</div>';
    } else {
      campGrid.innerHTML = list.map(s => `
        <div onclick='selectStickerForCampaign(${JSON.stringify(s).replace(/'/g, "&apos;")})' style="background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:6px; cursor:pointer; text-align:center; transition:transform 0.15s, border-color 0.15s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'" title="${escapeHtml(s.name)}">
          <div style="width:100%; height:55px; display:flex; align-items:center; justify-content:center; background: repeating-conic-gradient(rgba(0,0,0,0.06) 0% 25%, transparent 0% 50%) 50% / 10px 10px; border-radius:6px; overflow:hidden;">
            <img src="${s.base64}" style="width:100%; height:100%; object-fit:contain;" alt="Sticker">
          </div>
          <div style="font-size:10px; color:var(--txt); margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600;">${escapeHtml(s.name)}</div>
        </div>
      `).join('');
    }
  }
}

function renderStickerCatalogGrid(list) {
  const grid = document.getElementById('stk-catalog-grid');
  if (!grid) return;
  if (!list || !list.length) {
    grid.innerHTML = '<div style="text-align:center; color:var(--txt3); grid-column:1/-1; padding:30px;">No saved stickers yet. Design one above and click "Save to Library"!</div>';
    return;
  }

  grid.innerHTML = list.map(s => `
    <div style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:10px; display:flex; flex-direction:column; gap:8px;">
      <div style="width:100%; height:110px; background: repeating-conic-gradient(rgba(0,0,0,0.06) 0% 25%, transparent 0% 50%) 50% / 12px 12px; border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--border);">
        <img src="${s.base64}" style="width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2));" alt="Sticker">
      </div>
      <div style="font-size:12px; font-weight:700; color:var(--txt); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(s.name)}</div>
      <div style="display:flex; gap:4px; margin-top:auto;">
        <button type="button" class="btn btn-primary btn-xs" onclick='selectStickerForCampaign(${JSON.stringify(s).replace(/'/g, "&apos;")}); switchTab("tab-campaign");' style="flex:1; font-size:10.5px;" title="Use in Campaign">
          <i class="fas fa-paper-plane"></i> Send
        </button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="downloadStickerDirect('${s.base64}', '${escapeHtml(s.name)}')" title="Download WebP">
          <i class="fas fa-download"></i>
        </button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="deleteStickerFromCatalog('${s.id}')" style="color:var(--red);" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

async function deleteStickerFromCatalog(id) {
  if (!confirm('Delete this sticker from your library?')) return;
  try {
    await fetch(`/api/stickers/${id}`, { method: 'DELETE' });
  } catch (e) {}

  let localList = [];
  try { localList = JSON.parse(localStorage.getItem('wa_saved_stickers') || '[]'); } catch (_) {}
  localList = localList.filter(s => s.id !== id);
  localStorage.setItem('wa_saved_stickers', JSON.stringify(localList));

  loadSavedStickersCatalog();
}

function downloadStickerDirect(b64, name) {
  const a = document.createElement('a');
  a.href = b64;
  a.download = `${(name || 'sticker').replace(/[^a-zA-Z0-9]/g, '_')}.webp`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function selectStickerForCampaign(sticker) {
  addStickerToCampaignMedia(sticker.name || 'sticker', sticker.base64);
}

function addStickerToCampaignMedia(name, base64) {
  if (typeof campPickedFiles === 'undefined') window.campPickedFiles = [];
  const arr = base64.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while(n--) { u8arr[n] = bstr.charCodeAt(n); }
  const file = new File([u8arr], name.replace(/[^a-zA-Z0-9]/g, '_') + '.webp', {type: mime});
  
  const entry = {
    id: 'stk_' + Date.now(),
    file: file,
    type: 'sticker',
    previewReady: true,
    previewUrl: base64,
    caption: '',
    captionIdx: 0,
    captionSource: 'none'
  };
  campPickedFiles.push(entry);
  if (typeof renderCampFileList === 'function') renderCampFileList();
  if (typeof updateLivePhonePreview === 'function') updateLivePhonePreview();
  if (typeof updateCampaignSummary === 'function') updateCampaignSummary();
  switchTab('tab-campaign');
}

function clearCampaignSticker() {
  activeCampaignSticker = null;
  updateSelectedStickerUI();
  const inp = document.getElementById('camp-sticker-upload-input');
  if (inp) inp.value = '';
  updateLivePhonePreview();
}

function handleCampaignStickerUpload(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const rawDataUrl = e.target.result;
    const img = new Image();
    img.onload = () => {
      const cvs = document.createElement('canvas');
      cvs.width = 512;
      cvs.height = 512;
      const ctx = cvs.getContext('2d');
      ctx.clearRect(0, 0, 512, 512);
      const scale = Math.min(512 / img.width, 512 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (512 - w) / 2;
      const y = (512 - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      const webpDataUrl = cvs.toDataURL('image/webp', 0.9);
      activeCampaignSticker = {
        id: `stk_upload_${Date.now()}`,
        name: file.name.replace(/\\.[^/.]+$/, ""),
        base64: webpDataUrl,
        fileName: 'sticker.webp'
      };
      updateSelectedStickerUI();
      updateLivePhonePreview();
    };
    img.src = rawDataUrl;
  };
  reader.readAsDataURL(file);
}

function getSelectedCampaignSticker() {
  return activeCampaignSticker;
}