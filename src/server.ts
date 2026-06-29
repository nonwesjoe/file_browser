import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';

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

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg', 'avif']);
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

const upload = multer({ dest: path.join(__dirname, '..', '.tmp_uploads') });

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

  const cacheKey = Buffer.from(relPath + ':' + stat.mtimeMs).toString('base64url');
  const cachePath = path.join(THUMB_DIR, cacheKey + '.webp');

  try {
    const cached = await fs.readFile(cachePath);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached);
  } catch { /* cache miss */ }

  const ext = getExt(relPath);
  const pipeline = ext === 'svg'
    ? sharp(absPath, { density: 150 }).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    : sharp(absPath).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true });

  const buf = await pipeline.webp({ quality: 80 }).toBuffer();
  await fs.writeFile(cachePath, buf);
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=86400');
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

// DOWNLOAD
app.get('/api/download', requireAuth, asyncHandler(async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });
  const absPath = safePath(relPath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot download a directory' });
  res.download(absPath, path.basename(absPath));
}));

// UPLOAD
app.post('/api/upload', requireAuth, upload.array('files', 100), asyncHandler(async (req, res) => {
  const targetDir = (req.body.targetPath as string) || '/';
  const absDir = safePath(targetDir);
  const dirStat = await fs.stat(absDir);
  if (!dirStat.isDirectory()) return res.status(400).json({ error: 'Target is not a directory' });

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const uploaded: string[] = [];
  for (const file of files) {
    safePath(path.join(targetDir, file.originalname));
    await fs.rename(file.path, path.join(absDir, file.originalname));
    uploaded.push(file.originalname);
  }
  res.json({ success: true, uploaded });
}));

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

// DELETE
app.delete('/api/delete', requireAuth, asyncHandler(async (req, res) => {
  const relPath = req.body.path;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });
  const absPath = safePath(relPath);
  if (absPath === STORAGE_ROOT) return res.status(403).json({ error: 'Cannot delete the storage root' });

  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) await fs.rm(absPath, { recursive: true, force: true });
  else await fs.unlink(absPath);
  res.json({ success: true });
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

  app.listen(PORT, HOST, () => {
    console.log(`┌─────────────────────────────────────────┐`);
    console.log(`│  📁 ${CONFIG.theme.logoText || 'Web File Manager'}`);
    console.log(`│  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`│  Storage: ${STORAGE_ROOT}`);
    console.log(`│  Account: ${CONFIG.username}`);
    console.log(`└─────────────────────────────────────────┘`);
  });
})();
