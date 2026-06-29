// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Web File Manager – Frontend
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let currentPath = '/';
  let viewMode = 'grid'; // 'grid' | 'list'
  let pendingDelete = null;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const fileContainer   = $('#file-container');
  const breadcrumb      = $('#breadcrumb');
  const itemCount       = $('#item-count');
  const loading         = $('#loading');
  const emptyState      = $('#empty-state');
  const dropOverlay     = $('#drop-overlay');
  const toastContainer  = $('#toast-container');
  const fileInput       = $('#file-input');
  const storageBadge    = $('#storage-badge');

  const btnUpload = $('#btn-upload');
  const btnMkdir  = $('#btn-mkdir');
  const btnGrid   = $('#btn-grid');
  const btnList   = $('#btn-list');

  const modalDelete = $('#modal-delete');
  const modalMkdir  = $('#modal-mkdir');
  const modalPreview = $('#modal-preview');
  const deleteTargetName = $('#delete-target-name');
  const mkdirNameInput   = $('#mkdir-name');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showLoading() { loading.classList.remove('hidden'); }
  function hideLoading() { loading.classList.add('hidden'); }

  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      el.addEventListener('animationend', () => el.remove());
    }, 3000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function iconFor(name, isDir) {
    if (isDir) return '📁';
    const ext = name.split('.').pop().toLowerCase();
    const map = {
      jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🖼️',svg:'🖼️',webp:'🖼️',bmp:'🖼️',ico:'🖼️',avif:'🖼️',tiff:'🖼️',tif:'🖼️',
      mp4:'🎬',avi:'🎬',mkv:'🎬',mov:'🎬',wmv:'🎬',webm:'🎬',
      mp3:'🎵',wav:'🎵',flac:'🎵',aac:'🎵',ogg:'🎵',
      pdf:'📕',doc:'📘',docx:'📘',xls:'📗',xlsx:'📗',ppt:'📙',pptx:'📙',
      zip:'📦',rar:'📦','7z':'📦',tar:'📦',gz:'📦',
      exe:'⚙️',sh:'⚙️',bat:'⚙️',
    };
    return map[ext] || '📄';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ── API calls ──────────────────────────────────────────────────────────────
  async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) { const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error); }
    return res.json();
  }
  async function apiPost(url, body) {
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error); }
    return res.json();
  }
  async function apiDelete(url, body) {
    const res = await fetch(url, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error); }
    return res.json();
  }

  // ── Breadcrumb ─────────────────────────────────────────────────────────────
  function renderBreadcrumb() {
    const parts = currentPath.split('/').filter(Boolean);
    let html = `<a href="#" data-path="/">🏠 根目录</a>`;
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      const p = acc;
      html += `<span class="sep">/</span>`;
      if (p === currentPath) {
        html += `<span class="current">${escapeHtml(part)}</span>`;
      } else {
        html += `<a href="#" data-path="${p}">${escapeHtml(part)}</a>`;
      }
    }
    breadcrumb.innerHTML = html;
    breadcrumb.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); navigateTo(a.dataset.path); });
    });
  }

  // ── Render files ───────────────────────────────────────────────────────────
  function renderFiles(data) {
    const items = data.items || [];
    renderBreadcrumb();
    itemCount.textContent = `${items.length} 个项目`;

    if (items.length === 0) {
      fileContainer.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    fileContainer.innerHTML = items.map(item => {
      const icon = iconFor(item.name, item.isDirectory);
      const date = formatDate(item.modified);

      if (viewMode === 'grid') {
        let iconHtml;
        if (item.isImage) {
          iconHtml = `<div class="thumb-wrap"><img src="/api/thumbnail?path=${encodeURIComponent(item.path)}" alt="${escapeHtml(item.name)}" loading="lazy"></div>`;
        } else if (item.isText && !item.isDirectory) {
          // Show a small text snippet as icon
          iconHtml = `<div class="file-icon text-icon" data-preview-path="${item.path}"><span class="text-snippet">加载中…</span></div>`;
        } else {
          iconHtml = `<div class="file-icon">${icon}</div>`;
        }

        return `
          <div class="file-card" data-path="${item.path}" data-name="${item.name}" data-dir="${item.isDirectory}" data-image="${item.isImage}" data-text="${item.isText}">
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
        // List view
        let iconHtml;
        if (item.isImage) {
          iconHtml = `<div class="thumb-wrap"><img src="/api/thumbnail?path=${encodeURIComponent(item.path)}" alt="" loading="lazy"></div>`;
        } else {
          iconHtml = `<div class="file-icon">${icon}</div>`;
        }

        return `
          <div class="file-row" data-path="${item.path}" data-name="${item.name}" data-dir="${item.isDirectory}" data-image="${item.isImage}" data-text="${item.isText}">
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

    // Load text snippets for grid view text files
    fileContainer.querySelectorAll('.text-icon[data-preview-path]').forEach(el => {
      const filePath = el.dataset.previewPath;
      fetch(`/api/preview?path=${encodeURIComponent(filePath)}`)
        .then(r => r.json())
        .then(data => {
          const snippet = data.content.slice(0, 200);
          el.querySelector('.text-snippet').textContent = snippet || '(空文件)';
        })
        .catch(() => {
          el.querySelector('.text-snippet').textContent = '(无法加载)';
        });
    });

    // Attach click handlers
    fileContainer.querySelectorAll('.file-card, .file-row').forEach(el => {
      el.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (btn) {
          e.stopPropagation();
          handleAction(btn.dataset.action, el.dataset.path, el.dataset.name, el.dataset.dir === 'true', el.dataset.image === 'true', el.dataset.text === 'true');
          return;
        }
        if (el.dataset.dir === 'true') {
          navigateTo(el.dataset.path);
        } else if (el.dataset.image === 'true' || el.dataset.text === 'true') {
          openPreview(el.dataset.path, el.dataset.name, el.dataset.image === 'true');
        } else {
          window.location.href = `/api/download?path=${encodeURIComponent(el.dataset.path)}`;
        }
      });
    });
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  async function navigateTo(dirPath) {
    showLoading();
    try {
      const data = await apiGet(`/api/files?path=${encodeURIComponent(dirPath)}`);
      currentPath = data.currentPath;
      renderFiles(data);
      history.pushState({ path: currentPath }, '', `#${currentPath}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function handleAction(action, filePath, name, isDir, isImage, isText) {
    switch (action) {
      case 'download':
        window.location.href = `/api/download?path=${encodeURIComponent(filePath)}`;
        break;
      case 'rename':
        startRename(filePath, name);
        break;
      case 'delete':
        confirmDelete(filePath, name, isDir);
        break;
      case 'preview':
        openPreview(filePath, name, isImage);
        break;
    }
  }

  // ── Preview Modal ──────────────────────────────────────────────────────────
  async function openPreview(filePath, name, isImage) {
    const titleEl = $('#preview-title');
    const metaEl  = $('#preview-meta');
    const bodyEl  = $('#preview-body');
    const truncEl = $('#preview-truncated');
    const dlBtn   = $('#btn-preview-download');

    titleEl.textContent = name;
    metaEl.textContent = '';
    bodyEl.innerHTML = '<div class="spinner"></div>';
    truncEl.classList.add('hidden');
    modalPreview.classList.remove('hidden');

    dlBtn.onclick = () => {
      window.location.href = `/api/download?path=${encodeURIComponent(filePath)}`;
    };

    if (isImage) {
      // Full-size image preview
      bodyEl.innerHTML = `<img src="/api/download?path=${encodeURIComponent(filePath)}" alt="${escapeHtml(name)}">`;
      bodyEl.style.background = '#1e1e1e';
    } else {
      // Text preview
      try {
        const data = await apiGet(`/api/preview?path=${encodeURIComponent(filePath)}`);
        metaEl.textContent = data.sizeFormatted;

        const lines = data.content.split('\n');
        const numbered = lines.map((line, i) => {
          const num = `<span class="line-num">${i + 1}</span>`;
          return num + escapeHtml(line);
        }).join('\n');

        bodyEl.innerHTML = `<div class="text-content">${numbered}</div>`;
        bodyEl.style.background = '#1e1e1e';

        if (data.truncated) {
          truncEl.textContent = `⚠️ 文件过大，仅显示前 ${data.maxPreview}`;
          truncEl.classList.remove('hidden');
        }
      } catch (err) {
        bodyEl.innerHTML = `<div style="padding:40px;color:#ff6b6b;">加载失败: ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  // Close preview
  $('#btn-preview-close').addEventListener('click', () => modalPreview.classList.add('hidden'));
  modalPreview.querySelector('.modal-backdrop').addEventListener('click', () => modalPreview.classList.add('hidden'));

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function uploadFiles(files) {
    if (!files.length) return;
    showLoading();
    try {
      const formData = new FormData();
      formData.append('targetPath', currentPath);
      for (const f of files) formData.append('files', f);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) { const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error); }
      const data = await res.json();
      toast(`成功上传 ${data.uploaded.length} 个文件`, 'success');
      await navigateTo(currentPath);
    } catch (err) {
      toast('上传失败: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  btnUpload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  let dragCounter = 0;
  document.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; dropOverlay.classList.remove('hidden'); });
  document.addEventListener('dragleave', e => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add('hidden'); } });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault(); dragCounter = 0; dropOverlay.classList.add('hidden');
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  // ── New Folder ─────────────────────────────────────────────────────────────
  btnMkdir.addEventListener('click', () => {
    mkdirNameInput.value = '';
    modalMkdir.classList.remove('hidden');
    setTimeout(() => mkdirNameInput.focus(), 50);
  });
  $('#btn-cancel-mkdir').addEventListener('click', () => modalMkdir.classList.add('hidden'));
  $('#btn-confirm-mkdir').addEventListener('click', async () => {
    const name = mkdirNameInput.value.trim();
    if (!name) { toast('请输入文件夹名称', 'error'); return; }
    modalMkdir.classList.add('hidden');
    showLoading();
    try {
      await apiPost('/api/mkdir', { parentPath: currentPath, name });
      toast(`文件夹 "${name}" 创建成功`, 'success');
      await navigateTo(currentPath);
    } catch (err) {
      toast('创建失败: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });
  mkdirNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#btn-confirm-mkdir').click();
    if (e.key === 'Escape') modalMkdir.classList.add('hidden');
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  function confirmDelete(filePath, name, isDir) {
    pendingDelete = { path: filePath, name, isDir };
    deleteTargetName.textContent = `确定要删除 ${isDir ? '文件夹' : '文件'} "${name}" 吗？`;
    modalDelete.classList.remove('hidden');
  }
  $('#btn-cancel-delete').addEventListener('click', () => { modalDelete.classList.add('hidden'); pendingDelete = null; });
  $('#btn-confirm-delete').addEventListener('click', async () => {
    if (!pendingDelete) return;
    modalDelete.classList.add('hidden');
    showLoading();
    try {
      await apiDelete('/api/delete', { path: pendingDelete.path });
      toast(`"${pendingDelete.name}" 已删除`, 'success');
      await navigateTo(currentPath);
    } catch (err) {
      toast('删除失败: ' + err.message, 'error');
    } finally {
      hideLoading(); pendingDelete = null;
    }
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', () => bd.closest('.modal').classList.add('hidden'));
  });

  // ── Rename (inline) ───────────────────────────────────────────────────────
  function startRename(filePath, oldName) {
    const card = fileContainer.querySelector(`[data-path="${CSS.escape(filePath)}"]`);
    if (!card) return;
    const nameEl = card.querySelector('.file-name');
    if (!nameEl) return;

    const input = document.createElement('input');
    input.type = 'text'; input.className = 'rename-input'; input.value = oldName;
    nameEl.replaceWith(input);
    input.focus();
    const dotIdx = oldName.lastIndexOf('.');
    input.setSelectionRange(0, dotIdx > 0 ? dotIdx : oldName.length);

    const commit = async () => {
      const newName = input.value.trim();
      if (!newName || newName === oldName) {
        const r = document.createElement('div'); r.className = 'file-name'; r.textContent = oldName;
        input.replaceWith(r); return;
      }
      showLoading();
      try {
        await apiPost('/api/rename', { oldPath: filePath, newName });
        toast(`重命名为 "${newName}"`, 'success');
        await navigateTo(currentPath);
      } catch (err) {
        toast('重命名失败: ' + err.message, 'error');
        const r = document.createElement('div'); r.className = 'file-name'; r.textContent = oldName;
        input.replaceWith(r);
      } finally { hideLoading(); }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        input.removeEventListener('blur', commit);
        const r = document.createElement('div'); r.className = 'file-name'; r.textContent = oldName;
        input.replaceWith(r);
      }
    });
  }

  // ── View mode toggle ──────────────────────────────────────────────────────
  btnGrid.addEventListener('click', () => {
    viewMode = 'grid'; btnGrid.classList.add('active'); btnList.classList.remove('active');
    fileContainer.classList.remove('list-view'); fileContainer.classList.add('grid-view');
    navigateTo(currentPath);
  });
  btnList.addEventListener('click', () => {
    viewMode = 'list'; btnList.classList.add('active'); btnGrid.classList.remove('active');
    fileContainer.classList.remove('grid-view'); fileContainer.classList.add('list-view');
    navigateTo(currentPath);
  });

  // ── Browser back/forward ──────────────────────────────────────────────────
  window.addEventListener('popstate', e => { if (e.state?.path) navigateTo(e.state.path); });

  // ── Keyboard: Escape closes modals ─────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    // Load server config (storage path)
    try {
      const cfg = await apiGet('/api/config');
      storageBadge.textContent = cfg.storageRoot;
      storageBadge.title = `存储路径: ${cfg.storageRoot}`;
    } catch { storageBadge.textContent = '—'; }

    const hashPath = decodeURIComponent(window.location.hash.slice(1)) || '/';
    navigateTo(hashPath);
  }

  init();
})();
