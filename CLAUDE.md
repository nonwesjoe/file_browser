# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Build TypeScript + start server (via start.sh, auto-installs deps if needed)
npm run build        # Compile TypeScript to dist/ (tsc --skipLibCheck)
npm start            # Run compiled server (node dist/server.js)
```

Environment variables `PORT` and `STORAGE_ROOT` override `config.json` values.

Type-check without emitting: `npx tsc --noEmit`

## Architecture

Single-process Express 5 web app. No database. All state in-memory (sessions) and on-disk (files, thumbnail cache, config, trash).

**Backend** (`src/server.ts`): One file contains everything — auth system (cookie sessions, rate limiting, session cleanup), Express routes, multer upload config, sharp thumbnail generation, **trash subsystem** (recycle bin with TTL cleanup), **HTTP Range download** (resumable), and a **pLimit concurrency limiter** for sharp. All file operations are sandboxed into `STORAGE_ROOT` via `safePath()`. Every route handler uses `asyncHandler()` to forward promise rejections to the error handler. Most routes are protected by `requireAuth` middleware.

**Config** (`config.json`): Single source of truth for credentials, port, host, storage root, UI theme, **and lifecycle policies** (`trashRetentionDays`, `trashMaxMb`, `thumbCacheMaxMb`, `maxUploadSizeMb`). Loaded at startup. Environment variables `PORT`/`STORAGE_ROOT` override config values.

**Frontend** (`public/`): Vanilla JS SPA in a single IIFE (`js/app.js`). No build step. State is module-scoped (`currentPath`, `viewMode`, `sortMode`, `searchQuery`, `selected`, `wallpaper`, `trashCount`, `previewTextCache`). Navigation uses URL hash + `history.pushState`. The hash `#/.trash` opens the trash modal instead of browsing. `renderFiles()` generates HTML strings with staggered animation delays, attaches click/drag/contextmenu handlers via delegation. Modals toggled by `hidden` class. Theme colors applied at runtime via CSS custom properties from `/api/config`. **Syntax highlighting** uses highlight.js via CDN (with graceful plain-text fallback when blocked).

**Auth flow**: Login page (`login.html`) is public. `/api/login` creates a random token stored in an HttpOnly cookie + in-memory Map. Auth gate middleware redirects unauthenticated page requests to `/login.html` and returns 401 for API calls. Rate limiting: 5 failures per IP → 5-minute block. Session cleanup runs every 10 minutes.

**Key API contract**: `GET /api/files` returns items with `isImage`/`isText` flags. Frontend uses these to load thumbnails (`/api/thumbnail`) or text snippets (`/api/preview`). Thumbnails cached as WebP in `.cache_thumbs/` keyed by `base64url(path + ':' + mtime + ':dpr' + dpr)`. `GET /api/download` supports HTTP Range requests for resumable downloads. `DELETE /api/delete` moves items to the trash (no longer permanent).

**Trash subsystem** (`.trash/` at project root, NOT inside `STORAGE_ROOT`):
- Layout: `.trash/<id>` (file/dir) + `.trash/.meta/<id>.json` (TrashMeta)
- Filenames are opaque UUIDs — original name is stored in meta
- `DELETE /api/delete` → `moveToTrash()` → safeMove() (handles EXDEV via cp+rm fallback)
- Background cleanup runs hourly; `trashRetentionDays: 0` keeps forever
- Atomic purge via `.purging` rename to prevent races with concurrent restores
- `restoreTrashOne` does mkdir -p parent → fs.access collision check → safeMove back → fs.unlink meta

## Gotchas

- Express 5 (not 4) — `req.query` types differ, async route handlers must be wrapped.
- Sharp's type export doesn't expose `sharp.Sharp` — use `ReturnType<typeof sharp>`.
- `ts-node` is devDependency only; production runs compiled `dist/` via `node`.
- `.tmp_uploads/` is where multer stages uploads before moving. Always `fs.unlink` on failure paths.
- `safePath()` is the single security boundary — call it before any `fs` operation on user paths.
- `config.json` is read once at startup — changes require restart.
- Sessions are in-memory — restarting the server logs everyone out.
- **Trash is at project root** (`.trash/`) NOT inside `STORAGE_ROOT`. Cross-device renames (EXDEV) fall back to cp+rm via `safeMove()`. This means the `install.sh` systemd unit MUST include `${SCRIPT_DIR}/.trash` in `ReadWritePaths` (already done).
- `multer.MulterError` instances must be caught explicitly — instance check is `err instanceof multer.MulterError`.
- HTTP Range parsing: rejects `bytes=100-200,300-400` (multi-range) with null. Only single ranges supported.
- ETag for Range is **strong** (`"mtime-size"`); weak ETags would defeat `If-Range` semantics.
- Background cleanup tasks use `t.unref()` so they don't block process exit.
- Thumbnail cache cleanup runs every 30 min and walks the whole `.cache_thumbs/` dir — for very large caches, consider lazy cleanup on each miss.
- The frontend's `#/.trash` hash is intercepted by `navigateTo` BEFORE calling `/api/files` — don't add `.trash` filtering to `/api/files` defensively; it lives outside `STORAGE_ROOT` so it's never reachable from `/api/files` anyway.
