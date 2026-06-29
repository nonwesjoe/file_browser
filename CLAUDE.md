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

Single-process Express 5 web app. No database. All state in-memory (sessions) and on-disk (files, thumbnail cache, config).

**Backend** (`src/server.ts`): One file contains everything — auth system (cookie sessions, rate limiting, session cleanup), Express routes, multer upload config, sharp thumbnail generation. All file operations are sandboxed into `STORAGE_ROOT` via `safePath()`. Every route handler uses `asyncHandler()` to forward promise rejections to the error handler. Most routes are protected by `requireAuth` middleware.

**Config** (`config.json`): Single source of truth for credentials, port, host, storage root, and UI theme. Loaded at startup. Environment variables `PORT`/`STORAGE_ROOT` override config values.

**Frontend** (`public/`): Vanilla JS SPA in a single IIFE (`js/app.js`). No build step. State is module-scoped (`currentPath`, `viewMode`, `sortMode`, `searchQuery`, `selected`, `wallpaper`). Navigation uses URL hash + `history.pushState`. `renderFiles()` generates HTML strings with staggered animation delays, attaches click/drag/contextmenu handlers via delegation. Modals toggled by `hidden` class. Theme colors applied at runtime via CSS custom properties from `/api/config`.

**Auth flow**: Login page (`login.html`) is public. `/api/login` creates a random token stored in an HttpOnly cookie + in-memory Map. Auth gate middleware redirects unauthenticated page requests to `/login.html` and returns 401 for API calls. Rate limiting: 5 failures per IP → 5-minute block. Session cleanup runs every 10 minutes.

**Key API contract**: `GET /api/files` returns items with `isImage`/`isText` flags. Frontend uses these to load thumbnails (`/api/thumbnail`) or text snippets (`/api/preview`). Thumbnails cached as WebP in `.cache_thumbs/` keyed by `base64url(path + ':' + mtime)`.

## Gotchas

- Express 5 (not 4) — `req.query` types differ, async route handlers must be wrapped.
- Sharp's type export doesn't expose `sharp.Sharp` — use `ReturnType<typeof sharp>`.
- `ts-node` is devDependency only; production runs compiled `dist/` via `node`.
- `.tmp_uploads/` is where multer stages uploads before moving.
- `safePath()` is the single security boundary — call it before any `fs` operation on user paths.
- `config.json` is read once at startup — changes require restart.
- Sessions are in-memory — restarting the server logs everyone out.
