import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

interface ThemeConfig {
  primary?: string;
  danger?: string;
  success?: string;
  bg?: string;
  logoText?: string;
}

interface AppConfig {
  username: string;
  password: string;
  port: number;
  host: string;
  storageRoot: string;
  theme: ThemeConfig;
  trashRetentionDays: number;
  trashMaxMb: number;
  thumbCacheMaxMb: number;
  maxUploadSizeMb: number;
}

const DEFAULT_CONFIG: AppConfig = {
  username: 'admin',
  password: 'admin',
  port: 3000,
  host: '0.0.0.0',
  storageRoot: './storage',
  theme: {
    primary: '#4f46e5',
    danger: '#ef4444',
    success: '#10b981',
    bg: '#f0f2f5',
    logoText: 'Web 文件管理器',
  },
  trashRetentionDays: 30,
  trashMaxMb: 1024,
  thumbCacheMaxMb: 500,
  maxUploadSizeMb: 5120,
};

async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const cfg = JSON.parse(raw);
    return {
      username: cfg.username ?? DEFAULT_CONFIG.username,
      password: cfg.password ?? DEFAULT_CONFIG.password,
      port: cfg.port ?? DEFAULT_CONFIG.port,
      host: cfg.host ?? DEFAULT_CONFIG.host,
      storageRoot: cfg.storageRoot ?? DEFAULT_CONFIG.storageRoot,
      theme: { ...DEFAULT_CONFIG.theme, ...cfg.theme },
      trashRetentionDays: cfg.trashRetentionDays ?? DEFAULT_CONFIG.trashRetentionDays,
      trashMaxMb: cfg.trashMaxMb ?? DEFAULT_CONFIG.trashMaxMb,
      thumbCacheMaxMb: cfg.thumbCacheMaxMb ?? DEFAULT_CONFIG.thumbCacheMaxMb,
      maxUploadSizeMb: cfg.maxUploadSizeMb ?? DEFAULT_CONFIG.maxUploadSizeMb,
    };
  } catch {
    // Create default config if missing
    await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    return { ...DEFAULT_CONFIG };
  }
}

// Load config synchronously at startup (blocks until read)
let CONFIG: AppConfig = DEFAULT_CONFIG;
let STORAGE_ROOT: string;
let PORT: number;
let HOST: string;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const THUMB_DIR = path.join(__dirname, '..', '.cache_thumbs');
const THUMB_SIZE = 256;
const THUMB_CONCURRENCY = 4;

// Trash subsystem lives at the project root (not inside STORAGE_ROOT) to keep
// deletes atomic via fs.rename even when STORAGE_ROOT is on a different mount.
const TRASH_DIR = path.join(__dirname, '..', '.trash');
const TRASH_META_DIR = path.join(TRASH_DIR, '.meta');

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg', 'avif', 'heic', 'heif']);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'toml',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'swift',
  'html', 'htm', 'css', 'scss', 'less', 'sass',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1',
  'csv', 'tsv', 'log', 'ini', 'cfg', 'conf', 'env',
  'gitignore', 'dockerfile', 'makefile', 'cmake',
  'sql', 'graphql', 'gql',
  'r', 'lua', 'perl', 'pl', 'php', 'ex', 'exs', 'erl', 'hs',
  'vue', 'svelte', 'astro',
]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Session { username: string; created: number; }
const sessions = new Map<string, Session>();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'fm_session';

// Rate limiting for login
const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(ip: string): boolean {
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  if (entry.blockedUntil > Date.now()) return false;
  if (entry.blockedUntil > 0 && entry.blockedUntil <= Date.now()) {
    loginAttempts.delete(ip);
    return true;
  }
  return true;
}

function recordLoginFailure(ip: string) {
  const entry = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.blockedUntil = Date.now() + LOGIN_BLOCK_MS;
    entry.count = 0;
  }
  loginAttempts.set(ip, entry);
}

function clearLoginAttempts(ip: string) {
  loginAttempts.delete(ip);
}

// Session cleanup: remove expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.created > SESSION_TTL) sessions.delete(token);
  }
}, 10 * 60 * 1000);

function parseCookies(req: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...val] = part.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(val.join('='));
  }
  return cookies;
}

function getSession(req: Request): Session | null {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_TTL) { sessions.delete(token); return null; }
  return session;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const app = express();

function safePath(requested: string): string {
  const cleaned = requested.replace(/^\/+/, '');
  const resolved = path.resolve(STORAGE_ROOT, cleaned);
  if (!resolved.startsWith(STORAGE_ROOT)) throw Object.assign(new Error('Path traversal blocked'), { status: 403 });
  return resolved;
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);
}

/**
 * Move src to dst atomically when possible. Falls back to copy+unlink when the
 * two paths are on different filesystems (EXDEV). For directories, copies
 * recursively. Throws on any non-EXDEV error.
 */
async function safeMove(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst);
    return;
  } catch (err: any) {
    if (err.code !== 'EXDEV') throw err;
  }
  // Cross-device: copy then remove. To minimise the window where both copies
  // exist (or neither does), copy first, rename the copy into place (atomic),
  // then remove the source.
  const tmpDst = `${dst}.__moving__${process.pid}`;
  await fs.cp(src, tmpDst, { recursive: true });
  try {
    await fs.rename(tmpDst, dst);
  } catch (err) {
    await fs.rm(tmpDst, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  await fs.rm(src, { recursive: true, force: true });
}

/**
 * Tiny in-process semaphore. Returns a `run<T>(fn)` that queues the task and
 * resolves with the function's result. Caps concurrent in-flight tasks to
 * `limit`. Rejects new tasks while the queue is full so callers can 503.
 */
function pLimit(limit: number) {
  let active = 0;
  const queue: Array<{ run: () => void }> = [];
  const next = () => {
    while (active < limit && queue.length) {
      active++;
      const job = queue.shift()!;
      job.run();
    }
  };
  return {
    get active() { return active; },
    get queued() { return queue.length; },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit && queue.length >= limit * 50) {
        throw Object.assign(new Error('Too many concurrent thumbnail requests'), { status: 503 });
      }
      return new Promise<T>((resolve, reject) => {
        queue.push({
          run: () => {
            fn().then(resolve, reject).finally(() => { active--; next(); });
          },
        });
        next();
      });
    },
  };
}

const thumbLimiter = pLimit(THUMB_CONCURRENCY);

/**
 * Parse a single-range HTTP Range header. Returns null for malformed/multi
 * ranges. The returned object has already been clamped to the file size.
 */
interface ParsedRange { start: number; end: number; }
function parseRange(header: string | undefined, size: number): ParsedRange | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s, e] = m;
  let start: number, end: number;
  if (s === '' && e === '') return null; // bytes=- is invalid
  if (s === '') {
    // Suffix range: last N bytes
    const n = parseInt(e, 10);
    if (isNaN(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(s, 10);
    end = e === '' ? size - 1 : parseInt(e, 10);
    if (isNaN(start) || isNaN(end) || start < 0 || end < start) return null;
    if (start >= size) return null;
    if (end >= size) end = size - 1;
  }
  return { start, end };
}

function strongEtag(stat: fsSync.Stats): string {
  // Strong validator per RFC 9110. mtimeMs + size uniquely identifies content
  // under normal conditions; collisions across different content with the
  // same mtime+size are negligible.
  return `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
}

// ── Trash subsystem ────────────────────────────────────────────────────────

interface TrashMeta {
  id: string;
  originalPath: string;  // path relative to STORAGE_ROOT (leading "/")
  originalName: string;
  isDirectory: boolean;
  size: number;
  deletedAt: number;     // ms epoch
}

async function ensureTrashDirs(): Promise<void> {
  await fs.mkdir(TRASH_DIR, { recursive: true });
  await fs.mkdir(TRASH_META_DIR, { recursive: true });
}

function trashFileName(id: string): string {
  // Opaque — never parsed back. The original name lives in meta.
  return id;
}

async function trashMetaPath(id: string): Promise<string> {
  return path.join(TRASH_META_DIR, id + '.json');
}

async function trashEntryPath(id: string): Promise<string> {
  return path.join(TRASH_DIR, id);
}

async function readTrashMeta(id: string): Promise<TrashMeta | null> {
  try {
    const raw = await fs.readFile(await trashMetaPath(id), 'utf-8');
    return JSON.parse(raw) as TrashMeta;
  } catch {
    return null;
  }
}

async function trashDirBytes(): Promise<number> {
  // Sum sizes of all trash entries (cheap O(n) readdir; sizes read from meta).
  try {
    const metas = await fs.readdir(TRASH_META_DIR);
    let total = 0;
    for (const f of metas) {
      if (!f.endsWith('.json')) continue;
      try {
        const m = JSON.parse(await fs.readFile(path.join(TRASH_META_DIR, f), 'utf-8')) as TrashMeta;
        total += m.size || 0;
      } catch { /* skip */ }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Move absPath (which lives inside STORAGE_ROOT) into the trash. Returns the
 * trash item id. The relative path is preserved in meta so we can restore.
 */
async function moveToTrash(absPath: string): Promise<TrashMeta> {
  await ensureTrashDirs();

  const relPath = '/' + path.relative(STORAGE_ROOT, absPath).replace(/\\/g, '/');
  const stat = await fs.stat(absPath);
  const id = crypto.randomUUID();
  const baseName = path.basename(absPath);

  const meta: TrashMeta = {
    id,
    originalPath: relPath,
    originalName: baseName,
    isDirectory: stat.isDirectory(),
    size: stat.size,
    deletedAt: Date.now(),
  };

  const dstEntry = await trashEntryPath(id);
  // Write meta FIRST. If the rename fails partway, we can recover by deleting
  // the orphan entry and meta. Meta is the source of truth.
  await fs.writeFile(await trashMetaPath(id), JSON.stringify(meta));
  try {
    await safeMove(absPath, dstEntry);
  } catch (err) {
    await fs.unlink(await trashMetaPath(id)).catch(() => {});
    await fs.rm(dstEntry, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  return meta;
}

async function listTrash(): Promise<Array<TrashMeta & { exists: boolean }>> {
  await ensureTrashDirs();
  let files: string[] = [];
  try {
    files = await fs.readdir(TRASH_META_DIR);
  } catch { return []; }
  const items = await Promise.all(
    files.filter(f => f.endsWith('.json')).map(async f => {
      const id = f.replace(/\.json$/, '');
      const meta = await readTrashMeta(id);
      if (!meta) return null;
      let exists = true;
      try { await fs.stat(await trashEntryPath(id)); } catch { exists = false; }
      return { ...meta, exists };
    })
  );
  return items.filter(Boolean) as Array<TrashMeta & { exists: boolean }>;
}

/** Purge a single trash item. Returns true if anything was deleted. */
async function purgeTrashOne(id: string): Promise<boolean> {
  const entry = await trashEntryPath(id);
  const meta = await trashMetaPath(id);
  // Atomic rename of meta to .purging so concurrent cleanup passes skip it.
  const purging = meta + '.purging';
  try {
    await fs.rename(meta, purging);
  } catch {
    return false; // already gone
  }
  await fs.rm(entry, { recursive: true, force: true });
  await fs.unlink(purging);
  return true;
}

async function restoreTrashOne(id: string, overwrite = false): Promise<{ ok: boolean; reason?: string }> {
  const meta = await readTrashMeta(id);
  if (!meta) return { ok: false, reason: 'Item not found' };

  const entry = await trashEntryPath(id);
  // Verify entry still exists.
  try { await fs.stat(entry); } catch { return { ok: false, reason: 'Trashed file is missing' }; }

  const absOriginal = safePath(meta.originalPath);
  // Ensure parent directory exists. mkdir -p is a no-op for existing dirs.
  await fs.mkdir(path.dirname(absOriginal), { recursive: true });

  // Collision check.
  try {
    await fs.stat(absOriginal);
    if (!overwrite) return { ok: false, reason: '目标位置已存在同名文件' };
    await fs.rm(absOriginal, { recursive: true, force: true });
  } catch { /* good — doesn't exist */ }

  try {
    await safeMove(entry, absOriginal);
  } catch (err: any) {
    return { ok: false, reason: '恢复失败: ' + (err.message || 'unknown') };
  }
  // Remove meta only after successful move.
  await fs.unlink(await trashMetaPath(id)).catch(() => {});
  return { ok: true };
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function getExt(name: string): string { return name.split('.').pop()?.toLowerCase() || ''; }
function isImage(name: string): boolean { return IMAGE_EXTS.has(getExt(name)); }
function isTextFile(name: string): boolean {
  const ext = getExt(name);
  if (TEXT_EXTS.has(ext)) return true;
  if (!name.includes('.')) return true;
  return false;
}

let upload: multer.Multer;

function makeUpload(limitMb: number) {
  return multer({
    dest: path.join(__dirname, '..', '.tmp_uploads'),
    limits: {
      fileSize: limitMb * 1024 * 1024,
      files: 100,
      fieldSize: 1024 * 1024,  // 1MB for non-file fields
      fields: 20,
    },
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MIDDLEWARE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use(express.json());

// ── Public routes ────────────────────────────────────────────────────────────

app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));

// Public theme endpoint (no auth, for login page branding)
app.get('/api/theme', (_req, res) => {
  res.json({ logoText: CONFIG.theme.logoText, primary: CONFIG.theme.primary });
});

app.post('/api/login', asyncHandler(async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  // Rate limit check
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: `登录失败次数过多，请 ${LOGIN_BLOCK_MS / 60000} 分钟后再试` });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });

  if (username !== CONFIG.username || password !== CONFIG.password) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: '账号或密码错误' });
  }

  // Success — clear failures
  clearLoginAttempts(ip);

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, created: Date.now() });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
  res.json({ success: true, username });
}));

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME]) sessions.delete(cookies[COOKIE_NAME]);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ success: true });
});

app.get('/api/auth', (req, res) => {
  const session = getSession(req);
  res.json(session ? { authenticated: true, username: session.username } : { authenticated: false });
});

// ── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!getSession(req)) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Auth gate ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (!getSession(req)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login.html');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/config — server config + theme for frontend
app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    storageRoot: STORAGE_ROOT,
    thumbnailSize: THUMB_SIZE,
    theme: CONFIG.theme,
  });
});

// LIST directory
app.get('/api/files', requireAuth, asyncHandler(async (req, res) => {
  const relPath = (req.query.path as string) || '/';
  const absDir = safePath(relPath);
  const stat = await fs.stat(absDir);
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const items = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(absDir, entry.name);
    try {
      const s = await fs.stat(fullPath);
      const name = entry.name;
      const isDir = entry.isDirectory();
      return {
        name, isDirectory: isDir, size: s.size, sizeFormatted: formatSize(s.size),
        modified: s.mtime.toISOString(), path: path.join(relPath, name).replace(/\\/g, '/'),
        isImage: !isDir && isImage(name), isText: !isDir && isTextFile(name),
      };
    } catch { return null; }
  }));

  res.json({
    currentPath: relPath,
    items: items.filter(Boolean).sort((a, b) => {
      if (a!.isDirectory !== b!.isDirectory) return a!.isDirectory ? -1 : 1;
      return a!.name.localeCompare(b!.name);
    }),
  });
}));

// THUMBNAIL
app.get('/api/thumbnail', requireAuth, asyncHandler(async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });

  const absPath = safePath(relPath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot thumbnail a directory' });

  // Optional ?dpr=2 to emit 2x thumbnails for high-DPI displays. Cache key
  // includes the dpr so we don't serve a 1x thumb to a retina browser.
  const dpr = req.query.dpr === '2' ? 2 : 1;
  const targetSize = THUMB_SIZE * dpr;

  const cacheKey = Buffer.from(`${relPath}:${stat.mtimeMs}:dpr${dpr}`).toString('base64url');
  const cachePath = path.join(THUMB_DIR, cacheKey + '.webp');

  try {
    const cached = await fs.readFile(cachePath);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', String(cached.byteLength));
    return res.send(cached);
  } catch { /* cache miss */ }

  const ext = getExt(relPath);
  const buf = await thumbLimiter.run(async () => {
    const sharpInput = ext === 'svg'
      ? sharp(absPath, { density: 150 })
      : sharp(absPath);
    return sharpInput
      .resize(targetSize, targetSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  });
  // Write cache outside the limiter (cache miss storms could otherwise fill
  // the queue and starve subsequent requests for the same thumb).
  await fs.writeFile(cachePath, buf).catch(() => {});
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', String(buf.byteLength));
  res.send(buf);
}));

// PREVIEW
app.get('/api/preview', requireAuth, asyncHandler(async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });

  const absPath = safePath(relPath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot preview a directory' });

  const MAX_PREVIEW = 1024 * 1024;
  const size = Math.min(stat.size, MAX_PREVIEW);
  const fh = await fs.open(absPath, 'r');
  const buf = Buffer.alloc(size);
  await fh.read(buf, 0, size, 0);
  await fh.close();

  res.json({
    name: path.basename(absPath), ext: getExt(relPath),
    content: buf.toString('utf-8'), size: stat.size, sizeFormatted: formatSize(stat.size),
    truncated: stat.size > MAX_PREVIEW, maxPreview: formatSize(MAX_PREVIEW),
  });
}));

// DOWNLOAD (with HTTP Range support, strong ETag, streaming)
app.get('/api/download', requireAuth, asyncHandler(async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });
  const absPath = safePath(relPath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot download a directory' });

  const etag = strongEtag(stat);
  const baseName = path.basename(absPath);

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

  // Handle If-None-Match (304)
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  // Handle If-Range — restart full download if the validator doesn't match.
  const ifRange = req.headers['if-range'];
  const rangeHeader = ifRange && ifRange !== etag ? undefined : (req.headers.range as string | undefined);

  const range = parseRange(rangeHeader, stat.size);

  if (range) {
    const { start, end } = range;
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(chunkSize));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = createReadStream(absPath, { start, end });
    try {
      await pipeline(stream, res);
    } catch (err: any) {
      // Client disconnect or write error after headers — already sent headers.
      if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
    }
    return;
  }

  // Full file
  res.status(200);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}`);
  res.setHeader('Content-Type', 'application/octet-stream');
  const stream = createReadStream(absPath);
  try {
    await pipeline(stream, res);
  } catch (err: any) {
    if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
  }
}));

// UPLOAD
app.post('/api/upload', requireAuth, (req, res, next) => {
  upload.array('files', 100)(req, res, async (err: any) => {
    if (err) {
      // MulterError: LIMIT_FILE_SIZE, LIMIT_FILE_COUNT, etc.
      if (err instanceof multer.MulterError) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? `单个文件超过大小限制（${CONFIG.maxUploadSizeMb} MB）`
          : err.code === 'LIMIT_FILE_COUNT'
          ? '一次最多上传 100 个文件'
          : '上传失败: ' + err.message;
        return res.status(413).json({ error: msg });
      }
      return next(err);
    }
    try {
      await handleUpload(req, res);
    } catch (e) {
      // Clean up any leftover tmp files on failure.
      const files = (req as any).files as Express.Multer.File[] | undefined;
      if (files) {
        for (const f of files) {
          fs.unlink(f.path).catch(() => {});
        }
      }
      next(e);
    }
  });
});

async function handleUpload(req: Request, res: Response) {
  const targetDir = (req.body.targetPath as string) || '/';
  const absDir = safePath(targetDir);
  const dirStat = await fs.stat(absDir);
  if (!dirStat.isDirectory()) return res.status(400).json({ error: 'Target is not a directory' });

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const uploaded: string[] = [];
  const failures: Array<{ name: string; error: string }> = [];
  for (const file of files) {
    // Sanitise the filename to prevent path traversal and control chars.
    const safe = sanitizeFilename(file.originalname);
    if (!safe) {
      failures.push({ name: file.originalname, error: '文件名无效' });
      await fs.unlink(file.path).catch(() => {});
      continue;
    }
    const dest = path.join(absDir, safe);
    // Ensure resolved dest stays inside absDir.
    if (!dest.startsWith(absDir + path.sep) && dest !== absDir) {
      failures.push({ name: file.originalname, error: '路径非法' });
      await fs.unlink(file.path).catch(() => {});
      continue;
    }
    try {
      // safeMove handles cross-device (EXDEV) by falling back to cp+rm,
      // so uploads work even when STORAGE_ROOT is on a different mount from
      // the .tmp_uploads staging directory.
      await safeMove(file.path, dest);
      uploaded.push(safe);
    } catch (err: any) {
      failures.push({ name: file.originalname, error: err.message || 'move failed' });
      await fs.unlink(file.path).catch(() => {});
    }
  }
  res.json({ success: failures.length === 0, uploaded, failures });
}

/** Strip path separators and control characters; reject empty/NUL/. */
function sanitizeFilename(name: string): string {
  // Strip any directory parts — only keep the basename.
  let base = path.basename(name);
  // Remove NUL and other control chars.
  base = base.replace(/[\x00-\x1f\x7f]/g, '');
  base = base.trim();
  if (!base || base === '.' || base === '..') return '';
  return base;
}

// MKDIR
app.post('/api/mkdir', requireAuth, asyncHandler(async (req, res) => {
  const { parentPath, name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing folder name' });
  safePath(path.join(parentPath || '/', name));
  await fs.mkdir(path.join(safePath(parentPath || '/'), name), { recursive: false });
  res.json({ success: true });
}));

// RENAME
app.post('/api/rename', requireAuth, asyncHandler(async (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) return res.status(400).json({ error: 'Missing oldPath or newName' });

  const absOld = safePath(oldPath);
  const absNew = path.join(path.dirname(absOld), newName);
  safePath(path.join(path.dirname(oldPath), newName));

  try { await fs.access(absNew); return res.status(409).json({ error: 'A file or folder with that name already exists' }); }
  catch { /* good */ }

  await fs.rename(absOld, absNew);
  res.json({ success: true });
}));

// MOVE
app.post('/api/move', requireAuth, asyncHandler(async (req, res) => {
  const { sourcePath, targetDir } = req.body;
  if (!sourcePath || !targetDir) return res.status(400).json({ error: 'Missing sourcePath or targetDir' });

  const absSource = safePath(sourcePath);
  const absTargetDir = safePath(targetDir);
  const dirStat = await fs.stat(absTargetDir);
  if (!dirStat.isDirectory()) return res.status(400).json({ error: 'Target is not a directory' });

  const absDest = path.join(absTargetDir, path.basename(absSource));
  if (absDest.startsWith(absSource + path.sep) || absDest === absSource) return res.status(400).json({ error: 'Cannot move a folder into itself' });

  try { await fs.access(absDest); return res.status(409).json({ error: 'Already exists in target' }); }
  catch { /* good */ }

  await fs.rename(absSource, absDest);
  res.json({ success: true });
}));

// DELETE — moves to trash instead of permanent removal.
app.delete('/api/delete', requireAuth, asyncHandler(async (req, res) => {
  const relPath = req.body.path;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });
  const absPath = safePath(relPath);
  if (absPath === STORAGE_ROOT) return res.status(403).json({ error: 'Cannot delete the storage root' });

  // Refuse if the trash is already over budget.
  const used = await trashDirBytes();
  const limit = CONFIG.trashMaxMb * 1024 * 1024;
  if (used >= limit) {
    return res.status(507).json({ error: `回收站已满（${CONFIG.trashMaxMb} MB），请先清空回收站` });
  }

  const meta = await moveToTrash(absPath);
  res.json({ success: true, trashId: meta.id, originalPath: meta.originalPath });
}));

// ── Trash routes ──────────────────────────────────────────────────────────
app.get('/api/trash', requireAuth, asyncHandler(async (_req, res) => {
  const items = await listTrash();
  // Sort newest first.
  items.sort((a, b) => b.deletedAt - a.deletedAt);
  res.json({ items, count: items.length, totalBytes: items.reduce((s, i) => s + (i.size || 0), 0) });
}));

app.post('/api/trash/restore', requireAuth, asyncHandler(async (req, res) => {
  const { id, overwrite } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const result = await restoreTrashOne(id, !!overwrite);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({ success: true });
}));

app.delete('/api/trash/purge', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const ok = await purgeTrashOne(id);
  if (!ok) return res.status(404).json({ error: 'Item not found' });
  res.json({ success: true });
}));

app.post('/api/trash/empty', requireAuth, asyncHandler(async (_req, res) => {
  const items = await listTrash();
  let purged = 0;
  for (const it of items) {
    if (await purgeTrashOne(it.id)) purged++;
  }
  res.json({ success: true, purged });
}));

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(async () => {
  CONFIG = await loadConfig();

  // Resolve storage root: env var overrides config
  STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || CONFIG.storageRoot);
  PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : CONFIG.port;
  HOST = CONFIG.host;

  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await ensureTrashDirs();
  upload = makeUpload(CONFIG.maxUploadSizeMb);

  // ── Background jobs ─────────────────────────────────────────────────────
  // 1) Thumbnail cache size cap — runs every 30 minutes, deletes oldest
  //    files until under budget. Uses mtime as a cheap LRU proxy.
  scheduleThumbCacheCleanup();

  // 2) Trash retention — purge items older than trashRetentionDays. Runs every
  //    hour. Uses the .purging atomic rename pattern so concurrent restores
  //    aren't racing with cleanup.
  scheduleTrashRetention();

  app.listen(PORT, HOST, () => {
    console.log(`┌─────────────────────────────────────────┐`);
    console.log(`│  📁 ${CONFIG.theme.logoText || 'Web File Manager'}`);
    console.log(`│  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`│  Storage: ${STORAGE_ROOT}`);
    console.log(`│  Trash:   ${TRASH_DIR} (TTL ${CONFIG.trashRetentionDays}d)`);
    console.log(`│  Account: ${CONFIG.username}`);
    console.log(`└─────────────────────────────────────────┘`);
  });
})();

// ── Background schedulers ───────────────────────────────────────────────────

function scheduleThumbCacheCleanup() {
  const run = async () => {
    try {
      const limit = CONFIG.thumbCacheMaxMb * 1024 * 1024;
      let entries: Array<{ p: string; mtime: number; size: number }>;
      try {
        const files = await fs.readdir(THUMB_DIR);
        const stats = await Promise.all(files.map(async f => {
          const p = path.join(THUMB_DIR, f);
          try {
            const s = await fs.stat(p);
            return { p, mtime: s.mtimeMs, size: s.size };
          } catch { return null; }
        }));
        entries = stats.filter(Boolean) as Array<{ p: string; mtime: number; size: number }>;
      } catch { return; }

      let total = entries.reduce((s, e) => s + e.size, 0);
      if (total <= limit) return;

      // Oldest first.
      entries.sort((a, b) => a.mtime - b.mtime);
      for (const e of entries) {
        if (total <= limit) break;
        try {
          await fs.unlink(e.p);
          total -= e.size;
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('thumb cache cleanup error:', err);
    }
  };
  // First run after 30s, then every 30 minutes.
  const t = setTimeout(() => { run(); setInterval(run, 30 * 60 * 1000); }, 30 * 1000);
  t.unref();
}

function scheduleTrashRetention() {
  const run = async () => {
    if (CONFIG.trashRetentionDays <= 0) return; // 0 = keep forever
    const cutoff = Date.now() - CONFIG.trashRetentionDays * 24 * 60 * 60 * 1000;
    const items = await listTrash().catch(() => []);
    for (const it of items) {
      if (it.deletedAt < cutoff) {
        await purgeTrashOne(it.id).catch(() => {});
      }
    }
  };
  // Run once at boot (catches expired items after a long downtime), then hourly.
  run();
  const t = setInterval(run, 60 * 60 * 1000);
  t.unref();
}
