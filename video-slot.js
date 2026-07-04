// <video-slot> — a drag-and-drop VIDEO placeholder, sibling to <image-slot>.
// The user drops a video file (or clicks to browse) and it plays inline with
// native controls. The dropped file persists in the browser via IndexedDB
// (keyed by the slot's id), so it survives reloads — same idea as <image-slot>,
// but for video, with no canvas re-encode (videos are stored as-is as Blobs).
//
//   <video-slot id="motion" radius="24" placeholder="Drop your .mp4"
//               style="width:100%;height:480px"></video-slot>
//
// Attributes:
//   id           Persistence key (REQUIRED for the drop to survive reload).
//   radius       Corner radius in px (default 16).
//   placeholder  Empty-state caption (default 'Drop a video').
//   src          Optional fallback video URL (author-set, e.g. a baked file).
//                A user drop overrides it. Used at publish time.
//   loop/muted/autoplay/controls — forwarded to the <video> (controls default on).
//
// At publish time the agent can bake the stored Blob to a real file and set
// `src` so visitors get the video without needing the browser store.
(() => {
  const DB = 'video-slots';
  const STORE = 'videos';
  // Accept video AND image/gif. GIFs (and stills) are stored as-is and shown
  // through an <img> so animated GIFs keep animating — a <video> can't play a
  // GIF, and the image-slot would re-encode and freeze it to one frame.
  const ACCEPT = 'video/*,image/gif,image/*';
  const isVideoType = (t) => /^video\//i.test(t || '');
  const isImageType = (t) => /^image\//i.test(t || '');
  const looksVideoName = (n) => /\.(mp4|m4v|mov|webm|ogv|ogg)$/i.test(n || '');
  const looksImageName = (n) => /\.(gif|png|jpe?g|webp|avif|apng|bmp|svg)$/i.test(n || '');

  let dbP = null;
  function idb() {
    if (dbP) return dbP;
    dbP = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (e) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbP;
  }
  function idbGet(id) {
    return idb().then((db) => {
      if (!db) return null;
      return new Promise((resolve) => {
        let tx;
        try { tx = db.transaction(STORE, 'readonly'); } catch (e) { resolve(null); return; }
        const rq = tx.objectStore(STORE).get(id);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      });
    });
  }
  function idbPut(id, blob) {
    return idb().then((db) => {
      if (!db) return false;
      return new Promise((resolve) => {
        let tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { resolve(false); return; }
        try { tx.objectStore(STORE).put(blob, id); } catch (e) { resolve(false); return; }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    });
  }
  function idbDel(id) {
    return idb().then((db) => {
      if (!db) return;
      return new Promise((resolve) => {
        let tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { resolve(); return; }
        try { tx.objectStore(STORE).delete(id); } catch (e) {}
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    });
  }

  // Embed-link support: users can paste a YouTube / Vimeo / Loom or direct video
  // URL instead of uploading a file. The URL persists in localStorage keyed by
  // slot id (parallel to the IndexedDB blob store).
  const EMB_KEY = 'video-slot-embeds';
  function embGet(id) {
    try { const m = JSON.parse(localStorage.getItem(EMB_KEY) || '{}'); return (id && m[id]) || null; } catch (e) { return null; }
  }
  function embSet(id, url) {
    if (!id) return;
    try {
      const m = JSON.parse(localStorage.getItem(EMB_KEY) || '{}');
      if (url) m[id] = url; else delete m[id];
      localStorage.setItem(EMB_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  // Turn a pasted URL into an embeddable source. Returns {type:'file'|'iframe', src}.
  function toEmbed(u) {
    if (!u) return null;
    let s = String(u).trim();
    if (!s) return null;
    // Full <iframe …> embed snippet pasted from a "Share → Embed" dialog: pull
    // the src URL out and use it directly (SoundCloud, Spotify, YouTube, etc.).
    const iframeSrc = s.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
    if (iframeSrc) return { type: 'iframe', src: iframeSrc[1].replace(/&amp;/g, '&') };
    if (/\.(mp4|m4v|webm|ogv|ogg|mov)(\?.*)?$/i.test(s)) return { type: 'file', src: s };
    let m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i);
    if (m) return { type: 'iframe', src: 'https://www.youtube.com/embed/' + m[1] };
    m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (m) return { type: 'iframe', src: 'https://player.vimeo.com/video/' + m[1] };
    m = s.match(/loom\.com\/(?:share|embed)\/([\w-]+)/i);
    if (m) return { type: 'iframe', src: 'https://www.loom.com/embed/' + m[1] };
    // Spotify (track / album / playlist / episode / show) → embed player.
    m = s.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([\w]+)/i);
    if (m) return { type: 'iframe', src: 'https://open.spotify.com/embed/' + m[1] + '/' + m[2] };
    // SoundCloud → visual player via the widget API.
    if (/soundcloud\.com\//i.test(s) && !/w\.soundcloud\.com\/player/i.test(s)) {
      return { type: 'iframe', src: 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(s) + '&visual=true&hide_related=true' };
    }
    if (/^https?:\/\//i.test(s)) return { type: 'iframe', src: s };
    return null;
  }

  // Public store API so host pages can duplicate a video tile WITH its video.
  // copy(srcId,dstId) clones the stored Blob AND any embed URL from one slot id
  // to another, then re-renders any mounted slot for dstId so it plays at once.
  window.VideoSlotStore = window.VideoSlotStore || {
    copy(srcId, dstId) {
      if (!srcId || !dstId || srcId === dstId) return Promise.resolve(false);
      const emb = embGet(srcId);
      if (emb) embSet(dstId, emb);
      return idbGet(srcId).then((blob) => {
        const done = () => {
          const el = document.getElementById(dstId);
          if (el && typeof el.render === 'function') { try { el.render(); } catch (e) {} }
          return true;
        };
        if (!blob) return emb ? done() : false;
        return idbPut(dstId, blob).then(done);
      });
    },
    has(id) { return !!embGet(id) || idbGet(id).then((b) => !!b); }
  };

  // Editing affordances (drop hint, Replace/Remove) only show inside the editor
  // host; a published/exported page just plays whatever video is set.
  function editable() {
    return !!(window.omelette || window.parent !== window);
  }

  const css =
    ':host{display:inline-block;position:relative;vertical-align:top;width:240px;height:160px;' +
    '  font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55)}' +
    '.frame{position:absolute;inset:0;overflow:hidden;border-radius:var(--r,16px);background:var(--bg,#0B0B0C)}' +
    '.vid{position:absolute;inset:0;width:100%;height:100%;object-fit:var(--fit,cover);display:none;background:var(--bg,#000)}' +
    '.img{position:absolute;inset:0;width:100%;height:100%;object-fit:var(--fit,cover);display:none;background:var(--bg,#000)}' +
    '.emb{position:absolute;inset:0;width:100%;height:100%;border:0;display:none;background:#000}' +
    ':host([data-filled][data-kind="video"]) .vid{display:block}' +
    ':host([data-filled][data-kind="image"]) .img{display:block}' +
    ':host([data-filled][data-kind="embed"]) .emb{display:block}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' +
    '  border-radius:var(--r,16px);background:#F4F4F2}' +
    ':host([data-filled]) .empty{display:none}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(0,0,0,.25);' +
    '  border-radius:var(--r,16px)}' +
    '.ic{opacity:.5}' +
    '.cap{font-weight:600;color:rgba(0,0,0,.62)}' +
    '.sub{font-size:12px}' +
    '.sub u{cursor:pointer;text-underline-offset:2px;text-decoration-color:rgba(0,0,0,.25)}' +
    '.empty:hover .sub u{color:rgba(0,0,0,.75);text-decoration-color:currentColor}' +
    ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px}' +
    ':host([data-over]) .empty{background:rgba(201,100,66,.10)}' +
    '.err{position:absolute;left:0;right:0;bottom:0;padding:7px 10px;font-size:11px;' +
    '  background:rgba(201,40,40,.92);color:#fff;text-align:center}' +
    '.ctl{position:absolute;top:8px;right:8px;display:none;gap:6px;z-index:2}' +
    ':host([data-filled][data-editable]) .ctl{display:flex}' +
    // expand button shows on any filled video (editor AND published) so the
    // player can always be enlarged even when the native fullscreen control is
    // blocked by a sandboxed frame.
    '.exp{position:absolute;top:10px;right:10px;display:none;align-items:center;justify-content:center;' +
    '  width:34px;height:34px;border:none;border-radius:9px;background:rgba(0,0,0,.55);color:#fff;' +
    '  cursor:pointer;z-index:2;backdrop-filter:blur(6px)}' +
    ':host([data-filled]) .exp{display:flex}' +
    ':host([data-kind="embed"]) .exp{display:none}' +
    '.exp:hover{background:rgba(0,0,0,.8)}' +
    '.ctl button{font:600 11px/1 system-ui;color:#fff;background:rgba(0,0,0,.55);border:none;' +
    '  border-radius:7px;padding:7px 9px;cursor:pointer;backdrop-filter:blur(6px)}' +
    '.ctl button:hover{background:rgba(0,0,0,.8)}' +
    // hide the empty-state on a published page (no editor) so it isn't an
    // interactive dropzone for visitors — show only if there's genuinely no video.
    ':host(:not([data-editable]):not([data-filled])) .ring{opacity:.4}';

  const ICON =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z" fill="currentColor"/></svg>';

  class VideoSlot extends HTMLElement {
    connectedCallback() {
      if (!this._built) this._build();
      this._objUrl = null;
      this.render();
    }
    disconnectedCallback() {
      if (this._objUrl) { URL.revokeObjectURL(this._objUrl); this._objUrl = null; }
    }

    _build() {
      this._built = true;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' + css + '</style>' +
        '<div class="frame">' +
        '  <video class="vid" draggable="false" muted playsinline controlslist="nofullscreen noremoteplayback" disablepictureinpicture></video>' +
        '  <img class="img" draggable="false" alt="">' +
        '  <iframe class="emb" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
        '  <div class="empty"><div class="ic">' + ICON + '</div>' +
        '    <div class="cap"></div><div class="sub">or <u>browse files</u> · <u data-act="link">embed link</u></div></div>' +
        '  <div class="ring"></div>' +
        '  <div class="ctl"><button data-act="link">Link</button>' +
        '    <button data-act="replace">Replace</button>' +
        '    <button data-act="clear">Remove</button></div>' +
        '  <button class="exp" data-act="expand" title="Expand" aria-label="Expand video">' +
        '    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>' +
        '  </button>' +
        '</div>' +
        '<input type="file" accept="' + ACCEPT + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._vid = root.querySelector('.vid');
      this._img = root.querySelector('.img');
      this._emb = root.querySelector('.emb');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._input = root.querySelector('input');
      this._err = null;
      this._depth = 0;

      this._empty.addEventListener('click', (e) => {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-act') === 'link') { e.stopPropagation(); this._promptLink(); return; }
        if (editable()) this._input.click();
      });
      root.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'link') { e.stopPropagation(); this._promptLink(); return; }
        if (act === 'replace') this._input.click();
        if (act === 'expand') this._openLightbox();
        if (act === 'clear') {
          if (this.id) { idbDel(this.id); embSet(this.id, null); }
          this._localBlob = null;
          if (this._objUrl) { URL.revokeObjectURL(this._objUrl); this._objUrl = null; }
          this._vid.removeAttribute('src');
          this._vid.load();
          if (this._img) this._img.removeAttribute('src');
          if (this._emb) this._emb.removeAttribute('src');
          this.removeAttribute('data-filled');
          this.render();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });

      ['dragenter', 'dragover'].forEach((t) => this.addEventListener(t, (e) => {
        if (!editable()) return;
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        this.setAttribute('data-over', '');
      }));
      ['dragleave', 'drop'].forEach((t) => this.addEventListener(t, (e) => {
        e.preventDefault(); e.stopPropagation();
        if (t === 'dragleave') { this.removeAttribute('data-over'); return; }
        this.removeAttribute('data-over');
        if (!editable()) return;
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }));
    }

    _setError(msg) {
      if (this._err) { this._err.remove(); this._err = null; }
      if (msg) {
        this._err = document.createElement('div');
        this._err.className = 'err';
        this._err.textContent = msg;
        this._frame.appendChild(this._err);
        setTimeout(() => { if (this._err) { this._err.remove(); this._err = null; } }, 3200);
      }
    }

    _promptLink() {
      if (!editable()) return;
      const cur = (this.id && embGet(this.id)) || '';
      const raw = window.prompt('Paste a video link (YouTube, Vimeo, Loom, or a direct .mp4 URL):', cur);
      if (raw === null) return; // cancelled
      const val = raw.trim();
      if (!val) { // cleared
        if (this.id) embSet(this.id, null);
        this._emb.removeAttribute('src');
        this.removeAttribute('data-filled');
        this.render();
        return;
      }
      const parsed = toEmbed(val);
      if (!parsed) { this._setError('Unrecognised link. Use a YouTube, Vimeo, Loom, or direct video URL.'); return; }
      // A link replaces any uploaded file for this slot.
      if (this.id) { idbDel(this.id); embSet(this.id, val); }
      this._localBlob = null;
      if (this._objUrl) { URL.revokeObjectURL(this._objUrl); this._objUrl = null; }
      this._setError(null);
      this.render();
    }

    async _ingest(file) {
      this._setError(null);
      const okVideo = isVideoType(file && file.type) || looksVideoName(file && file.name);
      const okImage = isImageType(file && file.type) || looksImageName(file && file.name);
      if (!file || (!okVideo && !okImage)) {
        this._setError('Drop a video (MP4) or a GIF.');
        return;
      }
      this._localBlob = file;
      if (this.id) await idbPut(this.id, file);
      this.render();
    }

    // Decide whether a blob/src should render as <video> or <img>.
    _kindOf(blob, srcAttr) {
      if (blob) {
        if (isImageType(blob.type)) return 'image';
        if (isVideoType(blob.type)) return 'video';
        return looksImageName(blob.name) ? 'image' : 'video';
      }
      if (srcAttr) return looksImageName(srcAttr) ? 'image' : 'video';
      return 'video';
    }

    _openLightbox() {
      const isImg = this.getAttribute('data-kind') === 'image';
      const src = isImg ? this._img.getAttribute('src') : this._vid.getAttribute('src');
      if (!src) return;
      // Pause the inline player so only the enlarged copy is playing.
      try { this._vid.pause(); } catch (e) {}
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:24px;';
      let v;
      if (isImg) {
        v = document.createElement('img');
        v.src = src;
        v.style.cssText = 'max-width:96vw;max-height:92vh;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.6);';
      } else {
        v = document.createElement('video');
        v.src = src; v.controls = true; v.autoplay = true; v.loop = this._vid.loop; v.playsInline = true;
        v.style.cssText = 'max-width:96vw;max-height:92vh;border-radius:12px;background:#000;box-shadow:0 30px 90px rgba(0,0,0,.6);';
      }
      const x = document.createElement('button');
      x.type = 'button'; x.innerHTML = '&times;'; x.setAttribute('aria-label', 'Close');
      x.style.cssText = 'position:absolute;top:16px;right:18px;width:40px;height:40px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:24px;line-height:1;cursor:pointer;';
      const close = () => { try { v.pause(); } catch (e) {} ov.remove(); document.removeEventListener('keydown', onKey, true); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      x.addEventListener('click', (e) => { e.stopPropagation(); close(); });
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.appendChild(v); ov.appendChild(x);
      document.body.appendChild(ov);
      document.addEventListener('keydown', onKey, true);
    }

    async render() {
      const r = this.getAttribute('radius');
      // Set CSS vars on the shadow-DOM frame, NOT the host: the DC runtime
      // re-applies the host's literal style attribute after our initial render,
      // which would wipe host-level custom properties. The frame is inside the
      // shadow root, untouched by the runtime, and .vid/.img/.empty/.ring all
      // inherit from it.
      if (r) this._frame.style.setProperty('--r', parseInt(r, 10) + 'px');
      const bg = this.getAttribute('bg');
      if (bg) this._frame.style.setProperty('--bg', bg); else this._frame.style.removeProperty('--bg');
      const fit = this.getAttribute('fit');
      if (fit) this._frame.style.setProperty('--fit', fit); else this._frame.style.removeProperty('--fit');
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop a video';
      if (editable()) this.setAttribute('data-editable', ''); else this.removeAttribute('data-editable');

      // controls / loop forwarded. The INLINE player is ALWAYS muted — a grid
      // of autoplaying tiles must never make noise on its own; sound only
      // happens in the expand lightbox (an explicit click). Set both the
      // property and defaultMuted so a re-render or src swap can't unmute it.
      this._vid.controls = this.getAttribute('controls') !== 'false';
      this._vid.loop = this.hasAttribute('loop');
      this._vid.muted = true;
      this._vid.defaultMuted = true;
      this._vid.setAttribute('muted', '');
      if (this.hasAttribute('autoplay')) this._vid.autoplay = true;

      // Source priority: uploaded file (Blob) > embed link > author src attr.
      let blob = this._localBlob || null;
      if (!blob && this.id) blob = await idbGet(this.id);
      const embRaw = (!blob && this.id) ? embGet(this.id) : null;
      const emb = embRaw ? toEmbed(embRaw) : null;

      // Embed link (iframe player) takes over the whole tile.
      if (emb && emb.type === 'iframe') {
        this.setAttribute('data-kind', 'embed');
        if (this._emb.getAttribute('src') !== emb.src) this._emb.src = emb.src;
        this._vid.removeAttribute('src');
        if (this._img) this._img.removeAttribute('src');
        this.setAttribute('data-filled', '');
        return;
      }
      if (this._emb) this._emb.removeAttribute('src');

      const srcAttr = (emb && emb.type === 'file') ? emb.src : (this.getAttribute('src') || '');
      const kind = this._kindOf(blob, srcAttr);
      this.setAttribute('data-kind', kind);

      const url = blob ? (this._objUrl ? (URL.revokeObjectURL(this._objUrl), URL.createObjectURL(blob)) : URL.createObjectURL(blob))
                       : (srcAttr || '');
      if (blob) this._objUrl = url;

      if (url) {
        if (kind === 'image') {
          if (this._img.getAttribute('src') !== url) this._img.src = url;
          this._vid.removeAttribute('src');
        } else {
          if (this._vid.getAttribute('src') !== url) {
            this._vid.preload = 'auto';
            this._vid.src = url;
            this._vid.load();
            this._primeFrame();
          }
          this._img.removeAttribute('src');
        }
        this.setAttribute('data-filled', '');
      } else {
        this.removeAttribute('data-filled');
      }
    }

    // Guarantee the tile shows real content the instant it's restored: kick off
    // autoplay (muted, so browsers allow it) and, as a fallback for when
    // autoplay is blocked, nudge the current time so the first frame paints
    // instead of leaving a black box.
    _primeFrame() {
      const v = this._vid;
      const onLoaded = () => {
        v.removeEventListener('loadeddata', onLoaded);
        if (this.hasAttribute('autoplay')) {
          const p = v.play();
          if (p && p.catch) p.catch(() => { try { v.currentTime = 0.05; } catch (e) {} });
        } else {
          try { v.currentTime = 0.05; } catch (e) {}
        }
      };
      v.addEventListener('loadeddata', onLoaded);
    }
  }

  if (!customElements.get('video-slot')) customElements.define('video-slot', VideoSlot);
})();
