// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Web File Manager – Frontend
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let currentPath = '/';
  let viewMode = localStorage.getItem('viewMode') || 'grid';
  let sortMode = localStorage.getItem('sortMode') || 'name-asc';
  let showDotFiles = localStorage.getItem('showDotFiles') === 'true';
  let pendingDelete = null;
  let allItems = [];
  let selected = new Set();
  let lastClickedIdx = -1;
  let searchQuery = '';
  let wallpaper = localStorage.getItem('wallpaper') || 'none';
  let wallpaperUrl = localStorage.getItem('wallpaperUrl') || '';
  let clipboard = null; // { paths: [], action: 'copy' | 'cut' }
  let trashCount = 0;
  let previewTextCache = '';  // for the copy button

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const fileContainer    = $('#file-container');
  const breadcrumb       = $('#breadcrumb');
  const itemCount        = $('#item-count');
  const loading          = $('#loading');
  const emptyState       = $('#empty-state');
  const emptyText        = $('#empty-text');
  const dropOverlay      = $('#drop-overlay');
  const toastContainer   = $('#toast-container');
  const fileInput        = $('#file-input');
  const storageBadge     = $('#storage-badge');
  const multiBar         = $('#multi-bar');
  const multiCount       = $('#multi-count');
  const dragMoveHint     = $('#drag-move-hint');
  const dragTargetName   = $('#drag-target-name');
  const wpEl             = $('#wallpaper');
  const searchInput      = $('#search-input');
  const contextMenu      = $('#context-menu');
  const contextMenuEmpty = $('#context-menu-empty');
  const uploadProgress   = $('#upload-progress');
  const uploadProgressBar = $('#upload-progress-bar');
  const uploadProgressText = $('#upload-progress-text');

  const btnUpload    = $('#btn-upload');
  const btnMkdir     = $('#btn-mkdir');
  const btnGrid      = $('#btn-grid');
  const btnList      = $('#btn-list');
  const btnSettings  = $('#btn-settings');
  const btnTrash     = $('#btn-trash');
  const trashCountEl = $('#trash-count');
  const sortSelect   = $('#sort-select');
  const dotToggle    = $('#toggle-dotfiles');

  const modalDelete  = $('#modal-delete');
  const modalMkdir   = $('#modal-mkdir');
  const modalPreview = $('#modal-preview');
  const modalSettings = $('#modal-settings');
  const modalTrash   = $('#modal-trash');
  const deleteTargetName = $('#delete-target-name');
  const mkdirNameInput   = $('#mkdir-name');
  const bcJumpBtn    = $('#bc-jump');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showLoading() { loading.classList.remove('hidden'); }
  function hideLoading() { loading.classList.add('hidden'); }

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove());
    }, 3000);
  }

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function iconFor(name, isDir) {
    if (isDir) return '📁';
    const ext = name.split('.').pop().toLowerCase();
    const m = {
      jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🖼️',svg:'🖼️',webp:'🖼️',bmp:'🖼️',ico:'🖼️',avif:'🖼️',tiff:'🖼️',
      mp4:'🎬',avi:'🎬',mkv:'🎬',mov:'🎬',wmv:'🎬',webm:'🎬',
      mp3:'🎵',wav:'🎵',flac:'🎵',aac:'🎵',ogg:'🎵',
      pdf:'📕',doc:'📘',docx:'📘',xls:'📗',xlsx:'📗',ppt:'📙',pptx:'📙',
      zip:'📦',rar:'📦','7z':'📦',tar:'📦',gz:'📦',
      exe:'⚙️',sh:'⚙️',bat:'⚙️',
    };
    return m[ext] || '📄';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ── Syntax highlighting (highlight.js via CDN) ───────────────────────────
  // Map file extensions to highlight.js language IDs. Falls back to 'plaintext'
  // when hljs is not loaded (e.g., offline) — text is still readable.
  const HLJS_LANG_MAP = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp',
    cs: 'csharp', go: 'go', rs: 'rust', php: 'php',
    html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'scss', sass: 'scss', less: 'less',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
    md: 'markdown', markdown: 'markdown',
    sql: 'sql', graphql: 'graphql', gql: 'graphql',
    vue: 'xml', svelte: 'xml', astro: 'xml',
    log: 'plaintext', txt: 'plaintext', env: 'plaintext',
    csv: 'plaintext', tsv: 'plaintext',
    dockerfile: 'dockerfile', makefile: 'makefile',
    lua: 'lua', perl: 'perl', pl: 'perl', r: 'r',
    ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell',
  };
  function detectHljsLang(name) {
    const ext = name.split('.').pop().toLowerCase();
    return HLJS_LANG_MAP[ext] || 'plaintext';
  }
  function highlightCode(text, name) {
    if (!window.hljs) return null;  // CDN unavailable; caller falls back to plain
    try {
      const lang = detectHljsLang(name);
      if (lang === 'plaintext') return null;
      const result = window.hljs.highlight(text, { language: lang, ignoreIllegals: true });
      return result.value;
    } catch { return null; }
  }

  // Copy text to clipboard with fallback for non-secure contexts (http://LAN).
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    // Fallback: hidden textarea + execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  // ── API ────────────────────────────────────────────────────────────────────
  function handleAuthError(r) {
    if (r.status === 401) { window.location.href = '/login.html'; throw new Error('登录已过期'); }
  }
  async function apiGet(url) {
    const r = await fetch(url);
    handleAuthError(r);
    if (!r.ok) { const e = await r.json().catch(()=>({error:r.statusText})); throw new Error(e.error); }
    return r.json();
  }
  async function apiPost(url, body) {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    handleAuthError(r);
    if (!r.ok) { const e = await r.json().catch(()=>({error:r.statusText})); throw new Error(e.error); }
    return r.json();
  }
  async function apiDelete(url, body) {
    const r = await fetch(url, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    handleAuthError(r);
    if (!r.ok) { const e = await r.json().catch(()=>({error:r.statusText})); throw new Error(e.error); }
    return r.json();
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  function sortItems(items) {
    const sorted = [...items];
    const [key, dir] = sortMode.split('-');
    const mul = dir === 'desc' ? -1 : 1;
    sorted.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      switch (key) {
        case 'name': return mul * a.name.localeCompare(b.name);
        case 'date': return mul * (new Date(a.modified) - new Date(b.modified));
        case 'size': return mul * (a.size - b.size);
        case 'type': {
          const ea = a.name.split('.').pop().toLowerCase();
          const eb = b.name.split('.').pop().toLowerCase();
          const cmp = ea.localeCompare(eb);
          return cmp !== 0 ? mul * cmp : a.name.localeCompare(b.name);
        }
        default: return 0;
      }
    });
    return sorted;
  }

  function getDisplayItems() {
    let items = [...allItems];
    if (!showDotFiles) items = items.filter(i => !i.name.startsWith('.'));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q));
    }
    return sortItems(items);
  }

  // ── Breadcrumb ─────────────────────────────────────────────────────────────
  function renderBreadcrumb() {
    const parts = currentPath.split('/').filter(Boolean);
    const segs = [{ name: '🏠 根目录', path: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      segs.push({ name: part, path: acc });
    }
    breadcrumb.innerHTML = segs.map((s, i) => {
      const isLast = i === segs.length - 1;
      const cls = isLast ? 'bc-seg current' : 'bc-seg';
      return `<button class="${cls}" data-path="${s.path}" title="${escapeHtml(s.path)}">${escapeHtml(s.name)}</button>` +
             (isLast ? '' : '<span class="sep">/</span>');
    }).join('') + `<button class="bc-jump" id="bc-jump" title="跳转到路径">📍</button>`;
    breadcrumb.querySelectorAll('.bc-seg').forEach(b =>
      b.addEventListener('click', () => navigateTo(b.dataset.path)));
    const jump = $('#bc-jump');
    if (jump) jump.addEventListener('click', openPathJump);
  }

  // Path-jump input: lets user paste/type an absolute path to navigate.
  function openPathJump() {
    // Toggle: if input already visible, blur it.
    const existing = $('#bc-jump-input');
    if (existing) { existing.remove(); return; }
    const inp = document.createElement('input');
    inp.id = 'bc-jump-input';
    inp.type = 'text';
    inp.className = 'bc-jump-input';
    inp.placeholder = '输入路径回车跳转 (例如 /docs/reports)';
    inp.value = currentPath;
    breadcrumb.appendChild(inp);
    inp.focus();
    inp.select();
    const commit = () => {
      const v = inp.value.trim();
      inp.remove();
      if (!v || v === currentPath) return;
      navigateTo(v.startsWith('/') ? v : '/' + v);
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') inp.remove();
    });
    inp.addEventListener('blur', commit);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderFiles() {
    const items = getDisplayItems();
    renderBreadcrumb();

    if (searchQuery) {
      itemCount.textContent = `搜索 "${searchQuery}" — ${items.length} 个结果`;
    } else {
      itemCount.textContent = `${items.length} 个项目`;
    }

    if (items.length === 0) {
      fileContainer.innerHTML = '';
      emptyState.classList.remove('hidden');
      emptyText.textContent = searchQuery ? `没有找到 "${searchQuery}"` : '此文件夹为空';
      return;
    }
    emptyState.classList.add('hidden');

    fileContainer.innerHTML = items.map((item, idx) => {
      const icon = iconFor(item.name, item.isDirectory);
      const date = formatDate(item.modified);
      const sel = selected.has(item.path) ? ' selected' : '';
      const delay = Math.min(idx * 30, 400);

      if (viewMode === 'grid') {
        let iconHtml;
        if (item.isImage) {
          iconHtml = `<div class="thumb-wrap"><img src="/api/thumbnail?path=${encodeURIComponent(item.path)}" alt="${escapeHtml(item.name)}" loading="lazy"></div>`;
        } else if (item.isText && !item.isDirectory) {
          iconHtml = `<div class="file-icon text-icon" data-preview-path="${item.path}"><span class="text-snippet">…</span></div>`;
        } else {
          iconHtml = `<div class="file-icon">${icon}</div>`;
        }
        return `
          <div class="file-card${sel}" data-path="${item.path}" data-name="${item.name}"
               data-dir="${item.isDirectory}" data-image="${item.isImage}" data-text="${item.isText}" data-idx="${idx}"
               style="animation-delay:${delay}ms"
               draggable="${item.isDirectory ? 'false' : 'true'}">
            <div class="file-actions-list">
              <button class="btn-mini" data-action="preview" title="预览">👁️</button>
              <button class="btn-mini" data-action="rename" title="重命名">✏️</button>
              <button class="btn-mini danger" data-action="delete" title="删除">🗑️</button>
            </div>
            ${iconHtml}
            <div class="file-name">${escapeHtml(item.name)}</div>
            <div class="file-meta">${item.isDirectory ? '' : item.sizeFormatted + ' · '}${date}</div>
          </div>`;
      } else {
        let iconHtml;
        if (item.isImage) {
          iconHtml = `<div class="thumb-wrap"><img src="/api/thumbnail?path=${encodeURIComponent(item.path)}" alt="" loading="lazy"></div>`;
        } else {
          iconHtml = `<div class="file-icon">${icon}</div>`;
        }
        return `
          <div class="file-row${sel}" data-path="${item.path}" data-name="${item.name}"
               data-dir="${item.isDirectory}" data-image="${item.isImage}" data-text="${item.isText}" data-idx="${idx}"
               style="animation-delay:${Math.min(idx * 25, 300)}ms"
               draggable="${item.isDirectory ? 'false' : 'true'}">
            ${iconHtml}
            <div class="file-name">${escapeHtml(item.name)}</div>
            <div class="file-size">${item.isDirectory ? '—' : item.sizeFormatted}</div>
            <div class="file-date">${date}</div>
            <div class="file-actions">
              ${!item.isDirectory ? `<button class="btn-mini" data-action="preview" title="预览">👁️</button>` : ''}
              ${!item.isDirectory ? `<button class="btn-mini" data-action="download" title="下载">⬇️</button>` : ''}
              <button class="btn-mini" data-action="rename" title="重命名">✏️</button>
              <button class="btn-mini danger" data-action="delete" title="删除">🗑️</button>
            </div>
          </div>`;
      }
    }).join('');

    // Text snippets
    fileContainer.querySelectorAll('.text-icon[data-preview-path]').forEach(el => {
      fetch(`/api/preview?path=${encodeURIComponent(el.dataset.previewPath)}`)
        .then(r => r.json()).then(d => {
          el.querySelector('.text-snippet').textContent = d.content.slice(0, 200) || '(空)';
        }).catch(() => { el.querySelector('.text-snippet').textContent = '(无法加载)'; });
    });

    // Click handlers
    attachFileHandlers();
    updateMultiBar();
  }

  function attachFileHandlers() {
    fileContainer.querySelectorAll('.file-card, .file-row').forEach(el => {
      el.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (btn) {
          e.stopPropagation();
          handleAction(btn.dataset.action, el.dataset.path, el.dataset.name,
            el.dataset.dir === 'true', el.dataset.image === 'true', el.dataset.text === 'true');
          return;
        }
        handleClick(e, el);
      });

      // Double click → open/preview
      el.addEventListener('dblclick', e => {
        e.preventDefault();
        if (el.dataset.dir === 'true') navigateTo(el.dataset.path);
        else openPreview(el.dataset.path, el.dataset.name, el.dataset.image === 'true');
      });

      // Right-click → context menu
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        showContextMenu(e, el);
      });

      // Drag
      if (el.draggable) {
        el.addEventListener('dragstart', e => {
          const paths = selected.size > 0 && selected.has(el.dataset.path) ? [...selected] : [el.dataset.path];
          e.dataTransfer.setData('application/json', JSON.stringify({ paths }));
          e.dataTransfer.effectAllowed = 'move';
          el.style.opacity = '.4';
        });
        el.addEventListener('dragend', () => { el.style.opacity = ''; });
      }

      // Drop target (folders)
      if (el.dataset.dir === 'true') {
        el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drag-over'); dragTargetName.textContent = el.dataset.name; dragMoveHint.classList.remove('hidden'); });
        el.addEventListener('dragleave', () => { el.classList.remove('drag-over'); dragMoveHint.classList.add('hidden'); });
        el.addEventListener('drop', async e => {
          e.preventDefault(); el.classList.remove('drag-over'); dragMoveHint.classList.add('hidden');
          try { const d = JSON.parse(e.dataTransfer.getData('application/json')); if (d.paths) await moveFiles(d.paths, el.dataset.path); } catch {}
        });
      }
    });
  }

  function handleClick(e, el) {
    const idx = parseInt(el.dataset.idx);
    const p = el.dataset.path;
    if (e.ctrlKey || e.metaKey) {
      if (selected.has(p)) selected.delete(p); else selected.add(p);
      lastClickedIdx = idx; renderFiles();
    } else if (e.shiftKey && lastClickedIdx >= 0) {
      const di = getDisplayItems();
      const [lo, hi] = [Math.min(lastClickedIdx, idx), Math.max(lastClickedIdx, idx)];
      for (let i = lo; i <= hi; i++) selected.add(di[i].path);
      renderFiles();
    } else if (selected.size > 0) {
      selected.clear(); updateMultiBar();
      if (el.dataset.dir === 'true') navigateTo(el.dataset.path);
      else if (el.dataset.image === 'true' || el.dataset.text === 'true') openPreview(el.dataset.path, el.dataset.name, el.dataset.image === 'true');
      else window.location.href = `/api/download?path=${encodeURIComponent(el.dataset.path)}`;
    } else {
      lastClickedIdx = idx;
      if (el.dataset.dir === 'true') navigateTo(el.dataset.path);
      else if (el.dataset.image === 'true' || el.dataset.text === 'true') openPreview(el.dataset.path, el.dataset.name, el.dataset.image === 'true');
      else window.location.href = `/api/download?path=${encodeURIComponent(el.dataset.path)}`;
    }
  }

  // ── Context Menu ───────────────────────────────────────────────────────────
  function showContextMenu(e, el) {
    hideContextMenus();
    const menu = contextMenu;
    menu.classList.remove('hidden');
    positionMenu(menu, e.clientX, e.clientY);

    // Store target info on the menu
    menu._target = {
      path: el.dataset.path, name: el.dataset.name,
      isDir: el.dataset.dir === 'true', isImage: el.dataset.image === 'true',
    };
  }

  function showEmptyContextMenu(e) {
    hideContextMenus();
    const menu = contextMenuEmpty;
    menu.classList.remove('hidden');
    positionMenu(menu, e.clientX, e.clientY);
  }

  function positionMenu(menu, x, y) {
    menu.style.left = '0px'; menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = (x + rect.width > vw ? vw - rect.width - 4 : x) + 'px';
    menu.style.top = (y + rect.height > vh ? vh - rect.height - 4 : y) + 'px';
  }

  function hideContextMenus() {
    contextMenu.classList.add('hidden');
    contextMenuEmpty.classList.add('hidden');
  }

  // Context menu actions
  contextMenu.addEventListener('click', async e => {
    const item = e.target.closest('.ctx-item');
    if (!item || !contextMenu._target) return;
    const t = contextMenu._target;
    hideContextMenus();
    switch (item.dataset.action) {
      case 'open': if (t.isDir) navigateTo(t.path); break;
      case 'preview': openPreview(t.path, t.name, t.isImage); break;
      case 'download': window.location.href = `/api/download?path=${encodeURIComponent(t.path)}`; break;
      case 'rename': startRename(t.path, t.name); break;
      case 'copy-path': await navigator.clipboard.writeText(t.path); toast('路径已复制', 'info'); break;
      case 'delete': confirmDelete(t.path, t.name, t.isDir); break;
    }
  });

  contextMenuEmpty.addEventListener('click', e => {
    const item = e.target.closest('.ctx-item');
    if (!item) return;
    hideContextMenus();
    switch (item.dataset.action) {
      case 'upload': fileInput.click(); break;
      case 'mkdir': btnMkdir.click(); break;
      case 'refresh': navigateTo(currentPath); break;
      case 'select-all': getDisplayItems().forEach(i => selected.add(i.path)); renderFiles(); break;
    }
  });

  // Click outside closes context menus
  document.addEventListener('click', hideContextMenus);

  // Right-click on empty area
  fileContainer.addEventListener('contextmenu', e => {
    if (e.target === fileContainer || e.target.closest('.empty-state')) {
      e.preventDefault();
      showEmptyContextMenu(e);
    }
  });

  // ── Search ─────────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderFiles();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchInput.value = ''; searchQuery = ''; searchInput.blur(); renderFiles(); }
  });

  // ── Multi-bar ──────────────────────────────────────────────────────────────
  function updateMultiBar() {
    if (selected.size === 0) { multiBar.classList.add('hidden'); }
    else { multiBar.classList.remove('hidden'); multiCount.textContent = `已选择 ${selected.size} 项`; }
  }
  $('#multi-clear').addEventListener('click', () => { selected.clear(); renderFiles(); });
  $('#multi-delete').addEventListener('click', () => {
    if (selected.size === 0) return;
    pendingDelete = { path: [...selected], name: `${selected.size} 个项目`, isDir: false, isMulti: true };
    deleteTargetName.textContent = `确定要删除选中的 ${selected.size} 个项目吗？`;
    modalDelete.classList.remove('hidden');
  });
  $('#multi-download').addEventListener('click', () => {
    [...selected].forEach(p => { const a = document.createElement('a'); a.href = `/api/download?path=${encodeURIComponent(p)}`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); });
  });

  // ── Navigation ─────────────────────────────────────────────────────────────
  async function navigateTo(dirPath) {
    // Special path: /.trash opens the trash modal instead of browsing.
    if (dirPath === '/.trash' || dirPath === '.trash') {
      openTrashModal();
      history.pushState({ path: dirPath }, '', `#${dirPath}`);
      return;
    }
    showLoading(); selected.clear(); searchQuery = ''; searchInput.value = '';
    try {
      const data = await apiGet(`/api/files?path=${encodeURIComponent(dirPath)}`);
      currentPath = data.currentPath;
      allItems = data.items || [];
      renderFiles();
      history.pushState({ path: currentPath }, '', `#${currentPath}`);
    } catch (err) { toast(err.message, 'error'); }
    finally { hideLoading(); }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function handleAction(action, filePath, name, isDir, isImage, isText) {
    switch (action) {
      case 'download': window.location.href = `/api/download?path=${encodeURIComponent(filePath)}`; break;
      case 'rename': startRename(filePath, name); break;
      case 'delete': confirmDelete(filePath, name, isDir); break;
      case 'preview': openPreview(filePath, name, isImage); break;
    }
  }

  // ── Move ───────────────────────────────────────────────────────────────────
  async function moveFiles(sourcePaths, targetDir) {
    showLoading();
    let moved = 0;
    for (const sp of sourcePaths) {
      try { await apiPost('/api/move', { sourcePath: sp, targetDir }); moved++; }
      catch (err) { toast(`移动失败: ${err.message}`, 'error'); }
    }
    if (moved > 0) { toast(`已移动 ${moved} 个项目`, 'success'); selected.clear(); await navigateTo(currentPath); }
    hideLoading();
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  async function openPreview(filePath, name, isImage) {
    const titleEl = $('#preview-title');
    const metaEl  = $('#preview-meta');
    const bodyEl  = $('#preview-body');
    const truncEl = $('#preview-truncated');
    const copyBtn = $('#btn-preview-copy');

    titleEl.textContent = name; metaEl.textContent = '';
    bodyEl.innerHTML = '<div class="spinner"></div>';
    truncEl.classList.add('hidden');
    modalPreview.classList.remove('hidden');
    previewTextCache = '';

    $('#btn-preview-download').onclick = () => { window.location.href = `/api/download?path=${encodeURIComponent(filePath)}`; };
    copyBtn.onclick = async () => {
      if (!previewTextCache) { toast('无内容可复制', 'info'); return; }
      const ok = await copyToClipboard(previewTextCache);
      toast(ok ? '已复制到剪贴板' : '复制失败', ok ? 'success' : 'error');
    };

    if (isImage) {
      copyBtn.style.display = 'none';
      bodyEl.innerHTML = `<img src="/api/download?path=${encodeURIComponent(filePath)}" alt="${escapeHtml(name)}">`;
      bodyEl.style.background = '#1a1a2e';
    } else {
      copyBtn.style.display = '';
      try {
        const data = await apiGet(`/api/preview?path=${encodeURIComponent(filePath)}`);
        metaEl.textContent = data.sizeFormatted;
        previewTextCache = data.content;
        const highlighted = highlightCode(data.content, name);
        if (highlighted) {
          bodyEl.innerHTML = `<pre class="hljs-preview"><code class="hljs language-${detectHljsLang(name)}">${highlighted}</code></pre>`;
        } else {
          const lines = data.content.split('\n');
          bodyEl.innerHTML = `<div class="text-content">${lines.map((l, i) =>
            `<span class="line-num">${i+1}</span>${escapeHtml(l)}`).join('\n')}</div>`;
        }
        bodyEl.style.background = '#1a1a2e';
        if (data.truncated) { truncEl.textContent = `⚠️ 文件过大，仅显示前 ${data.maxPreview}`; truncEl.classList.remove('hidden'); }
      } catch (err) { bodyEl.innerHTML = `<div style="padding:40px;color:#ff6b6b;">加载失败: ${escapeHtml(err.message)}</div>`; }
    }
  }
  $('#btn-preview-close').addEventListener('click', () => modalPreview.classList.add('hidden'));
  modalPreview.querySelector('.modal-backdrop').addEventListener('click', () => modalPreview.classList.add('hidden'));

  // ── Upload with progress ───────────────────────────────────────────────────
  async function uploadFiles(files) {
    if (!files.length) return;
    uploadProgress.classList.remove('hidden');
    uploadProgressBar.style.width = '0%';
    uploadProgressText.textContent = `上传中 0/${files.length}`;

    const fd = new FormData();
    fd.append('targetPath', currentPath);
    for (const f of files) fd.append('files', f);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          uploadProgressBar.style.width = pct + '%';
          uploadProgressText.textContent = `上传中 ${pct}%`;
        }
      });

      await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 401) { window.location.href = '/login.html'; reject(new Error('未登录')); return; }
          if (xhr.status >= 400) { try { reject(new Error(JSON.parse(xhr.responseText).error)); } catch { reject(new Error('上传失败')); } return; }
          resolve();
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send(fd);
      });

      const data = JSON.parse(xhr.responseText);
      toast(`成功上传 ${data.uploaded.length} 个文件`, 'success');
      await navigateTo(currentPath);
    } catch (err) { toast('上传失败: ' + err.message, 'error'); }
    finally {
      setTimeout(() => { uploadProgress.classList.add('hidden'); }, 500);
    }
  }

  btnUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });

  // ── Drag & Drop (external) ─────────────────────────────────────────────────
  let dragCounter = 0;
  document.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; if (e.dataTransfer.types.includes('Files')) dropOverlay.classList.remove('hidden'); });
  document.addEventListener('dragleave', e => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add('hidden'); } });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault(); dragCounter = 0; dropOverlay.classList.add('hidden');
    if (e.target === document || e.target === document.body || e.target === dropOverlay) {
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    }
  });

  // ── New Folder ─────────────────────────────────────────────────────────────
  btnMkdir.addEventListener('click', () => { mkdirNameInput.value = ''; modalMkdir.classList.remove('hidden'); setTimeout(() => mkdirNameInput.focus(), 50); });
  $('#btn-cancel-mkdir').addEventListener('click', () => modalMkdir.classList.add('hidden'));
  $('#btn-confirm-mkdir').addEventListener('click', async () => {
    const name = mkdirNameInput.value.trim();
    if (!name) { toast('请输入文件夹名称', 'error'); return; }
    modalMkdir.classList.add('hidden'); showLoading();
    try { await apiPost('/api/mkdir', { parentPath: currentPath, name }); toast(`文件夹 "${name}" 创建成功`, 'success'); await navigateTo(currentPath); }
    catch (err) { toast('创建失败: ' + err.message, 'error'); }
    finally { hideLoading(); }
  });
  mkdirNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-confirm-mkdir').click(); if (e.key === 'Escape') modalMkdir.classList.add('hidden'); });

  // ── Trash ──────────────────────────────────────────────────────────────────
  async function refreshTrashCount() {
    try {
      const d = await apiGet('/api/trash');
      trashCount = d.count || 0;
      refreshTrashBadge();
    } catch { /* ignore */ }
  }

  function refreshTrashBadge() {
    if (trashCount > 0) {
      trashCountEl.textContent = trashCount > 99 ? '99+' : String(trashCount);
      trashCountEl.classList.remove('hidden');
    } else {
      trashCountEl.classList.add('hidden');
    }
  }

  async function openTrashModal() {
    modalTrash.classList.remove('hidden');
    await renderTrashView();
  }

  async function renderTrashView() {
    const body = $('#trash-body');
    const meta = $('#trash-meta');
    body.innerHTML = '<div class="spinner"></div>';
    try {
      const d = await apiGet('/api/trash');
      trashCount = d.count || 0;
      refreshTrashBadge();
      const totalMb = (d.totalBytes / 1024 / 1024).toFixed(2);
      meta.textContent = `${d.count} 项 · 共 ${totalMb} MB`;

      if (d.items.length === 0) {
        body.innerHTML = '<div class="empty-state"><span class="empty-icon">🗑</span><p>回收站是空的</p></div>';
        $('#btn-trash-restore-all').disabled = true;
        $('#btn-trash-empty').disabled = true;
        return;
      }
      $('#btn-trash-restore-all').disabled = false;
      $('#btn-trash-empty').disabled = false;

      body.innerHTML = d.items.map(it => {
        const dt = new Date(it.deletedAt);
        const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
        const sizeStr = it.isDirectory ? '文件夹' : formatSizeCompat(it.size);
        const missing = !it.exists ? ' <span class="trash-missing">(文件已丢失)</span>' : '';
        return `
          <div class="trash-row" data-id="${it.id}">
            <div class="trash-icon">${it.isDirectory ? '📁' : iconFor(it.originalName, false)}</div>
            <div class="trash-info">
              <div class="trash-name">${escapeHtml(it.originalName)}${missing}</div>
              <div class="trash-meta">原路径: ${escapeHtml(it.originalPath)} · ${sizeStr} · 删除于 ${dateStr}</div>
            </div>
            <div class="trash-actions">
              <button class="btn btn-secondary btn-sm" data-action="restore" ${!it.exists ? 'disabled' : ''}>↩ 还原</button>
              <button class="btn btn-danger btn-sm" data-action="purge">🔥 永久删除</button>
            </div>
          </div>`;
      }).join('');

      body.querySelectorAll('.trash-row').forEach(row => {
        const id = row.dataset.id;
        row.querySelector('[data-action="restore"]').addEventListener('click', async () => {
          try { await apiPost('/api/trash/restore', { id }); toast('已还原', 'success'); await renderTrashView(); }
          catch (err) { toast(err.message, 'error'); }
        });
        row.querySelector('[data-action="purge"]').addEventListener('click', async () => {
          if (!confirm('确定要永久删除该项吗？此操作不可撤销。')) return;
          try { await apiDelete('/api/trash/purge', { id }); toast('已永久删除', 'success'); await renderTrashView(); }
          catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) {
      body.innerHTML = `<div style="padding:20px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
    }
  }

  function formatSizeCompat(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  btnTrash.addEventListener('click', openTrashModal);
  $('#btn-trash-close').addEventListener('click', () => modalTrash.classList.add('hidden'));
  $('#btn-trash-refresh').addEventListener('click', renderTrashView);
  $('#btn-trash-empty').addEventListener('click', async () => {
    if (trashCount === 0) return;
    if (!confirm(`确定要清空回收站吗？${trashCount} 个项目将被永久删除,不可撤销。`)) return;
    showLoading();
    try {
      const d = await apiPost('/api/trash/empty', {});
      toast(`已清空 ${d.purged} 个项目`, 'success');
      await renderTrashView();
    } catch (err) { toast(err.message, 'error'); }
    finally { hideLoading(); }
  });
  $('#btn-trash-restore-all').addEventListener('click', async () => {
    showLoading();
    let restored = 0, failed = 0;
    try {
      const d = await apiGet('/api/trash');
      for (const it of d.items) {
        try { await apiPost('/api/trash/restore', { id: it.id }); restored++; }
        catch { failed++; }
      }
      toast(`已还原 ${restored} 项${failed ? `, 失败 ${failed} 项` : ''}`, failed ? 'info' : 'success');
      await renderTrashView();
    } catch (err) { toast(err.message, 'error'); }
    finally { hideLoading(); }
  });

  // ── Delete (moves to trash) ──────────────────────────────────────────────
  function confirmDelete(filePath, name, isDir) {
    pendingDelete = { path: [filePath], name, isDir };
    deleteTargetName.textContent = `确定要删除 ${isDir ? '文件夹' : '文件'} "${name}" 吗？\n(将移入回收站,可在回收站中恢复)`;
    modalDelete.classList.remove('hidden');
  }
  $('#btn-cancel-delete').addEventListener('click', () => { modalDelete.classList.add('hidden'); pendingDelete = null; });
  $('#btn-confirm-delete').addEventListener('click', async () => {
    if (!pendingDelete) return;
    modalDelete.classList.add('hidden'); showLoading();
    let moved = 0;
    for (const p of pendingDelete.path) {
      try { await apiDelete('/api/delete', { path: p }); moved++; }
      catch (err) { toast(`删除失败: ${err.message}`, 'error'); }
    }
    if (moved > 0) toast(`已移入回收站 ${moved} 个项目`, 'success');
    selected.clear(); await navigateTo(currentPath); await refreshTrashCount();
    hideLoading(); pendingDelete = null;
  });

  document.querySelectorAll('.modal-backdrop').forEach(bd =>
    bd.addEventListener('click', () => bd.closest('.modal').classList.add('hidden')));

  // ── Rename ─────────────────────────────────────────────────────────────────
  function startRename(filePath, oldName) {
    const card = fileContainer.querySelector(`[data-path="${CSS.escape(filePath)}"]`);
    if (!card) return;
    const nameEl = card.querySelector('.file-name');
    if (!nameEl) return;

    const input = document.createElement('input');
    input.type = 'text'; input.className = 'rename-input'; input.value = oldName;
    nameEl.replaceWith(input); input.focus();
    const dot = oldName.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : oldName.length);

    const commit = async () => {
      const newName = input.value.trim();
      if (!newName || newName === oldName) { const r = document.createElement('div'); r.className = 'file-name'; r.textContent = oldName; input.replaceWith(r); return; }
      showLoading();
      try { await apiPost('/api/rename', { oldPath: filePath, newName }); toast(`重命名为 "${newName}"`, 'success'); await navigateTo(currentPath); }
      catch (err) { toast('重命名失败: ' + err.message, 'error'); const r = document.createElement('div'); r.className = 'file-name'; r.textContent = oldName; input.replaceWith(r); }
      finally { hideLoading(); }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', commit); const r = document.createElement('div'); r.className = 'file-name'; r.textContent = oldName; input.replaceWith(r); }
    });
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  function setViewMode(mode) {
    viewMode = mode; localStorage.setItem('viewMode', mode);
    btnGrid.classList.toggle('active', mode === 'grid');
    btnList.classList.toggle('active', mode === 'list');
    fileContainer.classList.toggle('grid-view', mode === 'grid');
    fileContainer.classList.toggle('list-view', mode === 'list');
    renderFiles();
  }
  btnGrid.addEventListener('click', () => setViewMode('grid'));
  btnList.addEventListener('click', () => setViewMode('list'));

  // ── Sort ───────────────────────────────────────────────────────────────────
  sortSelect.value = sortMode;
  sortSelect.addEventListener('change', () => { sortMode = sortSelect.value; localStorage.setItem('sortMode', sortMode); renderFiles(); });

  // ── Dot files ──────────────────────────────────────────────────────────────
  dotToggle.checked = showDotFiles;
  dotToggle.addEventListener('change', () => { showDotFiles = dotToggle.checked; localStorage.setItem('showDotFiles', showDotFiles); renderFiles(); });

  // ── Wallpaper ─────────────────────────────────────────────────────────────
  function applyWallpaper() {
    wpEl.className = 'wallpaper'; wpEl.style.backgroundImage = '';
    if (wallpaper === 'none') return;
    if (wallpaper === 'custom') { wpEl.classList.add('custom'); if (wallpaperUrl) wpEl.style.backgroundImage = `url(${wallpaperUrl})`; }
    else wpEl.classList.add(wallpaper);
  }
  applyWallpaper();

  btnSettings.addEventListener('click', () => {
    modalSettings.classList.remove('hidden');
    document.querySelectorAll('.wp-btn').forEach(b => b.classList.toggle('active', b.dataset.wp === wallpaper));
    const show = wallpaper === 'custom';
    $('#wp-custom-url').style.display = show ? 'block' : 'none';
    $('#wp-upload-btn').style.display = show ? 'block' : 'none';
  });
  $('#btn-close-settings').addEventListener('click', () => modalSettings.classList.add('hidden'));

  document.querySelectorAll('.wp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wp-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); wallpaper = btn.dataset.wp;
      localStorage.setItem('wallpaper', wallpaper);
      const isCustom = wallpaper === 'custom';
      $('#wp-custom-url').style.display = isCustom ? 'block' : 'none';
      $('#wp-upload-btn').style.display = isCustom ? 'block' : 'none';
      if (!isCustom) applyWallpaper(); else $('#wp-custom-url').focus();
    });
  });
  $('#wp-custom-url').addEventListener('change', () => { wallpaperUrl = $('#wp-custom-url').value.trim(); localStorage.setItem('wallpaperUrl', wallpaperUrl); applyWallpaper(); });
  $('#wp-upload-btn').addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { wallpaperUrl = r.result; localStorage.setItem('wallpaperUrl', wallpaperUrl); applyWallpaper(); toast('壁纸已设置', 'success'); }; r.readAsDataURL(f); };
    inp.click();
  });

  // ── Logout ─────────────────────────────────────────────────────────────────
  $('#btn-logout').addEventListener('click', async () => { try { await fetch('/api/logout', { method: 'POST' }); } catch {} window.location.href = '/login.html'; });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Don't handle shortcuts when typing in inputs
    const tag = document.activeElement.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
      hideContextMenus();
      if (inInput) document.activeElement.blur();
      return;
    }

    // / → focus search
    if (e.key === '/' && !inInput) { e.preventDefault(); searchInput.focus(); return; }

    // Ctrl+A → select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !inInput) {
      e.preventDefault();
      getDisplayItems().forEach(i => selected.add(i.path));
      renderFiles();
      return;
    }

    if (inInput) return;

    // Backspace → go up
    if (e.key === 'Backspace') {
      e.preventDefault();
      const parts = currentPath.split('/').filter(Boolean);
      if (parts.length > 0) { parts.pop(); navigateTo('/' + parts.join('/')); }
      return;
    }

    // Delete → delete selected
    if (e.key === 'Delete' && selected.size > 0) {
      pendingDelete = { path: [...selected], name: `${selected.size} 个项目`, isDir: false, isMulti: true };
      deleteTargetName.textContent = `确定要删除选中的 ${selected.size} 个项目吗？`;
      modalDelete.classList.remove('hidden');
      return;
    }

    // F2 → rename first selected
    if (e.key === 'F2' && selected.size === 1) {
      const p = [...selected][0];
      const item = allItems.find(i => i.path === p);
      if (item) startRename(p, item.name);
      return;
    }
  });

  // ── Browser back/forward ──────────────────────────────────────────────────
  window.addEventListener('popstate', e => { if (e.state?.path) navigateTo(e.state.path); });

  // ── Theme from config ──────────────────────────────────────────────────────
  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    if (theme.primary) {
      root.style.setProperty('--primary', theme.primary);
      root.style.setProperty('--primary-light', theme.primary + '18');
      root.style.setProperty('--primary-glow', theme.primary + '26');
    }
    if (theme.danger)  root.style.setProperty('--danger', theme.danger);
    if (theme.success) root.style.setProperty('--success', theme.success);
    if (theme.bg)      root.style.setProperty('--bg', theme.bg);
    if (theme.logoText) { document.querySelector('.logo').textContent = theme.logoText; document.title = theme.logoText; }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const cfg = await apiGet('/api/config');
      storageBadge.textContent = cfg.storageRoot;
      storageBadge.title = `存储路径: ${cfg.storageRoot}`;
      applyTheme(cfg.theme);
    } catch { storageBadge.textContent = '—'; }
    refreshTrashCount();
    const hashPath = decodeURIComponent(window.location.hash.slice(1)) || '/';
    navigateTo(hashPath);
  }

  init();
})();
