// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
/* BEGIN USAGE */
/**
 * <image-slot> — user-fillable image placeholder.
 *
 * Drop this into a deck, mockup, or page wherever you want the user to
 * supply an image. You control the slot's shape and size; the user fills it
 * by dragging an image file onto it (or clicking to browse). The dropped
 * image persists across reloads via a .image-slots.state.json sidecar —
 * same read-via-fetch / write-via-window.omelette pattern as
 * design_canvas.jsx, so the filled slot shows on share links, downloaded
 * zips, and PPTX export. Outside the omelette runtime the slot is read-only.
 *
 * The host bridge only allows sidecar writes at the project root, so the
 * HTML that uses this component is assumed to live at the project root too
 * (same constraint as design_canvas.jsx).
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload —
 *                every slot on the page needs a distinct id.
 *   shape        'rect' | 'rounded' | 'circle' | 'pill'   (default 'rounded')
 *                'circle' applies 50% border-radius; on a non-square slot
 *                that's an ellipse — set equal width and height for a true
 *                circle.
 *   radius       Corner radius in px for 'rounded'.       (default 12)
 *   mask         Any CSS clip-path value. Overrides `shape` — use this for
 *                hexagons, blobs, arbitrary polygons.
 *   fit          object-fit: cover | contain | fill.       (default 'cover')
 *                With cover (the default) double-clicking the filled slot
 *                enters a reframe mode: the whole image spills past the mask
 *                (translucent outside, opaque inside), drag to reposition,
 *                corner-drag to scale. The crop persists alongside the image
 *                in the sidecar. contain/fill stay static.
 *   position     object-position for fit=contain|fill.     (default '50% 50%')
 *   placeholder  Empty-state caption.                      (default 'Drop an image')
 *   src          Optional initial/fallback image URL. A user drop overrides
 *                it; clearing the drop reveals src again.
 *
 * Size and layout come from ordinary CSS on the element — width/height
 * inline or from a parent grid — so it composes with any layout.
 *
 * Usage:
 *   <image-slot id="hero"   style="width:800px;height:450px" shape="rounded" radius="20"
 *               placeholder="Drop a hero image"></image-slot>
 *   <image-slot id="avatar" style="width:120px;height:120px" shape="circle"></image-slot>
 *   <image-slot id="kite"   style="width:300px;height:300px"
 *               mask="polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"></image-slot>
 */
/* END USAGE */

(() => {
  const STATE_FILE = '.image-slots.state.json';
  // Store the image at a display-and-zoom-friendly resolution, capped at
  // MAX_DIM on the longest side. 2560 keeps it crisp on retina and at the
  // lightbox's ~2.5× zoom while keeping the (single, shared) sidecar small
  // enough to fetch + parse fast even with dozens of tiles filled.
  const MAX_DIM = 2560;
  // Raster formats only. SVG is excluded (can carry script; createImageBitmap
  // on SVG blobs is inconsistent). GIF is excluded because the canvas
  // re-encode keeps only the first frame, so an animated GIF would silently
  // go still — better to reject than surprise.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

  // ── Shared sidecar store ────────────────────────────────────────────────
  // One fetch + immediate write-on-change for every <image-slot> on the
  // page. Reads via fetch() so viewing works anywhere the HTML and sidecar
  // are served together; writes go through window.omelette.writeFile, which
  // the host allowlists to *.state.json basenames only.
  const subs = new Set();
  let slots = {};
  // ids explicitly cleared before the sidecar fetch resolved — otherwise
  // the merge below can't tell "never set" from "just deleted" and would
  // resurrect the sidecar's stale value.
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;

  // ── IndexedDB image store ───────────────────────────────────────────────
  // The sidecar (*.state.json) CANNOT hold images: the host caps every
  // writeFile at ~16KB, far below any image's data-URL. So image BYTES live
  // in IndexedDB (per-browser, persistent, effectively uncapped) and only the
  // tiny crop/zoom framing goes to the sidecar (which stays well under 16KB
  // and so travels with the HTML). On first load any legacy sidecar-embedded
  // images are migrated into IndexedDB so the now-framing-only sidecar write
  // can't lose them. At publish time the agent bakes IndexedDB images into
  // real files for static hosting.
  const IDB_NAME = 'image-slots';
  const IDB_STORE = 'images';
  let idbP = null;
  let idbOk = false;       // a usable IndexedDB connection exists
  let imagesInIdb = false; // legacy images migrated → safe to write framing-only
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); }
      catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(IDB_STORE); } catch (e) {}
      };
      req.onsuccess = () => { idbOk = true; resolve(req.result); };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return idbP;
  }
  function idbGetAll() {
    return idb().then((db) => {
      if (!db) return {};
      return new Promise((resolve) => {
        const out = {};
        let tx;
        try { tx = db.transaction(IDB_STORE, 'readonly'); }
        catch (e) { resolve({}); return; }
        const store = tx.objectStore(IDB_STORE);
        const kr = store.getAllKeys();
        const vr = store.getAll();
        tx.oncomplete = () => {
          const keys = kr.result || [], vals = vr.result || [];
          keys.forEach((k, i) => { out[k] = vals[i]; });
          resolve(out);
        };
        tx.onerror = () => resolve({});
      });
    });
  }
  function idbPut(id, dataUrl) {
    return idb().then((db) => {
      if (!db) return false;
      return new Promise((resolve) => {
        let tx;
        try { tx = db.transaction(IDB_STORE, 'readwrite'); }
        catch (e) { resolve(false); return; }
        try { tx.objectStore(IDB_STORE).put(dataUrl, id); }
        catch (e) { resolve(false); return; }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    });
  }
  function idbDelete(id) {
    return idb().then((db) => {
      if (!db) return;
      return new Promise((resolve) => {
        let tx;
        try { tx = db.transaction(IDB_STORE, 'readwrite'); }
        catch (e) { resolve(); return; }
        try { tx.objectStore(IDB_STORE).delete(id); } catch (e) {}
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    });
  }
  const uOf = (v) => (typeof v === 'string' ? v : (v && v.u)) || '';

  function load() {
    if (loadP) return loadP;
    loadP = fetch(STATE_FILE)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        // Merge: sidecar loses to any in-memory change that raced ahead of
        // the fetch (drop or clear) so neither is clobbered by hydration.
        if (j && typeof j === 'object') {
          const merged = Object.assign({}, j, slots);
          // A framing-only write that raced ahead of hydration must not
          // drop a user image that's only on disk — inherit u from the
          // sidecar for any in-memory entry that lacks one.
          for (const k in slots) {
            if (merged[k] && !merged[k].u && j[k]) {
              merged[k].u = typeof j[k] === 'string' ? j[k] : j[k].u;
            }
          }
          for (const id of tombstones) delete merged[id];
          slots = merged;
        }
        tombstones.clear();
      })
      .catch(() => {})
      // Pull image bytes from IndexedDB (authoritative for image data).
      .then(() => idbGetAll())
      .then((imgs) => {
        for (const id in imgs) {
          if (tombstones.has(id)) continue;
          const cur = slots[id];
          if (cur && typeof cur === 'object') cur.u = imgs[id];
          else slots[id] = { u: imgs[id], s: 1, x: 0, y: 0 };
        }
        // Migrate any legacy sidecar-embedded image (data-URL on disk, not yet
        // in IndexedDB) into IndexedDB, and await it, before we ever write a
        // framing-only sidecar that would otherwise drop those bytes.
        const jobs = [];
        for (const id in slots) {
          const u = uOf(slots[id]);
          if (u.indexOf('data:') === 0 && !(id in imgs)) jobs.push(idbPut(id, u));
        }
        return Promise.all(jobs);
      })
      .then(() => { if (idbOk) imagesInIdb = true; })
      .catch(() => {})
      .then(() => { loaded = true; subs.forEach((fn) => fn()); });
    return loadP;
  }

  // Serialize sidecar writes so two near-simultaneous drops can't reorder at
  // the backend. A save requested mid-flight marks dirty and re-fires.
  let saving = false;
  let saveDirty = false;
  function save() {
    // 1) Image bytes → IndexedDB (reliable, uncapped). Fire-and-forget per id.
    for (const id in slots) {
      const u = uOf(slots[id]);
      if (u.indexOf('data:') === 0) idbPut(id, u);
    }
    // 2) Framing (crop/zoom) → sidecar. Tiny, so it fits the ~16KB writeFile
    //    cap and persists in-project. Only strip image bytes from the sidecar
    //    once they're safely in IndexedDB; otherwise fall back to the legacy
    //    full write (a no-op on disk if it exceeds the cap, so nothing is lost).
    if (saving) { saveDirty = true; return; }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    let payload;
    if (imagesInIdb) {
      const framing = {};
      for (const id in slots) {
        const v = slots[id];
        if (v && typeof v === 'object') {
          const f = {};
          if (v.s != null && v.s !== 1) f.s = v.s;
          if (v.x) f.x = v.x;
          if (v.y) f.y = v.y;
          if (v.fit) f.fit = v.fit;
          if (Object.keys(f).length) framing[id] = f;
        }
      }
      payload = JSON.stringify(framing);
    } else {
      payload = JSON.stringify(slots);
    }
    Promise.resolve(w(STATE_FILE, payload))
      .catch(() => {})
      .then(() => { saving = false; if (saveDirty) { saveDirty = false; save(); } });
  }

  const S_MAX = 5;
  const clampS = (s) => Math.max(1, Math.min(S_MAX, s));

  // Normalize a stored slot value. Pre-reframe sidecars stored a bare
  // data-URL string; newer ones store {u, s, x, y}. Either shape is valid.
  function getSlot(id) {
    const v = slots[id];
    if (!v) return null;
    return typeof v === 'string' ? { u: v, s: 1, x: 0, y: 0 } : v;
  }

  function setSlot(id, val) {
    if (!id) return;
    if (val) { slots[id] = val; tombstones.delete(id); }
    else { delete slots[id]; idbDelete(id); if (!loaded) tombstones.add(id); }
    subs.forEach((fn) => fn());
    // A drop is rare + high-value — write immediately so nav-away can't lose
    // it. Gate on the initial read so we don't overwrite a sidecar we haven't
    // merged yet; the merge in load() keeps this change once the read lands.
    if (loaded) save(); else load().then(save);
  }

  // Public store API so host pages can duplicate a tile WITH its image.
  // copy(srcId,dstId) clones the framing (sidecar) and the image bytes
  // (IndexedDB) from one slot id to another, then notifies subscribers so any
  // mounted slot for dstId re-renders filled.
  window.ImageSlotStore = window.ImageSlotStore || {
    copy(srcId, dstId) {
      if (!srcId || !dstId || srcId === dstId) return Promise.resolve(false);
      const apply = () => {
        const src = getSlot(srcId);
        if (!src) return Promise.resolve(false);
        const clone = Object.assign({}, src);
        slots[dstId] = clone;
        tombstones.delete(dstId);
        subs.forEach((fn) => fn());
        const u = uOf(clone);
        const idbJob = (u && u.indexOf('data:') === 0) ? idbPut(dstId, u) : Promise.resolve();
        return idbJob.then(() => { save(); return true; });
      };
      return loaded ? apply() : load().then(apply);
    },
    has(id) { return !!getSlot(id); }
  };

  // The host bridge (window.omelette) that flips slots into editable mode is
  // injected asynchronously. A slot that mounts before it arrives — e.g. on a
  // fresh navigation between pages — would render read-only and never recover,
  // hiding the Expand/Replace/Remove controls even though editing is available.
  // Poll briefly and re-render every slot once the bridge lands.
  (function waitForHost() {
    if (window.omelette && window.omelette.writeFile) return;
    let tries = 0;
    const iv = setInterval(() => {
      const ready = window.omelette && window.omelette.writeFile;
      if (ready || ++tries > 40) {
        clearInterval(iv);
        if (ready) subs.forEach((fn) => fn());
      }
    }, 150);
  })();

  // ── Image storage ───────────────────────────────────────────────────────
  // Always re-encode through a canvas to WebP, downscaling so the longest
  // side is at most MAX_DIM. WebP q=0.9 is visually lossless at display and
  // zoom sizes but ~4-10× smaller than the raw drop, which matters because
  // every slot on the page shares ONE sidecar JSON file: storing raw/huge
  // images there makes the file balloon and the whole page hydrate slowly
  // (a flash of empty tiles on every load). Keeping each image lean keeps
  // loads fast no matter how many tiles get filled.
  async function toDataUrl(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const longest = Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, MAX_DIM / longest);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.9);
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // ── Custom element ──────────────────────────────────────────────────────
  const stylesheet =
    ':host{display:inline-block;position:relative;vertical-align:top;' +
    '  font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55);width:240px;height:160px}' +
    '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(0,0,0,.04)}' +
    // free-transform + filled: drop the frame's grey fill so the host's own
    // backdrop (e.g. a black tile) shows around an image scaled below cover.
    ':host([free][data-filled]) .frame{background:transparent}' +
    // .frame img (clipped) and .spill (unclipped ghost + handles) share the
    // same left/top/width/height in frame-%, computed by _applyView(), so the
    // inside-mask crop and the outside-mask spill stay pixel-aligned.
    '.frame img{position:absolute;max-width:none;transform:translate(-50%,-50%);' +
    '  -webkit-user-drag:none;user-select:none;touch-action:none}' +
    // Reframe mode (double-click): the full image spills past the mask. The
    // spill layer is sized to the IMAGE bounds so its corners are where the
    // resize handles belong. The ghost <img> inside is translucent; the real
    // clipped <img> underneath shows the opaque in-mask crop.
    '.spill{position:absolute;transform:translate(-50%,-50%);display:none;z-index:1;' +
    '  cursor:grab;touch-action:none}' +
    ':host([data-panning]) .spill{cursor:grabbing}' +
    '.spill .ghost{position:absolute;inset:0;width:100%;height:100%;opacity:.35;' +
    '  pointer-events:none;-webkit-user-drag:none;user-select:none;' +
    '  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.2)}' +
    '.spill .handle{position:absolute;width:12px;height:12px;border-radius:50%;' +
    '  background:#fff;box-shadow:0 0 0 1.5px #c96442,0 1px 3px rgba(0,0,0,.3);' +
    '  transform:translate(-50%,-50%)}' +
    '.spill .handle[data-c=nw]{left:0;top:0;cursor:nwse-resize}' +
    '.spill .handle[data-c=ne]{left:100%;top:0;cursor:nesw-resize}' +
    '.spill .handle[data-c=sw]{left:0;top:100%;cursor:nesw-resize}' +
    '.spill .handle[data-c=se]{left:100%;top:100%;cursor:nwse-resize}' +
    ':host([data-reframe]){z-index:10}' +
    ':host([data-reframe]) .spill{display:block}' +
    ':host([data-reframe]) .frame{box-shadow:0 0 0 2px #c96442}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' +
    '  cursor:pointer;user-select:none}' +
    '.empty svg{opacity:.45}' +
    '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' +
    '.empty .sub{font-size:11px}' +
    '.empty .sub u{text-underline-offset:2px;text-decoration-color:rgba(0,0,0,.25)}' +
    '.empty:hover .sub u{color:rgba(0,0,0,.75);text-decoration-color:currentColor}' +
    ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px;' +
    '  background:rgba(201,100,66,.10)}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(0,0,0,.25);' +
    '  transition:border-color .12s}' +
    ':host([data-over]) .ring{border-color:#c96442}' +
    ':host([data-filled]) .ring{display:none}' +
    // Controls sit BELOW the mask (top:100%), absolutely positioned so the
    // author-declared slot height is unaffected. The gap is padding, not a
    // top offset, so the hover target stays contiguous with the frame.
    '.ctl{position:absolute;top:100%;left:50%;transform:translateX(-50%);padding-top:8px;' +
    '  display:flex;gap:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:2;' +
    '  white-space:nowrap}' +
    ':host([data-filled][data-editable]:hover) .ctl,:host([data-reframe]) .ctl' +
    '  {opacity:1;pointer-events:auto}' +
    '.ctl button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' +
    '  background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' +
    '  backdrop-filter:blur(6px)}' +
    '.ctl button:hover{background:rgba(0,0,0,.8)}' +
    // Click-to-expand affordance on the published (non-editable) view: a
    // zoom-in cursor plus a small expand badge that fades in on hover.
    ':host([data-filled]:not([data-editable])){cursor:zoom-in}' +
    '.frame::after{content:"";position:absolute;top:10px;right:10px;width:30px;height:30px;' +
    '  border-radius:8px;background:rgba(0,0,0,.55) ' +
    '  url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'white\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7\'/%3E%3C/svg%3E") center/16px no-repeat;' +
    '  opacity:0;transition:opacity .12s;pointer-events:none;z-index:1}' +
    ':host([data-filled]:not([data-editable])):hover .frame::after{opacity:1}' +
    '.err{position:absolute;left:8px;bottom:8px;right:8px;color:#b3261e;font-size:11px;' +
    '  background:rgba(255,255,255,.85);padding:4px 6px;border-radius:5px;pointer-events:none}';

  const icon =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<path d="m21 15-5-5L5 21"/></svg>';

  // ── Shared lightbox ─────────────────────────────────────────────────────
  // One overlay per page, lazily built, reused by every slot. Shows the stored
  // image at full resolution (object-fit:contain), closes on backdrop click or
  // Escape, and locks page scroll while open.
  let _lb = null;
  let _lbPrevOverflow = '';
  const _LB_ZOOM = 2.5;
  function _lbEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); closeLightbox(); } }
  function _lbApply() {
    if (!_lb) return;
    _lb._img.style.transform =
      'translate(' + _lb._tx + 'px,' + _lb._ty + 'px) scale(' + _lb._scale + ')';
  }
  function _lbClampPan() {
    const dispW = (_lb._baseW || 0) * _lb._scale;
    const dispH = (_lb._baseH || 0) * _lb._scale;
    const maxX = Math.max(0, (dispW - window.innerWidth) / 2);
    const maxY = Math.max(0, (dispH - window.innerHeight) / 2);
    _lb._tx = Math.max(-maxX, Math.min(maxX, _lb._tx));
    _lb._ty = Math.max(-maxY, Math.min(maxY, _lb._ty));
  }
  function _lbReset() {
    if (!_lb) return;
    _lb._scale = 1; _lb._tx = 0; _lb._ty = 0;
    _lb._img.style.cursor = 'zoom-in';
    _lbApply();
  }
  // Zoom toward a viewport point (px,py), keeping that point under the cursor.
  // Assumes we're zooming up from the fitted (scale 1, no-pan) state.
  function _lbZoomTo(scale, px, py) {
    const rect = _lb._img.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    _lb._scale = scale;
    _lb._tx = -(px - cx) * (scale - 1);
    _lb._ty = -(py - cy) * (scale - 1);
    _lbClampPan();
    _lb._img.style.cursor = 'zoom-out';
    _lbApply();
  }
  function closeLightbox() {
    if (!_lb) return;
    _lb.style.opacity = '0';
    document.removeEventListener('keydown', _lbEsc, true);
    document.documentElement.style.overflow = _lbPrevOverflow || '';
    setTimeout(() => { if (_lb) { _lb.style.display = 'none'; _lbReset(); } }, 200);
  }
  function openLightbox(src) {
    if (!src) return;
    if (!_lb) {
      _lb = document.createElement('div');
      _lb.setAttribute('data-image-slot-lightbox', '');
      Object.assign(_lb.style, {
        position: 'fixed', inset: '0', zIndex: '2147483600', display: 'none',
        alignItems: 'center', justifyContent: 'center', padding: '4vmin',
        boxSizing: 'border-box', background: 'rgba(8,8,10,0.92)',
        backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)',
        opacity: '0', transition: 'opacity .18s ease', cursor: 'zoom-out'
      });
      const img = document.createElement('img');
      Object.assign(img.style, {
        maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain',
        borderRadius: '8px', boxShadow: '0 24px 80px rgba(0,0,0,.5)',
        transform: 'none', transformOrigin: 'center center',
        transition: 'transform .2s ease', cursor: 'zoom-in', touchAction: 'none'
      });
      // Click the expanded image to zoom in toward the cursor; click again to
      // reset. While zoomed, drag to pan. A small move-threshold separates a
      // click (zoom toggle) from a drag (pan). Wheel zooms toward the pointer.
      img.addEventListener('load', () => {
        const r = img.getBoundingClientRect();
        // Record the fitted (scale-1) size only when not mid-zoom.
        if (_lb._scale === 1) { _lb._baseW = r.width; _lb._baseH = r.height; }
      });
      let downX = 0, downY = 0, moved = false, panning = false, startTx = 0, startTy = 0;
      img.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        downX = e.clientX; downY = e.clientY; moved = false;
        if (_lb._scale > 1) {
          panning = true; startTx = _lb._tx; startTy = _lb._ty;
          img.style.transition = 'none';
          try { img.setPointerCapture(e.pointerId); } catch (_) {}
        }
      });
      img.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;
        if (panning) {
          _lb._tx = startTx + (e.clientX - downX);
          _lb._ty = startTy + (e.clientY - downY);
          _lbClampPan(); _lbApply();
        }
      });
      const endPan = (e) => {
        if (panning) {
          panning = false; img.style.transition = 'transform .2s ease';
          try { img.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      };
      img.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        endPan(e);
        if (moved) return;                 // it was a drag, not a click
        if (_lb._scale > 1) _lbReset();
        else _lbZoomTo(_LB_ZOOM, e.clientX, e.clientY);
      });
      img.addEventListener('pointercancel', endPan);
      img.addEventListener('click', (e) => e.stopPropagation());
      img.addEventListener('wheel', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.deltaY < 0 && _lb._scale === 1) { _lbZoomTo(_LB_ZOOM, e.clientX, e.clientY); }
        else if (e.deltaY > 0 && _lb._scale > 1) { _lbReset(); }
      }, { passive: false });
      const close = document.createElement('button');
      close.setAttribute('aria-label', 'Close');
      close.textContent = '\u2715';
      Object.assign(close.style, {
        position: 'absolute', top: '18px', right: '20px', width: '40px', height: '40px',
        borderRadius: '50%', border: '0', cursor: 'pointer', color: '#fff',
        background: 'rgba(255,255,255,.12)', font: '18px/1 system-ui,-apple-system,sans-serif'
      });
      close.addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
      _lb.addEventListener('click', closeLightbox);
      _lb.appendChild(img);
      _lb.appendChild(close);
      _lb._img = img;
      document.body.appendChild(_lb);
    }
    _lb._img.src = src;
    _lbReset();
    _lb.style.display = 'flex';
    void _lb.offsetWidth;
    _lb.style.opacity = '1';
    document.addEventListener('keydown', _lbEsc, true);
    _lbPrevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  }

  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'position', 'placeholder', 'src', 'id'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      // .spill and .ctl sit OUTSIDE .frame so overflow:hidden + border-radius
      // on the frame (circle, pill, rounded) can't clip them.
      root.innerHTML =
        '<style>' + stylesheet + '</style>' +
        '<div class="frame" part="frame">' +
        '  <img part="image" alt="" draggable="false" style="display:none">' +
        '  <div class="empty" part="empty">' + icon +
        '    <div class="cap"></div>' +
        '    <div class="sub">or <u>browse files</u></div></div>' +
        '  <div class="ring" part="ring"></div>' +
        '</div>' +
        '<div class="spill">' +
        '  <img class="ghost" alt="" draggable="false">' +
        '  <div class="handle" data-c="nw"></div><div class="handle" data-c="ne"></div>' +
        '  <div class="handle" data-c="sw"></div><div class="handle" data-c="se"></div>' +
        '</div>' +
        '<div class="ctl"><button data-act="zoomout" title="Zoom out">&#8722;</button>' +
        '  <button data-act="zoomin" title="Zoom in">+</button>' +
        '  <button data-act="expand" title="Expand image">Expand</button>' +
        '  <button data-act="replace" title="Replace image">Replace</button>' +
        '  <button data-act="clear" title="Remove image">Remove</button></div>' +
        '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._spill = root.querySelector('.spill');
      this._ghost = root.querySelector('.ghost');
      this._err = null;
      this._input = root.querySelector('input');
      this._depth = 0;
      this._gen = 0;
      this._view = { s: 1, x: 0, y: 0 };
      this._subFn = () => this._render();
      // Shadow-DOM listeners live with the shadow DOM — bound once here so
      // disconnect/reconnect (e.g. React remount) doesn't stack handlers.
      this._empty.addEventListener('click', () => this._input.click());
      root.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'zoomin') { e.stopPropagation(); this._zoomBy(1.18); return; }
        if (act === 'zoomout') { e.stopPropagation(); this._zoomBy(1 / 1.18); return; }
        if (act === 'expand') { const s = this._img.currentSrc || this._img.src; openLightbox(s); }
        if (act === 'replace') { this._exitReframe(true); this._input.click(); }
        if (act === 'clear') {
          this._exitReframe(false);
          this._gen++;
          this._local = null;
          if (this.id) setSlot(this.id, null); else this._render();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
      // naturalWidth/Height aren't known until load — re-apply so the cover
      // baseline is computed from real dimensions, not the 100%×100% fallback.
      this._img.addEventListener('load', () => this._applyView());
      // Gated on editable + fit=cover so share links and contain/fill slots
      // stay static.
      // Published view (no editor): a single click on a filled image opens the
      // lightbox. Gated to non-editable so it never competes with the editor's
      // double-click-to-reframe; there the Expand control does the same job.
      this.addEventListener('click', (e) => {
        if (this.hasAttribute('data-editable')) return;
        if (!this.hasAttribute('data-filled')) return;
        const s = this._img.currentSrc || this._img.src;
        openLightbox(s);
      });
      this.addEventListener('dblclick', (e) => {
        if (!this.hasAttribute('data-editable') || !this._reframes()) return;
        e.preventDefault();
        if (this.hasAttribute('data-reframe')) this._exitReframe(true);
        else this._enterReframe();
      });
      // Pan + resize both originate on the spill layer. A handle pointerdown
      // drives an aspect-locked resize anchored at the opposite corner; any
      // other pointerdown on the spill pans. Offsets are frame-% so a
      // reframed slot survives responsive resize / PPTX export.
      this._spill.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        e.stopPropagation();
        this._spill.setPointerCapture(e.pointerId);
        const rect = this.getBoundingClientRect();
        const fw = rect.width || 1, fh = rect.height || 1;
        const corner = e.target.getAttribute && e.target.getAttribute('data-c');
        let move;
        if (corner) {
          // Resize about the OPPOSITE corner. Viewport-px throughout (rect
          // fw/fh, not clientWidth) so the math survives a transform:scale()
          // ancestor — deck_stage renders slides scaled-to-fit.
          const iw = this._img.naturalWidth || 1, ih = this._img.naturalHeight || 1;
          const base = Math.max(fw / iw, fh / ih);
          const sx = corner.includes('e') ? 1 : -1;
          const sy = corner.includes('s') ? 1 : -1;
          const s0 = this._view.s;
          const w0 = iw * base * s0, h0 = ih * base * s0;
          const cx0 = (50 + this._view.x) / 100 * fw;
          const cy0 = (50 + this._view.y) / 100 * fh;
          const ox = cx0 - sx * w0 / 2, oy = cy0 - sy * h0 / 2;
          const diag0 = Math.hypot(w0, h0);
          const ux = sx * w0 / diag0, uy = sy * h0 / diag0;
          move = (ev) => {
            const proj = (ev.clientX - rect.left - ox) * ux +
                         (ev.clientY - rect.top - oy) * uy;
            const s = this._clampS(s0 * proj / diag0);
            const d = diag0 * s / s0;
            this._view.s = s;
            this._view.x = (ox + ux * d / 2) / fw * 100 - 50;
            this._view.y = (oy + uy * d / 2) / fh * 100 - 50;
            this._clampView();
            this._applyView();
          };
        } else {
          this.setAttribute('data-panning', '');
          const start = { px: e.clientX, py: e.clientY, x: this._view.x, y: this._view.y };
          move = (ev) => {
            this._view.x = start.x + (ev.clientX - start.px) / fw * 100;
            this._view.y = start.y + (ev.clientY - start.py) / fh * 100;
            this._clampView();
            this._applyView();
          };
        }
        const up = () => {
          try { this._spill.releasePointerCapture(e.pointerId); } catch {}
          this._spill.removeEventListener('pointermove', move);
          this._spill.removeEventListener('pointerup', up);
          this._spill.removeEventListener('pointercancel', up);
          this.removeAttribute('data-panning');
          this._dragUp = null;
        };
        // Stashed so _exitReframe (Escape / outside-click mid-drag) can
        // tear the capture + listeners down synchronously.
        this._dragUp = up;
        this._spill.addEventListener('pointermove', move);
        this._spill.addEventListener('pointerup', up);
        this._spill.addEventListener('pointercancel', up);
      });
      // Wheel zoom stays available inside reframe mode as a trackpad nicety —
      // zooms toward the cursor (offset' = cursor·(1-k) + offset·k).
      this.addEventListener('wheel', (e) => {
        if (!this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width * 100 - 50;
        const cy = (e.clientY - r.top) / r.height * 100 - 50;
        const prev = this._view.s;
        const next = this._clampS(prev * Math.pow(1.0015, -e.deltaY));
        if (next === prev) return;
        const k = next / prev;
        this._view.s = next;
        this._view.x = cx * (1 - k) + this._view.x * k;
        this._view.y = cy * (1 - k) + this._view.y * k;
        this._clampView();
        this._applyView();
      }, { passive: false });
    }

    connectedCallback() {
      // Warn once per page — an id-less slot works for the session but
      // cannot persist, and two id-less slots would share nothing.
      if (!this.id && !ImageSlot._warned) {
        ImageSlot._warned = true;
        console.warn('<image-slot> without an id will not persist its dropped image.');
      }
      this.addEventListener('dragenter', this);
      this.addEventListener('dragover', this);
      this.addEventListener('dragleave', this);
      this.addEventListener('drop', this);
      // Editability depends on the async-injected host bridge. If a slot
      // mounted before it arrived it rendered read-only; re-check the moment
      // the pointer enters (when the controls would be used) so they appear
      // without needing a reload. Cheap: _render() only runs if state flipped.
      this.addEventListener('pointerenter', () => {
        const nowEditable = !!(window.omelette && window.omelette.writeFile);
        if (nowEditable !== this.hasAttribute('data-editable')) this._render();
      });
      subs.add(this._subFn);
      // width%/height% in _applyView encode the frame aspect at call time —
      // a host resize (responsive grid, pane divider) would stretch the
      // image until the next _render. Re-render on size change: _render()
      // re-seeds _view from stored before clamp/apply, so a shrink→grow
      // cycle round-trips instead of ratcheting x/y toward the narrower
      // frame's clamp range.
      this._ro = new ResizeObserver(() => this._render());
      this._ro.observe(this);
      load();
      this._render();
    }

    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('dragenter', this);
      this.removeEventListener('dragover', this);
      this.removeEventListener('dragleave', this);
      this.removeEventListener('drop', this);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      this._exitReframe(false);
    }

    // Step zoom from the control bar (+/−). Enters reframe so the result is
    // visible, scales about the frame center, clamps, and persists.
    _zoomBy(factor) {
      if (!this.hasAttribute('data-filled')) return;
      if ((this.getAttribute('fit') || 'cover') !== 'cover') return;
      if (!this.hasAttribute('data-reframe')) this._enterReframe();
      const prev = (this._view && this._view.s) || 1;
      const next = this._clampS(prev * factor);
      if (next === prev) return;
      this._view.s = next;
      this._clampView();
      this._applyView();
      this._commitView();
    }

    _enterReframe() {
      if (this.hasAttribute('data-reframe')) return;
      this.setAttribute('data-reframe', '');
      this._applyView();
      // Close on click outside (the spill handler stopPropagation()s so
      // in-image drags don't reach this) and on Escape. Listeners are held
      // on the instance so _exitReframe / disconnectedCallback can detach
      // exactly what was attached.
      this._outside = (e) => {
        if (e.composedPath && e.composedPath().includes(this)) return;
        this._exitReframe(true);
      };
      this._esc = (e) => { if (e.key === 'Escape') this._exitReframe(true); };
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }

    _exitReframe(commit) {
      if (!this.hasAttribute('data-reframe')) return;
      if (this._dragUp) this._dragUp();
      this.removeAttribute('data-reframe');
      this.removeAttribute('data-panning');
      if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
      if (this._esc) document.removeEventListener('keydown', this._esc, true);
      this._outside = this._esc = null;
      if (commit) this._commitView();
    }

    attributeChangedCallback() { if (this.shadowRoot) this._render(); }

    // handleEvent — one listener object for all four drag events keeps the
    // add/remove symmetric and the depth counter correct.
    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        // Without preventDefault the browser never fires 'drop'.
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        // dragenter/leave fire for every descendant crossing — count depth
        // so hovering the icon inside the empty state doesn't flicker.
        if (--this._depth <= 0) { this._depth = 0; this.removeAttribute('data-over'); }
      } else if (e.type === 'drop') {
        e.preventDefault();
        e.stopPropagation();
        this._depth = 0;
        this.removeAttribute('data-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }
    }

    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        this._setError('Drop a PNG, JPEG, WebP, or AVIF image.');
        return;
      }
      // toDataUrl can take hundreds of ms on a large photo. A Clear or a
      // newer drop during that window would be clobbered when this await
      // resumes — bump + capture a generation so stale encodes bail.
      const gen = ++this._gen;
      try {
        const url = await toDataUrl(file);
        if (gen !== this._gen) return;
        // Only exit reframe once the new image is in hand — a rejected type
        // or decode failure leaves the in-progress crop untouched.
        this._exitReframe(false);
        const val = { u: url, s: 1, x: 0, y: 0 };
        setSlot(this.id || '', val);
        // Keep a session-local copy for id-less slots so the drop still
        // shows, even though it cannot persist.
        if (!this.id) { this._local = val; this._render(); }
      } catch (err) {
        if (gen !== this._gen) return;
        this._setError('Could not read that image.');
        console.warn('<image-slot> ingest failed:', err);
      }
    }

    _setError(msg) {
      if (this._err) { this._err.remove(); this._err = null; }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err'; d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => { if (this._err === d) { d.remove(); this._err = null; } }, 3000);
    }

    // Reframing (pan/resize) is only meaningful for fit=cover — contain/fill
    // keep the old object-fit path and double-click is a no-op.
    _reframes() {
      return this.hasAttribute('data-filled') &&
        (this.getAttribute('fit') || 'cover') === 'cover';
    }

    // Cover-baseline geometry, shared by clamp/apply/resize. Null until the
    // img has loaded (naturalWidth is 0 before that) or when the slot has no
    // layout box — ResizeObserver fires with a 0×0 rect under display:none,
    // and clamping against a degenerate 1×1 frame would silently pull the
    // stored pan toward zero.
    _geom() {
      const iw = this._img.naturalWidth, ih = this._img.naturalHeight;
      const fw = this.clientWidth, fh = this.clientHeight;
      if (!iw || !ih || !fw || !fh) return null;
      return { iw, ih, fw, fh, base: Math.max(fw / iw, fh / ih) };
    }

    _clampView() {
      // Pan range on each axis is half the overflow past the frame edge.
      const g = this._geom();
      if (!g) return;
      let mx = Math.max(0, (g.iw * g.base * this._view.s / g.fw - 1) * 50);
      let my = Math.max(0, (g.ih * g.base * this._view.s / g.fh - 1) * 50);
      // free-transform: allow positioning the image anywhere up to its center
      // reaching a frame edge, so a sub-cover image can be cropped at any tile
      // edge/corner (and can't be dragged entirely out of view).
      if (this.hasAttribute('free')) { mx = Math.max(mx, 50); my = Math.max(my, 50); }
      this._view.x = Math.max(-mx, Math.min(mx, this._view.x));
      this._view.y = Math.max(-my, Math.min(my, this._view.y));
    }

    // Smallest allowed scale multiplier (×cover-base). Default slots floor at
    // cover (1) so the frame is always filled. `free` slots may shrink to ~half
    // their contain size so a logo can sit small inside the tile with backdrop
    // showing around it.
    _minScale() {
      if (!this.hasAttribute('free')) return 1;
      const g = this._geom();
      if (!g) return 0.1;
      const containOverCover = Math.min(g.fw / g.iw, g.fh / g.ih) / g.base;
      return Math.min(1, containOverCover * 0.5);
    }
    _clampS(s) { return Math.max(this._minScale(), Math.min(S_MAX, s)); }

    _applyView() {
      const g = this._geom();
      const fit = this.getAttribute('fit') || 'cover';
      if (fit !== 'cover' || !g) {
        // Non-cover, or dimensions not known yet (before img load).
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = fit;
        this._img.style.objectPosition = this.getAttribute('position') || '50% 50%';
        return;
      }
      // Cover baseline: img fills the frame on its tighter axis at s=1, so
      // pan works immediately on the overflowing axis without zooming first.
      // Width/height and left/top are all frame-% — depends only on the
      // frame aspect ratio, so a responsive resize keeps the same crop. The
      // spill layer mirrors the same box so its corners = image corners.
      const k = g.base * this._view.s;
      const w = (g.iw * k / g.fw * 100) + '%';
      const h = (g.ih * k / g.fh * 100) + '%';
      const l = (50 + this._view.x) + '%';
      const t = (50 + this._view.y) + '%';
      this._img.style.width = w; this._img.style.height = h;
      this._img.style.left = l; this._img.style.top = t;
      this._img.style.objectFit = '';
      this._spill.style.width = w; this._spill.style.height = h;
      this._spill.style.left = l; this._spill.style.top = t;
    }

    _commitView() {
      const v = { s: this._view.s, x: this._view.x, y: this._view.y };
      if (this._userUrl) v.u = this._userUrl;
      // Framing-only (no u) persists too so an author-src slot remembers its
      // crop; clearing the sidecar still falls through to src=.
      if (this.id) setSlot(this.id, v);
      else { this._local = v; }
    }

    _render() {
      // Shape / mask. Presets use border-radius so the dashed ring can
      // follow the rounded outline; clip-path is only applied for an
      // explicit `mask` (the ring is hidden there since a rectangle
      // dashed border chopped by an arbitrary polygon looks broken).
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';
      else if (shape === 'pill') radius = '9999px';
      else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      // Controls and reframe entry gate on this so share links stay read-only.
      const editable = !!(window.omelette && window.omelette.writeFile);
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';

      // Content. The sidecar is also writable by the agent's write_file
      // tool, so its value isn't guaranteed canvas-originated — only accept
      // data:image/ URLs from it. The `src` attribute is author-controlled
      // (Claude wrote it into the HTML) so it passes through unchanged.
      let stored = this.id ? getSlot(this.id) : this._local;
      if (stored && stored.u && !/^data:image\//i.test(stored.u)) stored = null;
      const srcAttr = this.getAttribute('src') || '';
      this._userUrl = (stored && stored.u) || null;
      const url = this._userUrl || srcAttr;
      // Don't clobber an in-flight reframe with a store-triggered re-render.
      if (!this.hasAttribute('data-reframe')) {
        this._view = {
          s: stored && Number.isFinite(stored.s)
            ? (this.hasAttribute('free') ? Math.max(0.05, Math.min(S_MAX, stored.s)) : clampS(stored.s))
            : 1,
          x: stored && Number.isFinite(stored.x) ? stored.x : 0,
          y: stored && Number.isFinite(stored.y) ? stored.y : 0,
        };
      }
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an image';
      // Toggle via style.display — the [hidden] attribute alone loses to
      // the display:flex / display:block rules in the stylesheet above.
      if (url) {
        if (this._img.getAttribute('src') !== url) {
          this._img.src = url;
          this._ghost.src = url;
        }
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.setAttribute('data-filled', '');
        this._clampView();
        this._applyView();
      } else {
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._ghost.removeAttribute('src');
        this._empty.style.display = 'flex';
        this.removeAttribute('data-filled');
      }
    }
  }

  if (!customElements.get('image-slot')) {
    customElements.define('image-slot', ImageSlot);
  }
})();
