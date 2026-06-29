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
  const sortSelect   = $('#sort-select');
  const dotToggle    = $('#toggle-dotfiles');

  const modalDelete  = $('#modal-delete');
  const modalMkdir   = $('#modal-mkdir');
  const modalPreview = $('#modal-preview');
  const modalSettings = $('#modal-settings');
  const deleteTargetName = $('#delete-target-name');
  const mkdirNameInput   = $('#mkdir-name');

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
    let html = `<a href="#" data-path="/">🏠 根目录</a>`;
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      html += `<span class="sep">/</span>`;
      if (acc === currentPath) html += `<span class="current">${escapeHtml(part)}</span>`;
      else html += `<a href="#" data-path="${acc}">${escapeHtml(part)}</a>`;
    }
    breadcrumb.innerHTML = html;
    breadcrumb.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); navigateTo(a.dataset.path); }));
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

    titleEl.textContent = name; metaEl.textContent = '';
    bodyEl.innerHTML = '<div class="spinner"></div>';
    truncEl.classList.add('hidden');
    modalPreview.classList.remove('hidden');

    $('#btn-preview-download').onclick = () => { window.location.href = `/api/download?path=${encodeURIComponent(filePath)}`; };

    if (isImage) {
      bodyEl.innerHTML = `<img src="/api/download?path=${encodeURIComponent(filePath)}" alt="${escapeHtml(name)}">`;
      bodyEl.style.background = '#1a1a2e';
    } else {
      try {
        const data = await apiGet(`/api/preview?path=${encodeURIComponent(filePath)}`);
        metaEl.textContent = data.sizeFormatted;
        const lines = data.content.split('\n');
        bodyEl.innerHTML = `<div class="text-content">${lines.map((l, i) =>
          `<span class="line-num">${i+1}</span>${escapeHtml(l)}`).join('\n')}</div>`;
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

  // ── Delete ─────────────────────────────────────────────────────────────────
  function confirmDelete(filePath, name, isDir) {
    pendingDelete = { path: [filePath], name, isDir };
    deleteTargetName.textContent = `确定要删除 ${isDir ? '文件夹' : '文件'} "${name}" 吗？`;
    modalDelete.classList.remove('hidden');
  }
  $('#btn-cancel-delete').addEventListener('click', () => { modalDelete.classList.add('hidden'); pendingDelete = null; });
  $('#btn-confirm-delete').addEventListener('click', async () => {
    if (!pendingDelete) return;
    modalDelete.classList.add('hidden'); showLoading();
    let deleted = 0;
    for (const p of pendingDelete.path) { try { await apiDelete('/api/delete', { path: p }); deleted++; } catch (err) { toast(`删除失败: ${err.message}`, 'error'); } }
    if (deleted > 0) toast(`已删除 ${deleted} 个项目`, 'success');
    selected.clear(); await navigateTo(currentPath); hideLoading(); pendingDelete = null;
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
    const hashPath = decodeURIComponent(window.location.hash.slice(1)) || '/';
    navigateTo(hashPath);
  }

  init();
})();
