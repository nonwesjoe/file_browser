# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Build TypeScript + start server (via start.sh, auto-installs deps if needed)
npm run build        # Compile TypeScript to dist/ (tsc --skipLibCheck)
npm start            # Run compiled server (node dist/server.js)
```

Environment variables: `PORT` (default 3000), `STORAGE_ROOT` (default `./storage`).

Type-check without emitting: `npx tsc --noEmit`

## Architecture

Single-process Express 5 web app — no database, no framework on the frontend.

**Backend** (`src/server.ts`): One file contains everything — Express routes, security layer, multer upload config, sharp thumbnail generation. All file operations are sandboxed into `STORAGE_ROOT` via the `safePath()` function which strips leading slashes and resolves against the root, then checks the result starts with the root prefix. Every route handler uses `asyncHandler()` to forward promise rejections to the error handler.

**Frontend** (`public/`): Vanilla JS SPA in a single IIFE (`js/app.js`). No build step — the browser loads it directly. State is module-scoped (`currentPath`, `viewMode`). Navigation works via URL hash fragments and `history.pushState`. The `renderFiles()` function generates HTML strings for both grid and list views and attaches click handlers via event delegation on the container. Modals (delete confirm, mkdir, preview) are toggled by adding/removing the `hidden` class.

**Key API contract**: `GET /api/files` returns items with `isImage` and `isText` boolean flags. The frontend uses these to decide whether to load a thumbnail (`/api/thumbnail`) or text snippet (`/api/preview`) for each file. Thumbnails are cached as WebP in `.cache_thumbs/` keyed by `base64url(path + ':' + mtime)`.

## Gotchas

- Express 5 is used (not 4) — `req.query` types differ, and async route handlers must be wrapped.
- Sharp's type export doesn't expose a `sharp.Sharp` namespace — use `ReturnType<typeof sharp>` instead.
- `ts-node` is only a devDependency; production runs the compiled `dist/` output via `node`.
- The `.tmp_uploads/` dir is where multer stages uploads before moving them to the target directory — it's gitignored.
- The `safePath()` function is the single security boundary. When adding new file-serving routes, always call it before any `fs` operation on user-supplied paths.
