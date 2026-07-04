// tile-reorder.js — drag-to-reorder AND resize for tile grids, invoked BY each
// page's Design-Component logic class (never auto-running). A previous global
// auto-running script fought the editor's text-instrumentation pass and broke
// inline editing, so this module does nothing on its own: the component calls
// window.TileReorder.sync(...) from componentDidMount / componentDidUpdate.
//
// BOTH features are DOM-safe — they only ever mutate inline styles / attributes
// on existing nodes, never add or move DOM nodes inside the React-managed tree
// (the one control element lives at document.body level). So editor text
// handles (data-om-id), slot shadow state, and React reconciliation are left
// untouched. State persists in localStorage per (page, grid, tile) and is
// re-applied on every sync, so a React re-render that clobbers an inline style
// is corrected immediately afterward.
//
//   window.TileReorder.sync({ storeKey: 'ks-boh-order', editing: true });
//
// Each [data-tile-grid] is handled; tiles are the grid's direct element
// children except the "+ Add tile" button. A tile's stable key is its own id,
// else the id of the first descendant with an id (the image-/video-slot), else
// a positional key. Grids that already contain a native resize control
// (title="Resize", e.g. the Personal page) are left to manage their own size.
(() => {
  const ADD_ORDER = 100000;
  let draggingKey = null;
  let draggingGrid = null;

  // ── shared helpers ──────────────────────────────────────────────────────
  function tileKey(tile, gi, i) {
    if (tile.id) return tile.id;
    const withId = tile.querySelector && tile.querySelector('[id]');
    if (withId && withId.id) return withId.id;
    return 'pos:' + gi + ':' + i;
  }
  function isAddButton(el) {
    return el.tagName === 'BUTTON' ||
      (el.querySelector && el.querySelector('button[data-add-tile]'));
  }
  function tilesOf(grid) {
    return [...grid.children].filter((c) => c.nodeType === 1 && !isAddButton(c));
  }
  function hasNativeResize(grid) {
    return !!grid.querySelector('[title="Resize"]');
  }
  function loadArr(key) {
    try { const r = localStorage.getItem(key); const a = r ? JSON.parse(r) : null; return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveArr(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {} }
  function loadMap(key) {
    try { const r = localStorage.getItem(key); const o = r ? JSON.parse(r) : null; return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function saveMap(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {} }

  // ── ORDER ───────────────────────────────────────────────────────────────
  function applyOrder(grid, storeKey, gi) {
    const tiles = tilesOf(grid);
    const byKey = new Map();
    tiles.forEach((t, i) => { const k = tileKey(t, gi, i); t.dataset.trKey = k; byKey.set(k, t); });
    const saved = loadArr(storeKey);
    const seen = new Set();
    const seq = [];
    saved.forEach((k) => { if (byKey.has(k) && !seen.has(k)) { seq.push(k); seen.add(k); } });
    tiles.forEach((t) => { const k = t.dataset.trKey; if (!seen.has(k)) { seq.push(k); seen.add(k); } });
    seq.forEach((k, idx) => { const t = byKey.get(k); if (t) t.style.order = String(idx); });
    [...grid.children].forEach((c) => { if (c.nodeType === 1 && isAddButton(c)) c.style.order = String(ADD_ORDER); });
  }

  function reorder(storeKey, grid, gi, fromKey, toKey, after) {
    const tiles = tilesOf(grid);
    const seq = tiles.map((t, i) => tileKey(t, gi, i));
    const saved = loadArr(storeKey).filter((k) => seq.indexOf(k) >= 0);
    seq.forEach((k) => { if (saved.indexOf(k) < 0) saved.push(k); });
    const arr = saved;
    const fi = arr.indexOf(fromKey);
    if (fi >= 0) arr.splice(fi, 1);
    let ti = arr.indexOf(toKey);
    if (ti < 0) ti = arr.length;
    arr.splice(after ? ti + 1 : ti, 0, fromKey);
    saveArr(storeKey, arr);
    applyOrder(grid, storeKey, gi);
  }

  // ── RESIZE ──────────────────────────────────────────────────────────────
  function colCount(grid) {
    const t = getComputedStyle(grid).gridTemplateColumns;
    if (!t || t === 'none') return 6;
    const n = t.trim().split(/\s+/).length;
    return n > 0 ? n : 6;
  }
  // Size presets as [cols, rows] spans, scaled to the grid's column count.
  // A broad ladder so any tile can cycle through small → square → wide banner →
  // tall → full-width. Columns are clamped to the grid width in presetsFor().
  function presetsFor(cols) {
    let base;
    if (cols >= 6) base = [
      [1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [4, 2],
      [6, 1], [6, 2], [3, 3], [4, 3], [6, 3],
      [1, 2], [2, 3], [3, 4]
    ];
    else if (cols >= 4) base = [[1, 1], [2, 1], [2, 2], [4, 1], [3, 2], [4, 2], [4, 3], [1, 2], [2, 3]];
    else if (cols >= 3) base = [[1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 3], [1, 2], [2, 3]];
    else if (cols >= 2) base = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 3]];
    else base = [[1, 1]];
    return base.map(([c, r]) => [Math.min(c, cols), r]);
  }
  function applySizes(grid, sizeKey, gi) {
    if (hasNativeResize(grid)) return;
    const map = loadMap(sizeKey);
    const cols = colCount(grid);
    const presets = presetsFor(cols);
    tilesOf(grid).forEach((t, i) => {
      const k = tileKey(t, gi, i);
      const v = map[k];
      if (v && typeof v === 'object') {
        // Raw span (e.g. recorded by a duplicate to mirror its source).
        const c = Math.min(v.c || 1, cols), r = v.r || 1;
        t.style.gridColumn = 'span ' + c;
        t.style.gridRow = 'span ' + r;
      } else if (k in map) {
        const idx = ((map[k] % presets.length) + presets.length) % presets.length;
        const [c, r] = presets[idx];
        t.style.gridColumn = 'span ' + c;
        t.style.gridRow = 'span ' + r;
      }
    });
  }
  // Parse a tile's current [cols, rows] span from its inline (or computed) style.
  function readSpan(el) {
    const n = (val) => { const m = /span\s+(\d+)/.exec(val || ''); return m ? parseInt(m[1], 10) : 0; };
    let c = n(el.style.gridColumn), r = n(el.style.gridRow);
    if (!c || !r) { const cs = getComputedStyle(el); c = c || n(cs.gridColumn) || 1; r = r || n(cs.gridRow) || 1; }
    return [c, r];
  }
  function cycleSize(grid, sizeKey, gi, key) {
    const map = loadMap(sizeKey);
    const presets = presetsFor(colCount(grid));
    const next = ((typeof map[key] === 'number' ? map[key] : -1) + 1) % presets.length;
    map[key] = next;
    saveMap(sizeKey, map);
    applySizes(grid, sizeKey, gi);
  }

  // ── HIDE (persistent base-tile deletion, recoverable) ───────────────────
  // Base tiles live in page markup, not in React state, so "deleting" one means
  // recording its key in a per-grid hidden set and applying display:none. While
  // editing, hidden base tiles are shown faded (not removed) so they can be
  // restored; outside edit mode they're fully hidden.
  function applyHidden(grid, hideKey, gi, editing) {
    const set = loadArr(hideKey);
    if (!set.length) {
      tilesOf(grid).forEach((t) => { if (t.dataset.trHidden === '1') { t.dataset.trHidden = ''; t.style.display = ''; t.style.opacity = ''; t.style.filter = ''; } });
      return;
    }
    tilesOf(grid).forEach((t, i) => {
      const k = tileKey(t, gi, i);
      const hidden = set.indexOf(k) >= 0;
      if (hidden) {
        t.dataset.trHidden = '1';
        t.style.display = 'none';   // gone in every mode; restore via the pill
        t.style.opacity = '';
        t.style.filter = '';
      } else if (t.dataset.trHidden === '1') {
        t.dataset.trHidden = ''; t.style.display = ''; t.style.opacity = ''; t.style.filter = '';
      }
    });
  }
  function hiddenCount() {
    let n = 0;
    document.querySelectorAll('[data-tile-grid]').forEach((grid) => {
      const hk = grid.dataset.trHideKey;
      if (hk) n += loadArr(hk).length;
    });
    return n;
  }
  function restoreAll() {
    document.querySelectorAll('[data-tile-grid]').forEach((grid, gi) => {
      const hk = grid.dataset.trHideKey;
      if (hk && loadArr(hk).length) { saveArr(hk, []); applyHidden(grid, hk, gi, grid.dataset.trEditing === '1'); }
    });
    updateRestoreBar(true);
  }
  function updateRestoreBar(editing) {
    let el = document.getElementById('__tr_restore');
    const n = hiddenCount();
    if (!editing || n === 0) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button');
      el.id = '__tr_restore';
      el.type = 'button';
      el.style.cssText = 'position:fixed;left:50%;bottom:60px;transform:translateX(-50%);z-index:100;' +
        'display:flex;align-items:center;gap:8px;border:none;cursor:pointer;' +
        'background:#0B0B0C;color:#fff;font:600 12px/1 Geist,system-ui,sans-serif;letter-spacing:0.02em;' +
        'padding:9px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,0.22);';
      el.addEventListener('mouseenter', () => { el.style.background = '#1A1A1C'; });
      el.addEventListener('mouseleave', () => { el.style.background = '#0B0B0C'; });
      el.addEventListener('click', (e) => { e.preventDefault(); restoreAll(); });
      document.body.appendChild(el);
    }
    el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>' +
      'Restore ' + n + ' deleted tile' + (n === 1 ? '' : 's');
  }
  function isHiddenTile(t) { return t && t.dataset && t.dataset.trHidden === '1'; }

  // Single body-level resize handle that follows the hovered tile while editing.
  let hoverTile = null, hoverGrid = null, hoverSizeKey = null, hoverGi = 0;
  let hoverHideKey = null;
  let onDuplicate = null, onDelete = null;

  function delBtn() {
    let b = document.getElementById('__tr_del');
    if (!b) {
      b = document.createElement('button');
      b.id = '__tr_del';
      b.type = 'button';
      b.title = 'Delete tile';
      b.setAttribute('aria-label', 'Delete tile');
      b.style.cssText = 'position:fixed;z-index:101;display:none;align-items:center;justify-content:center;' +
        'width:30px;height:30px;border:none;border-radius:9px;background:rgba(11,11,12,0.82);color:#fff;' +
        'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25);backdrop-filter:blur(4px);padding:0;';
      b.addEventListener('mouseenter', () => { b.style.background = '#E5484D'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'rgba(11,11,12,0.82)'; });
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (onDelete && hoverTile && hoverGrid && hoverTile.isConnected) {
          onDelete(hoverGi, hoverTile, hoverGrid);
        }
      });
      document.body.appendChild(b);
    }
    b.title = 'Delete tile';
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    return b;
  }

  function dupBtn() {
    let b = document.getElementById('__tr_dup');
    if (!b) {
      b = document.createElement('button');
      b.id = '__tr_dup';
      b.type = 'button';
      b.title = 'Duplicate tile';
      b.setAttribute('aria-label', 'Duplicate tile');
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      b.style.cssText = 'position:fixed;z-index:101;display:none;align-items:center;justify-content:center;' +
        'width:30px;height:30px;border:none;border-radius:9px;background:rgba(11,11,12,0.82);color:#fff;' +
        'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25);backdrop-filter:blur(4px);padding:0;';
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(11,11,12,0.95)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'rgba(11,11,12,0.82)'; });
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (onDuplicate && hoverTile && hoverGrid && hoverTile.isConnected) {
          onDuplicate(hoverGi, hoverTile, hoverGrid);
        }
      });
      document.body.appendChild(b);
    }
    return b;
  }

  function resizeBtn() {
    let b = document.getElementById('__tr_resize');
    if (!b) {
      b = document.createElement('button');
      b.id = '__tr_resize';
      b.type = 'button';
      b.title = 'Resize tile';
      b.setAttribute('aria-label', 'Resize tile');
      b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
      b.style.cssText = 'position:fixed;z-index:101;display:none;align-items:center;justify-content:center;' +
        'width:30px;height:30px;border:none;border-radius:9px;background:rgba(11,11,12,0.82);color:#fff;' +
        'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25);backdrop-filter:blur(4px);padding:0;';
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(11,11,12,0.95)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'rgba(11,11,12,0.82)'; });
      // pointerdown must not start a tile drag
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (hoverTile && hoverGrid && hoverTile.isConnected) {
          cycleSize(hoverGrid, hoverSizeKey, hoverGi, hoverTile.dataset.trKey);
          requestAnimationFrame(positionResize);
        }
      });
      document.body.appendChild(b);
    }
    return b;
  }
  function positionResize() {
    const b = document.getElementById('__tr_resize');
    const d = document.getElementById('__tr_dup');
    const x = document.getElementById('__tr_del');
    const hide = !hoverTile || !hoverTile.isConnected;
    let r = null;
    if (!hide) {
      r = hoverTile.getBoundingClientRect();
      if (r.width < 4 || r.bottom < 0 || r.top > window.innerHeight) r = null;
    }
    const hiddenTile = isHiddenTile(hoverTile);
    if (b) {
      // resize is meaningless on a deleted/faded tile — hide it there
      if (!r || hiddenTile) { b.style.display = 'none'; }
      else { b.style.left = (r.right - 38) + 'px'; b.style.top = (r.bottom - 38) + 'px'; b.style.display = 'flex'; }
    }
    if (d) {
      if (!r || !onDuplicate || hiddenTile) { d.style.display = 'none'; }
      else { d.style.left = (r.left + 8) + 'px'; d.style.top = (r.top + 8) + 'px'; d.style.display = 'flex'; }
    }
    if (x) {
      if (!r || !onDelete) { x.style.display = 'none'; }
      else { x.style.left = (r.left + 8) + 'px'; x.style.top = (r.bottom - 38) + 'px'; x.style.display = 'flex'; }
    }
  }
  function hideResize() {
    hoverTile = null;
    const b = document.getElementById('__tr_resize');
    if (b) b.style.display = 'none';
    const d = document.getElementById('__tr_dup');
    if (d) d.style.display = 'none';
    const x = document.getElementById('__tr_del');
    if (x) x.style.display = 'none';
  }

  // ── event binding (capture phase beats slot stopPropagation) ────────────
  function bind(grid, storeKey, sizeKey, hideKey, gi) {
    if (grid.dataset.trBound === '1') { grid.dataset.trSizeKey = sizeKey; grid.dataset.trHideKey = hideKey; grid.dataset.trGi = String(gi); return; }
    grid.dataset.trBound = '1';
    grid.dataset.trSizeKey = sizeKey;
    grid.dataset.trHideKey = hideKey;
    grid.dataset.trGi = String(gi);

    grid.addEventListener('dragstart', (e) => {
      if (grid.dataset.trEditing !== '1') return;
      const tile = e.target.closest('[data-tr-key]');
      if (!tile || tile.parentElement !== grid) return;
      draggingKey = tile.dataset.trKey;
      draggingGrid = grid;
      hideResize();
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-tile', draggingKey); } catch (_) {}
      tile.style.opacity = '0.4';
    }, true);

    grid.addEventListener('dragover', (e) => {
      if (draggingKey && draggingGrid === grid) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    grid.addEventListener('dragenter', (e) => {
      if (!draggingKey || draggingGrid !== grid) return;
      e.stopPropagation();
      const tile = e.target.closest('[data-tr-key]');
      tilesOf(grid).forEach((t) => { t.style.outline = ''; });
      if (tile && tile.dataset.trKey !== draggingKey) {
        tile.style.outline = '2px solid #0B0B0C';
        tile.style.outlineOffset = '2px';
      }
    }, true);

    grid.addEventListener('drop', (e) => {
      if (!draggingKey || draggingGrid !== grid) return;
      e.preventDefault(); e.stopPropagation();
      const tile = e.target.closest('[data-tr-key]');
      if (tile && tile.dataset.trKey !== draggingKey) {
        const seq = tilesOf(grid).map((t) => t.dataset.trKey);
        const after = seq.indexOf(draggingKey) < seq.indexOf(tile.dataset.trKey);
        reorder(storeKey, grid, gi, draggingKey, tile.dataset.trKey, after);
      }
      tilesOf(grid).forEach((t) => { t.style.outline = ''; });
      draggingKey = null; draggingGrid = null;
    }, true);

    grid.addEventListener('dragend', (e) => {
      const tile = e.target.closest && e.target.closest('[data-tr-key]');
      if (tile) tile.style.opacity = '';
      draggingKey = null; draggingGrid = null;
      tilesOf(grid).forEach((t) => { t.style.outline = ''; });
    }, true);

    // resize handle hover tracking (skip grids with a native resize control)
    grid.addEventListener('mousemove', (e) => {
      if (grid.dataset.trEditing !== '1' || draggingKey) return;
      if (hasNativeResize(grid)) return;
      const tile = e.target.closest('[data-tr-key]');
      if (!tile || tile.parentElement !== grid) return;
      hoverTile = tile; hoverGrid = grid;
      hoverSizeKey = grid.dataset.trSizeKey; hoverGi = parseInt(grid.dataset.trGi, 10) || 0;
      hoverHideKey = grid.dataset.trHideKey;
      resizeBtn();
      dupBtn();
      delBtn();
      positionResize();
    });
    grid.addEventListener('mouseleave', (e) => {
      // keep visible if moving onto one of the floating handles
      const to = e.relatedTarget;
      if (to && to.closest && to.closest('#__tr_resize, #__tr_dup, #__tr_del')) return;
      hideResize();
    });
  }

  function setEditing(grid, editing) {
    grid.dataset.trEditing = editing ? '1' : '0';
    tilesOf(grid).forEach((t) => {
      if (editing) { t.setAttribute('draggable', 'true'); t.style.cursor = 'grab'; }
      else { t.removeAttribute('draggable'); t.style.cursor = ''; t.style.outline = ''; t.style.opacity = ''; }
    });
    if (!editing) hideResize();
  }

  function hint(show) {
    let el = document.getElementById('__tr_hint');
    if (show) {
      if (!el) {
        el = document.createElement('div');
        el.id = '__tr_hint';
        el.textContent = 'Drag to reorder · resize, duplicate or delete from the corners';
        el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99;' +
          'background:rgba(11,11,12,0.86);color:#fff;font:600 12px/1 Geist,system-ui,sans-serif;' +
          'letter-spacing:0.02em;padding:9px 16px;border-radius:999px;pointer-events:none;' +
          'box-shadow:0 6px 20px rgba(0,0,0,0.18);backdrop-filter:blur(6px);';
        document.body.appendChild(el);
      }
    } else if (el) { el.remove(); }
  }

  // reposition / hide the floating handle on scroll & resize
  window.addEventListener('scroll', () => { if (hoverTile) positionResize(); }, true);
  window.addEventListener('resize', () => { if (hoverTile) positionResize(); });

  window.TileReorder = {
    sync(opts) {
      opts = opts || {};
      const storeKey = opts.storeKey || 'tile-order';
      const editing = !!opts.editing;
      onDuplicate = (typeof opts.onDuplicate === 'function') ? opts.onDuplicate : null;
      onDelete = (typeof opts.onDelete === 'function') ? opts.onDelete : null;
      const grids = [...document.querySelectorAll('[data-tile-grid]')];
      grids.forEach((grid, gi) => {
        const okey = storeKey + '#' + gi;
        const skey = storeKey + '-size#' + gi;
        const hkey = storeKey + '-hidden#' + gi;
        applyOrder(grid, okey, gi);
        applySizes(grid, skey, gi);
        applyHidden(grid, hkey, gi, editing);
        bind(grid, okey, skey, hkey, gi);
        setEditing(grid, editing);
      });
      hint(editing && grids.length > 0);
      updateRestoreBar(editing);
      if (!editing) hideResize();
    },
    // Record dstKey's size to mirror a source tile's current span (used by
    // duplicate so the clone keeps the original's dimensions). Persists into the
    // grid's size map; applied on the next sync once the new tile is in the DOM.
    matchSize(gi, srcTileEl, dstKey) {
      const grids = [...document.querySelectorAll('[data-tile-grid]')];
      const grid = grids[gi];
      if (!grid || !srcTileEl || !dstKey || hasNativeResize(grid)) return;
      const sizeKey = grid.dataset.trSizeKey || ((document.querySelector('[data-tile-grid]') && ''));
      if (!sizeKey) return;
      const [c, r] = readSpan(srcTileEl);
      const map = loadMap(sizeKey);
      map[dstKey] = { c: c, r: r };
      saveMap(sizeKey, map);
      applySizes(grid, sizeKey, gi);
    },
    // Toggle a BASE tile's hidden state (persistent, recoverable). Used for
    // deleting markup tiles that aren't in React state. Extra/added tiles should
    // be removed from state by the page instead. Returns the new hidden bool.
    toggleHidden(gi, tileEl) {
      const grids = [...document.querySelectorAll('[data-tile-grid]')];
      const grid = grids[gi];
      if (!grid || !tileEl || hasNativeResize(grid)) return false;
      const hideKey = grid.dataset.trHideKey;
      if (!hideKey) return false;
      const tiles = tilesOf(grid);
      const idx = tiles.indexOf(tileEl);
      const key = (idx >= 0) ? tileKey(tileEl, gi, idx) : (tileEl.id || (tileEl.querySelector('[id]') || {}).id);
      if (!key) return false;
      const set = loadArr(hideKey);
      const at = set.indexOf(key);
      let nowHidden;
      if (at >= 0) { set.splice(at, 1); nowHidden = false; }
      else { set.push(key); nowHidden = true; }
      saveArr(hideKey, set);
      applyHidden(grid, hideKey, gi, grid.dataset.trEditing === '1');
      updateRestoreBar(grid.dataset.trEditing === '1');
      requestAnimationFrame(positionResize);
      return nowHidden;
    }
  };
})();
