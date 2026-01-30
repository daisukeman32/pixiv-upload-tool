(function () {
  'use strict';

  var MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var STORAGE_KEY = 'pixivoon_used_files';

  // ============================================================
  // Usage history (localStorage)
  // ============================================================
  function getUsedFiles() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return new Set(arr);
    } catch (e) {
      return new Set();
    }
  }

  function addUsedFiles(filenames) {
    var used = getUsedFiles();
    filenames.forEach(function (name) { used.add(name); });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(used)));
  }

  function clearUsedFiles() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ============================================================
  // State
  // ============================================================
  var allFiles = [];           // all loaded files
  var selectedIndices = [];    // indices into allFiles (up to 10)
  var imageData = [];          // { origCanvas, mosaicCanvas, faceBox, undoStack } per selected image
  var modelsLoaded = false;
  var lastZipBlob = null;

  // ============================================================
  // DOM refs
  // ============================================================
  var dropZone = document.getElementById('drop-zone');
  var fileInput = document.getElementById('file-input');
  var loadedCount = document.getElementById('loaded-count');
  var allThumbnails = document.getElementById('all-thumbnails');
  var selectCountInput = document.getElementById('select-count');
  var randomSelectBtn = document.getElementById('random-select-btn');
  var clearAllBtn = document.getElementById('clear-all-btn');
  var selectedCount = document.getElementById('selected-count');
  var toStep2Btn = document.getElementById('to-step2-btn');

  var step2Progress = document.getElementById('step2-progress');
  var step2ProgressFill = document.getElementById('step2-progress-fill');
  var step2ProgressText = document.getElementById('step2-progress-text');
  var mosaicGrid = document.getElementById('mosaic-grid');
  var backToStep1 = document.getElementById('back-to-step1');
  var skipMosaicBtn = document.getElementById('skip-mosaic-btn');
  var toStep3Btn = document.getElementById('to-step3-btn');

  var editorOverlay = document.getElementById('editor-overlay');
  var editorTitle = document.getElementById('editor-title');
  var editorCanvas = document.getElementById('editor-canvas');
  var editorReset = document.getElementById('editor-reset');
  var editorUndo = document.getElementById('editor-undo');
  var editorDone = document.getElementById('editor-done');
  var editorPrev = document.getElementById('editor-prev');
  var editorSkip = document.getElementById('editor-skip');
  var brushCursor = document.getElementById('brush-cursor');
  var brushModeSelect = document.getElementById('brush-mode');
  var brushSizeInput = document.getElementById('brush-size');
  var brushSizeVal = document.getElementById('brush-size-val');
  var effectStrengthInput = document.getElementById('effect-strength');
  var effectStrengthVal = document.getElementById('effect-strength-val');

  var step3Progress = document.getElementById('step3-progress');
  var step3ProgressFill = document.getElementById('step3-progress-fill');
  var step3ProgressText = document.getElementById('step3-progress-text');
  var resultList = document.getElementById('result-list');
  var downloadBtn = document.getElementById('download-btn');
  var restartBtn = document.getElementById('restart-btn');

  var themeToggle = document.getElementById('theme-toggle');
  var editorToolbar = document.getElementById('editor-toolbar');
  var clearHistoryBtn = document.getElementById('clear-history-btn');

  // ============================================================
  // Theme (toggle switch: checked = Day, unchecked = Night)
  // ============================================================
  themeToggle.addEventListener('change', function () {
    if (themeToggle.checked) {
      document.body.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.body.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  });
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
    themeToggle.checked = false;
  }

  // ============================================================
  // Step navigation
  // ============================================================
  function showStep(id) {
    document.querySelectorAll('.step').forEach(function (el) { el.hidden = true; });
    document.getElementById(id).hidden = false;
  }

  // ============================================================
  // Model preload (start immediately)
  // ============================================================
  function loadModels() {
    if (modelsLoaded) return Promise.resolve();
    return Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
    ]).then(function () {
      modelsLoaded = true;
    });
  }
  // Start loading in background
  loadModels().catch(function () {});

  // ============================================================
  // Step 1: Upload & Select
  // ============================================================
  dropZone.addEventListener('click', function () { fileInput.click(); });
  dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', function (e) {
    addFiles(e.target.files);
    fileInput.value = '';
  });

  function addFiles(files) {
    var arr = Array.from(files).filter(function (f) { return f.type.startsWith('image/'); });
    allFiles = allFiles.concat(arr);
    selectedIndices = [];
    renderStep1();
  }

  clearAllBtn.addEventListener('click', function () {
    allFiles = [];
    selectedIndices = [];
    renderStep1();
  });

  clearHistoryBtn.addEventListener('click', function () {
    clearUsedFiles();
    renderStep1();
  });

  function getMaxCount() {
    var v = parseInt(selectCountInput.value, 10);
    return (v > 0 && v <= 26) ? v : 10;
  }

  randomSelectBtn.addEventListener('click', function () {
    var max = getMaxCount();
    var usedFiles = getUsedFiles();
    // Exclude used files from random selection
    var indices = [];
    for (var i = 0; i < allFiles.length; i++) {
      if (!usedFiles.has(allFiles[i].name)) indices.push(i);
    }
    // Fisher-Yates shuffle
    for (var j = indices.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = indices[j]; indices[j] = indices[k]; indices[k] = tmp;
    }
    selectedIndices = indices.slice(0, max);
    selectedIndices.sort(function (a, b) { return a - b; });
    renderStep1();
  });

  function renderStep1() {
    var max = getMaxCount();
    var usedFiles = getUsedFiles();
    var usedCount = 0;

    loadedCount.textContent = '読み込んだ画像: ' + allFiles.length + '枚';
    randomSelectBtn.disabled = allFiles.length === 0;
    clearAllBtn.hidden = allFiles.length === 0;
    selectedCount.textContent = '選択中: ' + selectedIndices.length + '/' + max + '枚';
    toStep2Btn.disabled = selectedIndices.length === 0;

    allThumbnails.innerHTML = '';
    allFiles.forEach(function (file, i) {
      var isUsed = usedFiles.has(file.name);
      if (isUsed) usedCount++;

      var wrap = document.createElement('div');
      wrap.className = 'thumb-wrap';

      var img = document.createElement('img');
      img.className = 'sel-thumb';
      if (selectedIndices.indexOf(i) >= 0) img.classList.add('selected');
      if (isUsed) img.classList.add('used');
      img.src = URL.createObjectURL(file);
      img.alt = file.name;
      img.addEventListener('click', function () {
        var pos = selectedIndices.indexOf(i);
        if (pos >= 0) {
          selectedIndices.splice(pos, 1);
        } else if (selectedIndices.length < getMaxCount()) {
          selectedIndices.push(i);
          selectedIndices.sort(function (a, b) { return a - b; });
        }
        renderStep1();
      });

      wrap.appendChild(img);

      if (isUsed) {
        var mark = document.createElement('span');
        mark.className = 'used-mark';
        mark.textContent = '済';
        wrap.appendChild(mark);
      }

      allThumbnails.appendChild(wrap);
    });

    // Show used count if any
    if (usedCount > 0) {
      loadedCount.textContent += ' (使用済み: ' + usedCount + '枚)';
    }

    // Show clear history button if there's any history
    clearHistoryBtn.hidden = usedFiles.size === 0;
  }

  selectCountInput.addEventListener('change', function () {
    var max = getMaxCount();
    if (selectedIndices.length > max) {
      selectedIndices = selectedIndices.slice(0, max);
    }
    renderStep1();
  });

  // ============================================================
  // Step 1 → Step 2
  // ============================================================
  toStep2Btn.addEventListener('click', function () {
    showStep('step-2');
    startMosaicStep();
  });

  function startMosaicStep() {
    imageData = [];
    mosaicGrid.innerHTML = '';
    step2Progress.hidden = false;
    toStep3Btn.disabled = true;
    skipMosaicBtn.disabled = true;

    var files = selectedIndices.map(function (i) { return allFiles[i]; });

    loadModels()
      .then(function () {
        return processSequential(files, function (file, idx) {
          step2ProgressFill.style.width = Math.round(((idx + 1) / files.length) * 100) + '%';
          step2ProgressText.textContent = '処理中... (' + (idx + 1) + '/' + files.length + ')';
          return prepareImage(file, idx);
        });
      })
      .then(function () {
        step2Progress.hidden = true;
        toStep3Btn.disabled = false;
        skipMosaicBtn.disabled = false;
        renderMosaicGrid();
        // Auto-open editor starting from first image
        if (imageData.length > 0) {
          openEditor(0);
        }
      })
      .catch(function (err) {
        console.error(err);
        step2ProgressText.textContent = 'エラー: ' + err.message;
      });
  }

  // Multi-fallback face detection
  function detectFace(canvas) {
    // 1. SSD MobileNet + landmarks (precise mouth + nose position)
    var ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
    return faceapi.detectSingleFace(canvas, ssdOpts)
      .withFaceLandmarks()
      .then(function (result) {
        if (result) {
          var pos = result.landmarks.positions;
          var box = result.detection.box;
          return {
            cropY: pos[57].y,        // lower lip bottom
            noseY: pos[33].y,        // nose tip (upper limit for expansion)
            faceCX: box.x + box.width / 2
          };
        }
        // 2. SSD MobileNet without landmarks (box only, estimate positions)
        return faceapi.detectSingleFace(canvas, ssdOpts).then(function (det) {
          if (det) {
            var box = det.box;
            return {
              cropY: box.y + box.height * 0.75,
              noseY: box.y + box.height * 0.55,
              faceCX: box.x + box.width / 2
            };
          }
          // 3. TinyFaceDetector (different algorithm, low threshold)
          var tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.15 });
          return faceapi.detectSingleFace(canvas, tinyOpts).then(function (det2) {
            if (det2) {
              var box = det2.box;
              return {
                cropY: box.y + box.height * 0.75,
                noseY: box.y + box.height * 0.55,
                faceCX: box.x + box.width / 2
              };
            }
            return null;
          });
        });
      });
  }

  function prepareImage(file, idx) {
    return loadImageAsCanvas(file).then(function (canvas) {
      var mosaicCanvas = cloneCanvas(canvas);

      return detectFace(canvas).then(function (face) {
          imageData[idx] = {
            origCanvas: canvas,
            mosaicCanvas: mosaicCanvas,
            cropY: face ? face.cropY : null,
            noseY: face ? face.noseY : null,
            faceCX: face ? face.faceCX : null,
            undoStack: []
          };
        });
    });
  }

  function renderMosaicGrid() {
    mosaicGrid.innerHTML = '';
    imageData.forEach(function (data, idx) {
      var card = document.createElement('div');
      card.className = 'mosaic-card';

      var img = document.createElement('img');
      img.src = data.mosaicCanvas.toDataURL('image/jpeg', 0.7);
      img.addEventListener('click', function () {
        openEditor(idx);
      });

      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = String(idx + 1).padStart(2, '0');

      var actions = document.createElement('div');
      actions.className = 'card-actions';

      var resetBtn = document.createElement('button');
      resetBtn.className = 'card-reset';
      resetBtn.textContent = 'リセット';
      resetBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var ctx = data.mosaicCanvas.getContext('2d');
        ctx.drawImage(data.origCanvas, 0, 0);
        renderMosaicGrid();
      });

      var editBtn = document.createElement('button');
      editBtn.className = 'card-edit';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openEditor(idx);
      });

      actions.appendChild(resetBtn);
      actions.appendChild(editBtn);

      card.appendChild(img);
      card.appendChild(label);
      card.appendChild(actions);

      mosaicGrid.appendChild(card);
    });
  }

  // ============================================================
  // Mosaic Editor (Brush Tool)
  // ============================================================
  var editorIdx = -1;
  var painting = false;
  var lastBrushX = -1, lastBrushY = -1;

  // Temp canvas for blur effect
  var blurTmp = document.createElement('canvas');
  // Pre-stroke snapshot (used as blur source to prevent compounding)
  var strokeSource = document.createElement('canvas');

  function editorActive() {
    return editorIdx >= 0 && imageData[editorIdx];
  }

  function openEditor(idx) {
    editorIdx = idx;
    var data = imageData[idx];
    editorTitle.textContent = '編集中: ' + String(idx + 1).padStart(2, '0') + ' / ' + String(imageData.length).padStart(2, '0');

    editorCanvas.width = data.mosaicCanvas.width;
    editorCanvas.height = data.mosaicCanvas.height;
    editorCanvas.getContext('2d').drawImage(data.mosaicCanvas, 0, 0);

    data.undoStack = [cloneCanvasData(data.mosaicCanvas)];
    var isFirst = idx === 0;
    var isLast = idx + 1 >= imageData.length;
    editorPrev.disabled = isFirst;
    editorDone.textContent = isLast ? '決定 [S]' : '決定 → [S]';
    editorSkip.textContent = isLast ? '送り [D]' : '送り → [D]';
    editorOverlay.hidden = false;
    editorToolbar.hidden = false;
    requestAnimationFrame(updateBrushCursorSize);
  }

  // ---- Editor navigation helpers ----
  function editorSaveCurrent() {
    if (!editorActive()) return;
    var data = imageData[editorIdx];
    data.mosaicCanvas.getContext('2d').drawImage(editorCanvas, 0, 0);
    data.undoStack = [];
  }

  function editorCloseAndOpen(nextIdx) {
    editorIdx = -1;
    painting = false;
    hideBrushCursor();
    editorOverlay.hidden = true;
    editorToolbar.hidden = true;
    renderMosaicGrid();
    if (nextIdx >= 0 && nextIdx < imageData.length) {
      openEditor(nextIdx);
    }
  }

  // S / Up / Done button: save edits → advance to next
  function editorConfirmNext() {
    if (!editorActive()) return;
    var next = editorIdx + 1;
    editorSaveCurrent();
    editorCloseAndOpen(next);
  }

  // D / Right: skip forward without saving
  function editorSkipNext() {
    if (!editorActive()) return;
    var next = editorIdx + 1;
    imageData[editorIdx].undoStack = [];
    editorCloseAndOpen(next);
  }

  // A / Left: save edits → go back to previous
  function editorGoBack() {
    if (!editorActive()) return;
    var prev = editorIdx - 1;
    editorSaveCurrent();
    editorCloseAndOpen(prev);
  }

  editorDone.addEventListener('click', editorConfirmNext);
  editorPrev.addEventListener('click', editorGoBack);
  editorSkip.addEventListener('click', editorSkipNext);

  // Keyboard shortcuts (only when editor is open)
  document.addEventListener('keydown', function (e) {
    if (!editorActive()) return;
    // Ignore if focused on an input/select
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (e.key) {
      case 's': case 'S': case 'ArrowUp':
        e.preventDefault();
        editorConfirmNext();
        break;
      case 'd': case 'D': case 'ArrowRight':
        e.preventDefault();
        editorSkipNext();
        break;
      case 'a': case 'A': case 'ArrowLeft':
        e.preventDefault();
        editorGoBack();
        break;
    }
  });

  editorReset.addEventListener('click', function () {
    if (!editorActive()) return;
    var data = imageData[editorIdx];
    editorCanvas.getContext('2d').drawImage(data.origCanvas, 0, 0);
    data.undoStack = [cloneCanvasData(editorCanvas)];
  });

  editorUndo.addEventListener('click', function () {
    if (!editorActive()) return;
    var data = imageData[editorIdx];
    if (data.undoStack.length > 1) {
      data.undoStack.pop();
      editorCanvas.getContext('2d').putImageData(
        data.undoStack[data.undoStack.length - 1], 0, 0
      );
    }
  });

  // Slider labels
  brushSizeInput.addEventListener('input', function () {
    brushSizeVal.textContent = brushSizeInput.value;
    updateBrushCursorSize();
  });
  effectStrengthInput.addEventListener('input', function () {
    effectStrengthVal.textContent = effectStrengthInput.value;
  });

  // ---- Brush cursor visual ----
  function updateBrushCursorSize() {
    if (!editorActive()) return;
    var r = parseInt(brushSizeInput.value, 10) || 50;
    // Convert canvas pixels to screen pixels
    var rect = editorCanvas.getBoundingClientRect();
    var scale = rect.width / editorCanvas.width;
    var screenDia = r * 2 * scale;
    brushCursor.style.width = screenDia + 'px';
    brushCursor.style.height = screenDia + 'px';
  }

  function showBrushCursor(e) {
    brushCursor.style.display = 'block';
    brushCursor.style.left = e.clientX + 'px';
    brushCursor.style.top = e.clientY + 'px';
  }

  function hideBrushCursor() {
    brushCursor.style.display = 'none';
  }

  editorCanvas.addEventListener('mouseenter', function (e) {
    if (!editorActive()) return;
    updateBrushCursorSize();
    showBrushCursor(e);
  });

  editorCanvas.addEventListener('mouseleave', function () {
    hideBrushCursor();
  });

  // ---- Brush painting ----
  function saveStrokeSource() {
    strokeSource.width = editorCanvas.width;
    strokeSource.height = editorCanvas.height;
    strokeSource.getContext('2d').drawImage(editorCanvas, 0, 0);
  }

  function getBrushRadius() {
    return parseInt(brushSizeInput.value, 10) || 50;
  }
  function getStrength() {
    return parseInt(effectStrengthInput.value, 10) || 15;
  }
  function getMode() {
    return brushModeSelect.value; // 'mosaic' or 'blur'
  }

  function canvasPos(e) {
    var rect = editorCanvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * (editorCanvas.width / rect.width)),
      y: Math.round((e.clientY - rect.top) * (editorCanvas.height / rect.height))
    };
  }

  function brushStroke(cx, cy) {
    var r = getBrushRadius();
    var strength = getStrength();
    var mode = getMode();

    // Bounding box for the brush circle
    var bx = Math.max(0, cx - r);
    var by = Math.max(0, cy - r);
    var bx2 = Math.min(editorCanvas.width, cx + r);
    var by2 = Math.min(editorCanvas.height, cy + r);
    var bw = bx2 - bx;
    var bh = by2 - by;
    if (bw <= 0 || bh <= 0) return;

    if (mode === 'blur') {
      applyBlurBrush(editorCanvas, bx, by, bw, bh, cx, cy, r, strength);
    } else {
      applyMosaicBrush(editorCanvas, bx, by, bw, bh, cx, cy, r, strength);
    }
  }

  function interpolateStroke(x0, y0, x1, y1) {
    var r = getBrushRadius();
    var step = Math.max(2, r / 3);
    var dx = x1 - x0;
    var dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.ceil(dist / step));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      brushStroke(Math.round(x0 + dx * t), Math.round(y0 + dy * t));
    }
  }

  // Mouse
  editorCanvas.addEventListener('mousedown', function (e) {
    if (!editorActive()) return;
    painting = true;
    saveStrokeSource();
    var pos = canvasPos(e);
    lastBrushX = pos.x;
    lastBrushY = pos.y;
    brushStroke(pos.x, pos.y);
  });

  editorCanvas.addEventListener('mousemove', function (e) {
    if (!editorActive()) return;
    showBrushCursor(e);
    if (!painting) return;
    var pos = canvasPos(e);
    interpolateStroke(lastBrushX, lastBrushY, pos.x, pos.y);
    lastBrushX = pos.x;
    lastBrushY = pos.y;
  });

  editorCanvas.addEventListener('mouseup', function () {
    if (!painting || !editorActive()) return;
    painting = false;
    imageData[editorIdx].undoStack.push(cloneCanvasData(editorCanvas));
  });

  editorCanvas.addEventListener('mouseleave', function () {
    if (!painting || !editorActive()) return;
    painting = false;
    imageData[editorIdx].undoStack.push(cloneCanvasData(editorCanvas));
  });

  // Touch
  editorCanvas.addEventListener('touchstart', function (e) {
    if (!editorActive()) return;
    e.preventDefault();
    painting = true;
    saveStrokeSource();
    var pos = canvasPos(e.touches[0]);
    lastBrushX = pos.x;
    lastBrushY = pos.y;
    brushStroke(pos.x, pos.y);
  }, { passive: false });

  editorCanvas.addEventListener('touchmove', function (e) {
    if (!painting || !editorActive()) return;
    e.preventDefault();
    var pos = canvasPos(e.touches[0]);
    interpolateStroke(lastBrushX, lastBrushY, pos.x, pos.y);
    lastBrushX = pos.x;
    lastBrushY = pos.y;
  }, { passive: false });

  editorCanvas.addEventListener('touchend', function (e) {
    if (!painting || !editorActive()) return;
    e.preventDefault();
    painting = false;
    imageData[editorIdx].undoStack.push(cloneCanvasData(editorCanvas));
  }, { passive: false });

  // ---- Mosaic brush: pixelate within a circle ----
  function applyMosaicBrush(canvas, bx, by, bw, bh, cx, cy, radius, blockSize) {
    var ctx = canvas.getContext('2d');
    var source = strokeSource.width > 0 ? strokeSource : canvas;
    var r2 = radius * radius;

    // Align to global grid so overlapping dabs produce consistent blocks
    var gx0 = Math.floor(bx / blockSize) * blockSize;
    var gy0 = Math.floor(by / blockSize) * blockSize;
    var gx1 = Math.ceil((bx + bw) / blockSize) * blockSize;
    var gy1 = Math.ceil((by + bh) / blockSize) * blockSize;

    // Clamp to canvas
    gx0 = Math.max(0, gx0);
    gy0 = Math.max(0, gy0);
    gx1 = Math.min(canvas.width, gx1);
    gy1 = Math.min(canvas.height, gy1);

    // Read source pixels for color averaging (pre-stroke state)
    var srcW = gx1 - gx0;
    var srcH = gy1 - gy0;
    if (srcW <= 0 || srcH <= 0) return;
    var srcData = source.getContext('2d').getImageData(gx0, gy0, srcW, srcH).data;

    for (var gy = gy0; gy < gy1; gy += blockSize) {
      for (var gx = gx0; gx < gx1; gx += blockSize) {
        // Check if block center is inside brush circle
        var midX = gx + blockSize / 2 - cx;
        var midY = gy + blockSize / 2 - cy;
        if (midX * midX + midY * midY > r2) continue;

        var ebw = Math.min(blockSize, gx1 - gx);
        var ebh = Math.min(blockSize, gy1 - gy);

        // Average color from source (pre-stroke)
        var sr = 0, sg = 0, sb = 0, cnt = 0;
        for (var y2 = 0; y2 < ebh; y2++) {
          for (var x2 = 0; x2 < ebw; x2++) {
            var i = ((gy - gy0 + y2) * srcW + (gx - gx0 + x2)) * 4;
            sr += srcData[i]; sg += srcData[i + 1]; sb += srcData[i + 2]; cnt++;
          }
        }
        sr = Math.round(sr / cnt);
        sg = Math.round(sg / cnt);
        sb = Math.round(sb / cnt);

        // Fill block on live canvas
        ctx.fillStyle = 'rgb(' + sr + ',' + sg + ',' + sb + ')';
        ctx.fillRect(gx, gy, ebw, ebh);
      }
    }
  }

  // ---- Gaussian blur brush using canvas filter ----
  function applyBlurBrush(canvas, bx, by, bw, bh, cx, cy, radius, strength) {
    var ctx = canvas.getContext('2d');

    // Use pre-stroke snapshot as source to prevent compounding blur
    var source = strokeSource.width > 0 ? strokeSource : canvas;

    // Draw blurred version of the region to temp canvas
    blurTmp.width = bw;
    blurTmp.height = bh;
    var tmpCtx = blurTmp.getContext('2d');
    tmpCtx.filter = 'blur(' + strength + 'px)';
    // Draw slightly larger area to avoid edge artifacts
    var pad = strength * 2;
    var sx = Math.max(0, bx - pad);
    var sy = Math.max(0, by - pad);
    var sw = Math.min(source.width - sx, bw + pad * 2);
    var sh = Math.min(source.height - sy, bh + pad * 2);
    tmpCtx.drawImage(source, sx, sy, sw, sh, sx - bx, sy - by, sw, sh);
    tmpCtx.filter = 'none';

    // Clip to circle and draw back
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(blurTmp, 0, 0, bw, bh, bx, by, bw, bh);
    ctx.restore();
  }

  // ============================================================
  // Step 2 → Step 3
  // ============================================================
  backToStep1.addEventListener('click', function () {
    showStep('step-1');
  });

  // Skip mosaic: reset all to originals and proceed
  skipMosaicBtn.addEventListener('click', function () {
    imageData.forEach(function (data) {
      var ctx = data.mosaicCanvas.getContext('2d');
      ctx.drawImage(data.origCanvas, 0, 0);
    });
    showStep('step-3');
    startCropAndZip();
  });

  // Confirm current state (with any edits) and proceed
  toStep3Btn.addEventListener('click', function () {
    showStep('step-3');
    startCropAndZip();
  });

  function getDateStr() {
    var now = new Date();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    return m + '_' + d;
  }

  function startCropAndZip() {
    resultList.innerHTML = '';
    downloadBtn.hidden = true;
    step3Progress.hidden = false;
    step3ProgressFill.style.width = '0%';
    step3ProgressText.textContent = 'クロップ＆ZIP生成中...';

    var zip = new JSZip();
    var total = imageData.length;
    var dateStr = getDateStr();
    var origFolder = zip.folder('original');
    var postFolder = zip.folder('post_pixiv_' + dateStr);

    processSequential(imageData, function (data, idx) {
      step3ProgressFill.style.width = Math.round(((idx + 1) / total) * 100) + '%';
      step3ProgressText.textContent = 'クロップ中... (' + (idx + 1) + '/' + total + ')';

      var num = String(idx + 1).padStart(2, '0');

      // A: original → 元画像フォルダ
      return canvasToBlob(data.origCanvas, 'image/jpeg', 0.95).then(function (origBlob) {
        origFolder.file(num + 'A.jpg', origBlob);

        // B: crop → 投稿用フォルダ
        var cropCanvas = createCropCanvas(data);
        return canvasToBlob(cropCanvas, 'image/jpeg', 0.92).then(function (cropBlob) {
          postFolder.file(num + 'B.jpg', cropBlob);

          // C: mosaic → 投稿用フォルダ
          return canvasToBlob(data.mosaicCanvas, 'image/jpeg', 0.95).then(function (mosaicBlob) {
            postFolder.file(num + 'C.jpg', mosaicBlob);

            addResultRow(num, cropCanvas);
          });
        });
      });
    }).then(function () {
      step3ProgressText.textContent = 'ZIPを生成中...';
      return zip.generateAsync({ type: 'blob' });
    }).then(function (zipBlob) {
      lastZipBlob = zipBlob;
      step3Progress.hidden = true;
      downloadBtn.hidden = false;
      // Save used filenames to history
      var usedFilenames = selectedIndices.map(function (i) { return allFiles[i].name; });
      addUsedFiles(usedFilenames);
      downloadZip();
    }).catch(function (err) {
      console.error(err);
      step3ProgressText.textContent = 'エラー: ' + err.message;
    });
  }

  function createCropCanvas(data) {
    var mosaicCanvas = data.mosaicCanvas;
    var imgW = data.origCanvas.width;
    var imgH = data.origCanvas.height;
    var isLandscape = imgW > imgH;
    var left, top, size;

    var MIN_CROP = 300;

    if (data.cropY != null && data.faceCX != null) {
      // Use lower lip position from 68-point landmarks (point 57)
      var cropY = data.cropY;
      var noseY = data.noseY || cropY; // upper limit for expansion
      var faceCX = data.faceCX;

      if (isLandscape) {
        size = Math.min(1000, Math.round(imgH * 0.7));
        size = Math.max(size, MIN_CROP);
      } else {
        size = Math.min(800, imgW);
        size = Math.max(size, MIN_CROP);
      }
      top = Math.round(cropY);
      left = Math.round(faceCX - size / 2);

      // If not enough space below, expand upward but never above nose
      var available = imgH - top;
      if (available < MIN_CROP) {
        var noseLimit = Math.round(noseY);
        top = Math.max(noseLimit, imgH - size);
        top = Math.max(0, top);
      }
    } else {
      // No face detected: center crop
      size = Math.min(1000, imgW, imgH);
      left = Math.round((imgW - size) / 2);
      top = Math.round((imgH - size) / 2);
    }

    // Clamp
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + size > imgW) left = Math.max(0, imgW - size);
    if (top + size > imgH) size = imgH - top;

    var actualSize = Math.min(size, imgW - left, imgH - top);
    actualSize = Math.max(actualSize, 1);

    var canvas = document.createElement('canvas');
    canvas.width = actualSize;
    canvas.height = actualSize;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(mosaicCanvas, left, top, actualSize, actualSize, 0, 0, actualSize, actualSize);
    return canvas;
  }

  function addResultRow(num, cropCanvas) {
    var row = document.createElement('div');
    row.className = 'result-row';

    var img = document.createElement('img');
    img.src = cropCanvas.toDataURL('image/jpeg', 0.7);

    var lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = num;

    var files = document.createElement('span');
    files.className = 'files';
    files.textContent = num + 'A / ' + num + 'B / ' + num + 'C';

    row.appendChild(img);
    row.appendChild(lbl);
    row.appendChild(files);

    resultList.appendChild(row);
  }

  // ============================================================
  // Download
  // ============================================================
  downloadBtn.addEventListener('click', function () { downloadZip(); });

  function downloadZip() {
    if (!lastZipBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(lastZipBlob);
    a.download = 'pixiv_' + getDateStr() + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  restartBtn.addEventListener('click', function () {
    allFiles = [];
    selectedIndices = [];
    imageData = [];
    lastZipBlob = null;
    renderStep1();
    showStep('step-1');
  });

  // ============================================================
  // Utilities
  // ============================================================
  function loadImageAsCanvas(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(img.src);
        resolve(canvas);
      };
      img.onerror = function () {
        URL.revokeObjectURL(img.src);
        reject(new Error('画像読み込み失敗'));
      };
      img.src = URL.createObjectURL(file);
    });
  }

  function cloneCanvas(source) {
    var c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d').drawImage(source, 0, 0);
    return c;
  }

  function cloneCanvasData(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, type, quality);
    });
  }

  function applyMosaic(canvas, x, y, w, h, blockSize) {
    var ctx = canvas.getContext('2d');
    // Clamp to canvas bounds
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.min(Math.round(w), canvas.width - x);
    h = Math.min(Math.round(h), canvas.height - y);
    if (w <= 0 || h <= 0) return;

    var imgData = ctx.getImageData(x, y, w, h);
    var d = imgData.data;

    for (var py = 0; py < h; py += blockSize) {
      for (var px = 0; px < w; px += blockSize) {
        // Average color in block
        var r = 0, g = 0, b = 0, count = 0;
        var bh = Math.min(blockSize, h - py);
        var bw = Math.min(blockSize, w - px);
        for (var by = 0; by < bh; by++) {
          for (var bx = 0; bx < bw; bx++) {
            var i = ((py + by) * w + (px + bx)) * 4;
            r += d[i];
            g += d[i + 1];
            b += d[i + 2];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        // Fill block
        for (var by2 = 0; by2 < bh; by2++) {
          for (var bx2 = 0; bx2 < bw; bx2++) {
            var j = ((py + by2) * w + (px + bx2)) * 4;
            d[j] = r;
            d[j + 1] = g;
            d[j + 2] = b;
          }
        }
      }
    }
    ctx.putImageData(imgData, x, y);
  }

  function processSequential(arr, fn) {
    var idx = 0;
    function next() {
      if (idx >= arr.length) return Promise.resolve();
      var i = idx++;
      return fn(arr[i], i).then(next);
    }
    return next();
  }
})();
