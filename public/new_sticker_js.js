/* ════════════════════════════════════════════════════════════════
   STICKERS STUDIO: PRO DESKTOP MULTI-LAYER & AI ENGINE
════════════════════════════════════════════════════════════════ */
let stkSourceImage = null;
let stkOffscreenCanvas = null; // High-res editable image layer with pixel modifications (eraser/wand)
let stkOffscreenCtx = null;

// Tool & Transform States
let stkCurrentTool = 'select'; // 'select', 'crop', 'magic', 'eraser', 'brush', 'text'
let stkShape = 'original'; // 'original', 'circle', 'rounded', 'heart', 'star', 'badge'
let stkBorderEnabled = true;
let stkBorderWidth = 8;
let stkBorderColor = '#ffffff';

// Image Transform (pan, zoom, rotation, flip)
let stkImgTransform = {
  x: 256,
  y: 256,
  scale: 1.0,
  rotation: 0, // in degrees
  flipH: 1,
  flipV: 1,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0
};

// Color Filters & FX
let stkFilters = {
  brightness: 100,
  contrast: 100,
  saturate: 100
};

// Multi-Text / Meme / Emoji Overlays
let stkLayers = [
  // Example layer format: { id, type:'text', text:'HELLO', x:256, y:440, fontSize:38, fontFamily:'Impact', fill:'#ffffff', stroke:'#000000', strokeWidth:4 }
];
let stkActiveLayerId = null;
let stkLayerDragging = null;

// Default legacy bindings
let stkText = '';
let stkFontSize = 38;
let stkFontFamily = 'Impact';
let stkTextColor = '#ffffff';
let stkStrokeColor = '#000000';
let stkStrokeWidth = 4;
let stkTextPos = 'bottom';
let activeCampaignSticker = null;

// History Undo / Redo Stacks (Max 12 states)
const STK_HISTORY_MAX = 12;
let stkUndoStack = [];
let stkRedoStack = [];

function stkPushHistory() {
  if (!stkOffscreenCanvas) return;
  try {
    const snap = {
      imgData: stkOffscreenCtx.getImageData(0, 0, stkOffscreenCanvas.width, stkOffscreenCanvas.height),
      transform: { ...stkImgTransform },
      shape: stkShape,
      borderEnabled: stkBorderEnabled,
      borderWidth: stkBorderWidth,
      borderColor: stkBorderColor,
      filters: { ...stkFilters },
      layers: JSON.parse(JSON.stringify(stkLayers))
    };
    stkUndoStack.push(snap);
    if (stkUndoStack.length > STK_HISTORY_MAX) stkUndoStack.shift();
    stkRedoStack = []; // clear redo on new action
    stkUpdateHistoryBtns();
  } catch (e) {
    console.warn('History push failed', e);
  }
}

function stkUndo() {
  if (!stkUndoStack.length) return;
  try {
    // Current state into redo
    const currentSnap = {
      imgData: stkOffscreenCtx.getImageData(0, 0, stkOffscreenCanvas.width, stkOffscreenCanvas.height),
      transform: { ...stkImgTransform },
      shape: stkShape,
      borderEnabled: stkBorderEnabled,
      borderWidth: stkBorderWidth,
      borderColor: stkBorderColor,
      filters: { ...stkFilters },
      layers: JSON.parse(JSON.stringify(stkLayers))
    };
    stkRedoStack.push(currentSnap);

    const prev = stkUndoStack.pop();
    stkOffscreenCtx.putImageData(prev.imgData, 0, 0);
    stkImgTransform = { ...prev.transform };
    stkShape = prev.shape;
    stkBorderEnabled = prev.borderEnabled;
    stkBorderWidth = prev.borderWidth;
    stkBorderColor = prev.borderColor;
    stkFilters = { ...prev.filters };
    stkLayers = prev.layers;

    stkUpdateHistoryBtns();
    drawStickerCanvas();
  } catch (e) {
    console.error('Undo failed', e);
  }
}

function stkRedo() {
  if (!stkRedoStack.length) return;
  try {
    const snap = stkRedoStack.pop();
    stkUndoStack.push({
      imgData: stkOffscreenCtx.getImageData(0, 0, stkOffscreenCanvas.width, stkOffscreenCanvas.height),
      transform: { ...stkImgTransform },
      shape: stkShape,
      borderEnabled: stkBorderEnabled,
      borderWidth: stkBorderWidth,
      borderColor: stkBorderColor,
      filters: { ...stkFilters },
      layers: JSON.parse(JSON.stringify(stkLayers))
    });

    stkOffscreenCtx.putImageData(snap.imgData, 0, 0);
    stkImgTransform = { ...snap.transform };
    stkShape = snap.shape;
    stkBorderEnabled = snap.borderEnabled;
    stkBorderWidth = snap.borderWidth;
    stkBorderColor = snap.borderColor;
    stkFilters = { ...snap.filters };
    stkLayers = snap.layers;

    stkUpdateHistoryBtns();
    drawStickerCanvas();
  } catch (e) {
    console.error('Redo failed', e);
  }
}

function stkUpdateHistoryBtns() {
  const u = document.getElementById('stk-btn-undo');
  const r = document.getElementById('stk-btn-redo');
  if (u) u.style.opacity = stkUndoStack.length ? '1' : '0.4';
  if (r) r.style.opacity = stkRedoStack.length ? '1' : '0.4';
}

function stkResetAll() {
  if (!stkSourceImage && !stkLayers.length) return;
  if (!confirm('Start fresh with a blank canvas?')) return;
  stkSourceImage = null;
  stkOffscreenCanvas = null;
  stkOffscreenCtx = null;
  stkLayers = [];
  stkUndoStack = [];
  stkRedoStack = [];
  stkUpdateHistoryBtns();
  clearStickerText();
  drawStickerCanvas();
}

// ── Upload & Offscreen Initialization ──
function handleStickerImageUpload(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      stkSourceImage = img;

      // Create an offscreen buffer at standard 512x512
      stkOffscreenCanvas = document.createElement('canvas');
      stkOffscreenCanvas.width = 512;
      stkOffscreenCanvas.height = 512;
      stkOffscreenCtx = stkOffscreenCanvas.getContext('2d', { willReadFrequently: true });

      // Scale to fit neatly inside 512x512 initially
      const pad = 30;
      const s = Math.min((512 - pad * 2) / img.width, (512 - pad * 2) / img.height);
      const dw = Math.round(img.width * s);
      const dh = Math.round(img.height * s);
      const dx = Math.round((512 - dw) / 2);
      const dy = Math.round((512 - dh) / 2);

      stkOffscreenCtx.clearRect(0, 0, 512, 512);
      stkOffscreenCtx.drawImage(img, dx, dy, dw, dh);

      stkImgTransform = {
        x: 256,
        y: 256,
        scale: 1.0,
        rotation: 0,
        flipH: 1,
        flipV: 1,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0
      };

      stkUndoStack = [];
      stkRedoStack = [];
      stkPushHistory();
      drawStickerCanvas();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Master Render Loop ──
function drawStickerCanvas() {
  const canvas = document.getElementById('stk-editor-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);

  if (!stkSourceImage && !stkLayers.length) {
    // Elegant Empty Workspace State
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, 0, 512, 512);
    ctx.font = '68px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎨', 256, 190);
    ctx.font = 'bold 20px "Inter", sans-serif';
    ctx.fillStyle = '#4fc3c6';
    ctx.fillText('WhatsApp Pro Sticker Studio', 256, 260);
    ctx.font = '13.5px "Inter", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Click "Import Photo" or select Emojis / Text on left', 256, 295);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Automatic 512x512 WebP & Transparency Supported', 256, 325);
    ctx.restore();
    return;
  }

  // Pre-render image layer with transform, shape and filters
  if (stkOffscreenCanvas) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 512;
    tempCanvas.height = 512;
    const tCtx = tempCanvas.getContext('2d');

    // Apply color filters
    tCtx.filter = `brightness(${stkFilters.brightness}%) contrast(${stkFilters.contrast}%) saturate(${stkFilters.saturate}%)`;

    // Draw transformed image
    tCtx.save();
    tCtx.translate(stkImgTransform.x, stkImgTransform.y);
    tCtx.rotate((stkImgTransform.rotation * Math.PI) / 180);
    tCtx.scale(stkImgTransform.scale * stkImgTransform.flipH, stkImgTransform.scale * stkImgTransform.flipV);
    tCtx.drawImage(stkOffscreenCanvas, -256, -256, 512, 512);
    tCtx.restore();

    // Shape Clipping mask
    if (stkShape !== 'original') {
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.fillStyle = '#ffffff';
      drawShapePath(tCtx, stkShape, 256, 256, 470, 470);
      tCtx.fill();
      tCtx.globalCompositeOperation = 'source-over';
    }

    // 1. Draw Die-Cut Border around the image shape
    if (stkBorderEnabled && stkBorderWidth > 0) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = stkBorderColor || '#ffffff';
      ctx.strokeStyle = stkBorderColor || '#ffffff';
      ctx.lineWidth = stkBorderWidth * 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (stkShape !== 'original') {
        drawShapePath(ctx, stkShape, 256, 256, 470 + stkBorderWidth, 470 + stkBorderWidth);
        ctx.fill();
        ctx.stroke();
      } else {
        // Outline bounding alpha hull roughly or draw clean stroke around transformed content
        ctx.drawImage(tempCanvas, 0, 0);
      }
      ctx.restore();
    }

    // Draw the image content
    ctx.drawImage(tempCanvas, 0, 0);
  }

  // 2. Draw Multi-layers (Texts & Emojis)
  for (const layer of stkLayers) {
    ctx.save();
    if (layer.type === 'text') {
      ctx.font = `bold ${layer.fontSize}px ${layer.fontFamily || 'Impact'}, "Arial Black", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Thick stroke
      ctx.strokeStyle = layer.stroke || '#000000';
      ctx.lineWidth = (layer.strokeWidth || 4) * 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(layer.text, layer.x, layer.y);

      // Fill
      ctx.fillStyle = layer.fill || '#ffffff';
      ctx.fillText(layer.text, layer.x, layer.y);

      // Active Selection Box
      if (layer.id === stkActiveLayerId && stkCurrentTool === 'select') {
        ctx.strokeStyle = '#4fc3c6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        const m = ctx.measureText(layer.text);
        const w = m.width + 16;
        const h = layer.fontSize * 1.3;
        ctx.strokeRect(layer.x - w / 2, layer.y - h / 2, w, h);
      }
    } else if (layer.type === 'emoji') {
      ctx.font = `${layer.fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(layer.text, layer.x, layer.y);

      if (layer.id === stkActiveLayerId && stkCurrentTool === 'select') {
        ctx.strokeStyle = '#4fc3c6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        const s = layer.fontSize + 12;
        ctx.strokeRect(layer.x - s / 2, layer.y - s / 2, s, s);
      }
    }
    ctx.restore();
  }

  // 3. Fallback Legacy Single Text Input
  if (stkText && stkText.trim() && !stkLayers.some(l => l.text === stkText.trim())) {
    ctx.save();
    ctx.font = `bold ${stkFontSize}px ${stkFontFamily || 'Impact'}, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let tx = 256;
    let ty = 440;
    if (stkTextPos === 'top') ty = 70;
    if (stkTextPos === 'center') ty = 256;

    ctx.strokeStyle = stkStrokeColor || '#000000';
    ctx.lineWidth = (stkStrokeWidth || 4) * 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(stkText.toUpperCase(), tx, ty);

    ctx.fillStyle = stkTextColor || '#ffffff';
    ctx.fillText(stkText.toUpperCase(), tx, ty);
    ctx.restore();
  }
}

// ── Shape Path Generator ──
function drawShapePath(ctx, shape, cx, cy, w, h) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2);
  } else if (shape === 'rounded') {
    roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, 36);
  } else if (shape === 'heart') {
    const hw = w * 0.45;
    const hh = h * 0.45;
    ctx.moveTo(cx, cy + hh * 0.7);
    ctx.bezierCurveTo(cx - hw * 1.3, cy - hh * 0.3, cx - hw * 1.1, cy - hh * 1.1, cx, cy - hh * 0.4);
    ctx.bezierCurveTo(cx + hw * 1.1, cy - hh * 1.1, cx + hw * 1.3, cy - hh * 0.3, cx, cy + hh * 0.7);
  } else if (shape === 'star') {
    const spikes = 5;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * 0.5;
    let rot = (Math.PI / 2) * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerR;
      y = cy + Math.sin(rot) * outerR;
      ctx.lineTo(x, y);
      rot += step;
      x = cx + Math.cos(rot) * innerR;
      y = cy + Math.sin(rot) * innerR;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
  } else if (shape === 'badge') {
    const points = 12;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * 0.88;
    const step = (Math.PI * 2) / points;
    for (let i = 0; i < points; i++) {
      const a1 = i * step;
      const a2 = a1 + step / 2;
      ctx.lineTo(cx + Math.cos(a1) * outerR, cy + Math.sin(a1) * outerR);
      ctx.lineTo(cx + Math.cos(a2) * innerR, cy + Math.sin(a2) * innerR);
    }
  } else {
    ctx.rect(cx - w / 2, cy - h / 2, w, h);
  }
  ctx.closePath();
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

// ── Interactive Tool Switcher ──
function stkSetTool(tool) {
  stkCurrentTool = tool;
  document.querySelectorAll('.stk-tool-btn').forEach(btn => {
    btn.className = (btn.getAttribute('data-tool') === tool) ? 'btn btn-sm btn-primary stk-tool-btn active' : 'btn btn-sm btn-ghost stk-tool-btn';
  });

  // Toggle Subpanels
  document.querySelectorAll('.stk-tool-subpanel').forEach(p => p.style.display = 'none');
  const optMap = {
    'magic': 'stk-opt-magic',
    'eraser': 'stk-opt-eraser',
    'brush': 'stk-opt-eraser',
    'crop': 'stk-opt-crop',
    'text': 'stk-opt-text'
  };
  const targetId = optMap[tool];
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) el.style.display = 'block';
  }

  const hud = document.getElementById('stk-hud-tool');
  if (hud) {
    const names = { select: 'Select / Move', crop: 'Shape Mask', magic: 'Magic Wand Bg Remover', eraser: 'Eraser', brush: 'Restore Brush', text: 'Text & Meme' };
    hud.textContent = 'Tool: ' + (names[tool] || tool);
  }

  const container = document.getElementById('stk-canvas-container');
  if (container) {
    if (tool === 'select') container.style.cursor = 'grab';
    else if (tool === 'eraser' || tool === 'brush') container.style.cursor = 'cell';
    else if (tool === 'magic') container.style.cursor = 'crosshair';
    else container.style.cursor = 'default';
  }
  drawStickerCanvas();
}

// ── Magic Wand Background Erase (BFS Flood Fill) ──
function stkMagicWandAt(startX, startY, tolerance = 32) {
  if (!stkOffscreenCanvas || !stkOffscreenCtx) return;
  stkPushHistory();

  const imgData = stkOffscreenCtx.getImageData(0, 0, 512, 512);
  const data = imgData.data;

  // Convert canvas coords (0-512) into untransformed image space if needed
  const targetIdx = (Math.round(startY) * 512 + Math.round(startX)) * 4;
  const targetR = data[targetIdx];
  const targetG = data[targetIdx + 1];
  const targetB = data[targetIdx + 2];
  const targetA = data[targetIdx + 3];

  if (targetA === 0) return; // already transparent

  const visited = new Uint8Array(512 * 512);
  const queue = [Math.round(startX), Math.round(startY)];
  visited[Math.round(startY) * 512 + Math.round(startX)] = 1;

  function matchColor(idx) {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (a === 0) return false;
    const diff = Math.max(Math.abs(r - targetR), Math.abs(g - targetG), Math.abs(b - targetB));
    return diff <= tolerance;
  }

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const idx = (y * 512 + x) * 4;

    // Make transparent
    data[idx + 3] = 0;

    // Neighbors: Up, Down, Left, Right
    const neighbors = [
      [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
    ];
    for (let i = 0; i < 4; i++) {
      const nx = neighbors[i][0];
      const ny = neighbors[i][1];
      if (nx >= 0 && nx < 512 && ny >= 0 && ny < 512) {
        const vPos = ny * 512 + nx;
        if (!visited[vPos]) {
          visited[vPos] = 1;
          const nIdx = vPos * 4;
          if (matchColor(nIdx)) {
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  stkOffscreenCtx.putImageData(imgData, 0, 0);
  drawStickerCanvas();
}

// Auto-clean corners (detect typical solid white or grey background)
function stkAutoRemoveCorners() {
  if (!stkOffscreenCanvas) return;
  const tol = parseInt(document.getElementById('stk-magic-tol')?.value) || 35;
  stkMagicWandAt(4, 4, tol);
  stkMagicWandAt(508, 4, tol);
  stkMagicWandAt(4, 508, tol);
  stkMagicWandAt(508, 508, tol);
}

// ── Manual Eraser & Restore Brush ──
function stkEraseBrushAt(x, y, isRestore = false) {
  if (!stkOffscreenCanvas || !stkOffscreenCtx) return;
  const brushSize = parseInt(document.getElementById('stk-brush-size')?.value) || 25;

  stkOffscreenCtx.save();
  if (isRestore) {
    // Restore from original image
    stkOffscreenCtx.globalCompositeOperation = 'source-over';
    stkOffscreenCtx.beginPath();
    stkOffscreenCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    stkOffscreenCtx.clip();
    if (stkSourceImage) {
      // Re-draw initial proportion
      const pad = 30;
      const s = Math.min((512 - pad * 2) / stkSourceImage.width, (512 - pad * 2) / stkSourceImage.height);
      const dw = Math.round(stkSourceImage.width * s);
      const dh = Math.round(stkSourceImage.height * s);
      const dx = Math.round((512 - dw) / 2);
      const dy = Math.round((512 - dh) / 2);
      stkOffscreenCtx.drawImage(stkSourceImage, dx, dy, dw, dh);
    }
  } else {
    // Erase to transparency
    stkOffscreenCtx.globalCompositeOperation = 'destination-out';
    stkOffscreenCtx.beginPath();
    stkOffscreenCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    stkOffscreenCtx.fill();
  }
  stkOffscreenCtx.restore();
  drawStickerCanvas();
}

// ── Interactive Mouse / Touch Events ──
let stkIsInteracting = false;

function initStickerCanvasEvents() {
  const canvas = document.getElementById('stk-editor-canvas');
  if (!canvas) return;

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = 512 / rect.width;
    const scaleY = 512 / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  canvas.onmousedown = (e) => {
    const pt = getCanvasCoords(e);
    stkIsInteracting = true;

    if (stkCurrentTool === 'magic') {
      const tol = parseInt(document.getElementById('stk-magic-tol')?.value) || 32;
      stkMagicWandAt(pt.x, pt.y, tol);
      return;
    }

    if (stkCurrentTool === 'eraser' || stkCurrentTool === 'brush') {
      stkPushHistory();
      stkEraseBrushAt(pt.x, pt.y, stkCurrentTool === 'brush');
      return;
    }

    if (stkCurrentTool === 'select' || stkCurrentTool === 'text') {
      // Check if clicked on a text / emoji layer (top to bottom)
      let foundLayer = null;
      for (let i = stkLayers.length - 1; i >= 0; i--) {
        const l = stkLayers[i];
        const dist = Math.hypot(pt.x - l.x, pt.y - l.y);
        if (dist < 40) {
          foundLayer = l;
          break;
        }
      }

      if (foundLayer) {
        stkActiveLayerId = foundLayer.id;
        stkLayerDragging = {
          layer: foundLayer,
          startX: pt.x,
          startY: pt.y,
          origX: foundLayer.x,
          origY: foundLayer.y
        };
        drawStickerCanvas();
        return;
      }

      // If clicked on image background in select tool, pan image
      if (stkCurrentTool === 'select') {
        stkActiveLayerId = null;
        stkImgTransform.isDragging = true;
        stkImgTransform.dragStartX = pt.x - stkImgTransform.x;
        stkImgTransform.dragStartY = pt.y - stkImgTransform.y;
      }
    }
  };

  window.addEventListener('mousemove', (e) => {
    if (!stkIsInteracting) return;
    const canvasEl = document.getElementById('stk-editor-canvas');
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const pt = {
      x: (e.clientX - rect.left) * (512 / rect.width),
      y: (e.clientY - rect.top) * (512 / rect.height)
    };

    if (stkCurrentTool === 'eraser' || stkCurrentTool === 'brush') {
      stkEraseBrushAt(pt.x, pt.y, stkCurrentTool === 'brush');
      return;
    }

    if (stkLayerDragging) {
      const dx = pt.x - stkLayerDragging.startX;
      const dy = pt.y - stkLayerDragging.startY;
      stkLayerDragging.layer.x = Math.round(stkLayerDragging.origX + dx);
      stkLayerDragging.layer.y = Math.round(stkLayerDragging.origY + dy);
      drawStickerCanvas();
      return;
    }

    if (stkImgTransform.isDragging) {
      stkImgTransform.x = Math.round(pt.x - stkImgTransform.dragStartX);
      stkImgTransform.y = Math.round(pt.y - stkImgTransform.dragStartY);
      drawStickerCanvas();
    }
  });

  window.addEventListener('mouseup', () => {
    if (stkIsInteracting) {
      stkIsInteracting = false;
      stkLayerDragging = null;
      stkImgTransform.isDragging = false;
    }
  });

  // Wheel zoom for image
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (stkCurrentTool !== 'select') return;
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    stkImgTransform.scale = Math.max(0.2, Math.min(3.5, stkImgTransform.scale + delta));
    drawStickerCanvas();
  }, { passive: false });
}

// ── Multi-Layer Text & Emoji Handlers ──
function stkAddTextLayer() {
  const input = document.getElementById('stk-text-input');
  const txt = (input?.value || '').trim();
  if (!txt) return;

  const newLayer = {
    id: 'layer_' + Date.now(),
    type: 'text',
    text: txt,
    x: 256,
    y: stkLayers.length ? (200 + stkLayers.length * 50) : 420,
    fontSize: stkFontSize,
    fontFamily: stkFontFamily,
    fill: stkTextColor,
    stroke: stkStrokeColor,
    strokeWidth: stkStrokeWidth
  };

  stkLayers.push(newLayer);
  stkActiveLayerId = newLayer.id;
  input.value = '';
  stkPushHistory();
  drawStickerCanvas();
}

function stkAddEmoji(emoji) {
  const newLayer = {
    id: 'emoji_' + Date.now(),
    type: 'emoji',
    text: emoji,
    x: 256 + (Math.random() * 40 - 20),
    y: 256 + (Math.random() * 40 - 20),
    fontSize: 54
  };
  stkLayers.push(newLayer);
  stkActiveLayerId = newLayer.id;
  stkPushHistory();
  drawStickerCanvas();
}

function stkRotateImage(deg) {
  stkPushHistory();
  stkImgTransform.rotation = (stkImgTransform.rotation + deg) % 360;
  drawStickerCanvas();
}

function stkFlipImage(axis) {
  stkPushHistory();
  if (axis === 'h') stkImgTransform.flipH *= -1;
  if (axis === 'v') stkImgTransform.flipV *= -1;
  drawStickerCanvas();
}

function stkFitCanvas() {
  stkPushHistory();
  stkImgTransform.x = 256;
  stkImgTransform.y = 256;
  stkImgTransform.scale = 1.0;
  stkImgTransform.rotation = 0;
  stkImgTransform.flipH = 1;
  stkImgTransform.flipV = 1;
  drawStickerCanvas();
}

// ── Shape & Border Settings ──
function setStickerShape(shape) {
  stkShape = shape;
  document.querySelectorAll('.stk-shape-btn').forEach(btn => {
    btn.className = (btn.getAttribute('data-shape') === shape) ? 'btn btn-xs btn-primary stk-shape-btn active' : 'btn btn-xs btn-ghost stk-shape-btn';
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

function onStickerBorderColor(color) {
  stkBorderColor = color || '#ffffff';
  drawStickerCanvas();
}

// ── Text & Font Settings ──
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

function stkOnFontFamily(font) {
  stkFontFamily = font;
  if (stkActiveLayerId) {
    const l = stkLayers.find(x => x.id === stkActiveLayerId);
    if (l && l.type === 'text') l.fontFamily = font;
  }
  drawStickerCanvas();
}

function onStickerFontSize(val) {
  stkFontSize = parseInt(val) || 38;
  const lbl = document.getElementById('stk-font-size-val');
  if (lbl) lbl.textContent = stkFontSize + 'px';
  if (stkActiveLayerId) {
    const l = stkLayers.find(x => x.id === stkActiveLayerId);
    if (l) l.fontSize = stkFontSize;
  }
  drawStickerCanvas();
}

function onStickerTextColor(val) {
  stkTextColor = val;
  if (stkActiveLayerId) {
    const l = stkLayers.find(x => x.id === stkActiveLayerId);
    if (l) l.fill = val;
  }
  drawStickerCanvas();
}

function onStickerStrokeColor(val) {
  stkStrokeColor = val;
  if (stkActiveLayerId) {
    const l = stkLayers.find(x => x.id === stkActiveLayerId);
    if (l) l.stroke = val;
  }
  drawStickerCanvas();
}

// ── FX & Filters ──
function stkOnFilterChange() {
  const b = parseInt(document.getElementById('stk-fx-bright')?.value) || 100;
  const c = parseInt(document.getElementById('stk-fx-contrast')?.value) || 100;
  const s = parseInt(document.getElementById('stk-fx-sat')?.value) || 100;
  stkFilters.brightness = b;
  stkFilters.contrast = c;
  stkFilters.saturate = s;

  document.getElementById('stk-fx-bright-val').textContent = b + '%';
  document.getElementById('stk-fx-contrast-val').textContent = c + '%';
  document.getElementById('stk-fx-sat-val').textContent = s + '%';
  drawStickerCanvas();
}

function stkApplyPresetFilter(preset) {
  if (preset === 'normal') {
    stkFilters = { brightness: 100, contrast: 100, saturate: 100 };
  } else if (preset === 'vibrant') {
    stkFilters = { brightness: 108, contrast: 115, saturate: 145 };
  } else if (preset === 'bw') {
    stkFilters = { brightness: 100, contrast: 125, saturate: 0 };
  } else if (preset === 'vintage') {
    stkFilters = { brightness: 95, contrast: 90, saturate: 75 };
  }
  document.getElementById('stk-fx-bright').value = stkFilters.brightness;
  document.getElementById('stk-fx-contrast').value = stkFilters.contrast;
  document.getElementById('stk-fx-sat').value = stkFilters.saturate;
  stkOnFilterChange();
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
    container.style.background = 'repeating-conic-gradient(rgba(0,0,0,0.08) 0% 25%, transparent 0% 50%) 50% / 16px 16px';
  }
}

// ── Export, Library & Campaign Direct Injection ──
async function exportStickerWebpDataUrl() {
  const canvas = document.getElementById('stk-editor-canvas');
  if (!canvas) return null;
  drawStickerCanvas();
  return canvas.toDataURL('image/webp', 0.9);
}

async function saveStickerToCatalog() {
  if (!stkSourceImage && !stkLayers.length) return alert('Please design a sticker first!');
  const dataUrl = await exportStickerWebpDataUrl();
  const name = (document.getElementById('stk-text-input')?.value || '').trim() || (stkLayers[0]?.text) || 'Sticker ' + new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const newSticker = {
    id: `stk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    base64: dataUrl,
    createdAt: new Date().toISOString()
  };

  try {
    await fetch('/api/stickers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSticker)
    });
  } catch (e) {
    console.warn('Saving sticker to localStorage fallback');
  }

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
  if (!stkSourceImage && !stkLayers.length) return alert('Please design a sticker first!');
  const dataUrl = await exportStickerWebpDataUrl();
  const name = (document.getElementById('stk-text-input')?.value || '').trim() || (stkLayers[0]?.text) || 'Custom Sticker';
  addStickerToCampaignMedia(name, dataUrl);
}

async function downloadStickerWebp() {
  if (!stkSourceImage && !stkLayers.length) return alert('Please design a sticker first!');
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

  // Sync with Campaign Step 1 sticker selector
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
    grid.innerHTML = '<div style="text-align:center; color:var(--txt3); font-size:11px; grid-column:1/-1; padding:24px;">No saved stickers yet. Design one above and click "Save to Library"!</div>';
    return;
  }

  grid.innerHTML = list.map(s => `
    <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:8px; display:flex; flex-direction:column; gap:6px;">
      <div style="width:100%; height:75px; background: repeating-conic-gradient(rgba(0,0,0,0.06) 0% 25%, transparent 0% 50%) 50% / 10px 10px; border-radius:6px; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--border);">
        <img src="${s.base64}" style="width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2));" alt="Sticker">
      </div>
      <div style="font-size:10.5px; font-weight:700; color:var(--txt); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(s.name)}</div>
      <div style="display:flex; gap:3px; margin-top:auto;">
        <button type="button" class="btn btn-primary btn-xs" onclick='selectStickerForCampaign(${JSON.stringify(s).replace(/'/g, "&apos;")}); switchTab("tab-campaign");' style="flex:1; padding:2px 4px; font-size:9.5px;" title="Use in Campaign">
          <i class="fas fa-paper-plane"></i> Send
        </button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="downloadStickerDirect('${s.base64}', '${escapeHtml(s.name)}')" style="padding:2px 4px; font-size:9.5px;" title="Download WebP">
          <i class="fas fa-download"></i>
        </button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="deleteStickerFromCatalog('${s.id}')" style="color:var(--red); padding:2px 4px; font-size:9.5px;" title="Delete">
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
        name: file.name.replace(/\.[^/.]+$/, ""),
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

// Hook canvas mouse events on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initStickerCanvasEvents();
});
setTimeout(() => {
  initStickerCanvasEvents();
}, 600);