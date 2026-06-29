import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import sharp from 'sharp';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// ── Storage root: configurable via STORAGE_ROOT env var ─────────────────────
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || path.join(__dirname, '..', 'storage'));

// Thumbnail cache directory
const THUMB_DIR = path.join(__dirname, '..', '.cache_thumbs');
const THUMB_SIZE = 256;

// Image extensions we can thumbnail
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'svg', 'avif']);

// Text file extensions we can preview
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

// Ensure storage directory exists
(async () => {
  try {
    await fs.mkdir(STORAGE_ROOT, { recursive: true });
    await fs.mkdir(THUMB_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create directories:', e);
    process.exit(1);
  }
})();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Security: resolve & confine paths inside STORAGE_ROOT ────────────────────
function safePath(requested: string): string {
  const cleaned = requested.replace(/^\/+/, '');
  const resolved = path.resolve(STORAGE_ROOT, cleaned);
  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw Object.assign(new Error('Path traversal blocked'), { status: 403 });
  }
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

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

function isImage(name: string): boolean {
  return IMAGE_EXTS.has(getExt(name));
}

function isTextFile(name: string): boolean {
  const ext = getExt(name);
  if (TEXT_EXTS.has(ext)) return true;
  // Files without extension (Makefile, Dockerfile, etc.)
  if (!name.includes('.')) return true;
  return false;
}

const upload = multer({ dest: path.join(__dirname, '..', '.tmp_uploads') });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/config — return server config to frontend
app.get('/api/config', (_req, res) => {
  res.json({
    storageRoot: STORAGE_ROOT,
    thumbnailSize: THUMB_SIZE,
  });
});

// LIST directory contents
app.get('/api/files', asyncHandler(async (req, res) => {
  const relPath = (req.query.path as string) || '/';
  const absDir = safePath(relPath);

  const stat = await fs.stat(absDir);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Not a directory' });
  }

  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(absDir, entry.name);
      try {
        const s = await fs.stat(fullPath);
        const name = entry.name;
        const isDir = entry.isDirectory();
        return {
          name,
          isDirectory: isDir,
          size: s.size,
          sizeFormatted: formatSize(s.size),
          modified: s.mtime.toISOString(),
          path: path.join(relPath, name).replace(/\\/g, '/'),
          isImage: !isDir && isImage(name),
          isText: !isDir && isTextFile(name),
        };
      } catch {
        return null;
      }
    })
  );

  res.json({
    currentPath: relPath,
    items: items.filter(Boolean).sort((a, b) => {
      if (a!.isDirectory !== b!.isDirectory) return a!.isDirectory ? -1 : 1;
      return a!.name.localeCompare(b!.name);
    }),
  });
}));

// THUMBNAIL — generate & cache, return resized image
app.get('/api/thumbnail', asyncHandler(async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });

  const absPath = safePath(relPath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot thumbnail a directory' });

  // Cache key based on file path + mtime
  const cacheKey = Buffer.from(relPath + ':' + stat.mtimeMs).toString('base64url');
  const cachePath = path.join(THUMB_DIR, cacheKey + '.webp');

  // Try cache hit
  try {
    const cached = await fs.readFile(cachePath);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached);
  } catch { /* cache miss */ }

  // Generate thumbnail
  const ext = getExt(relPath);
  let pipeline: ReturnType<typeof sharp>;

  if (ext === 'svg') {
    // SVG: convert to PNG first, then resize
    pipeline = sharp(absPath, { density: 150 }).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true });
  } else {
    pipeline = sharp(absPath).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true });
  }

  const buf = await pipeline.webp({ quality: 80 }).toBuffer();
  await fs.writeFile(cachePath, buf);

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buf);
}));

// PREVIEW — return text file content
app.get('/api/preview', asyncHandler(async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });

  const absPath = safePath(relPath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot preview a directory' });

  // Limit preview to 1MB
  const MAX_PREVIEW = 1024 * 1024;
  const size = Math.min(stat.size, MAX_PREVIEW);

  const fh = await fs.open(absPath, 'r');
  const buf = Buffer.alloc(size);
  await fh.read(buf, 0, size, 0);
  await fh.close();

  const ext = getExt(relPath);
  const content = buf.toString('utf-8');
  const truncated = stat.size > MAX_PREVIEW;

  res.json({
    name: path.basename(absPath),
    ext,
    content,
    size: stat.size,
    sizeFormatted: formatSize(stat.size),
    truncated,
    maxPreview: formatSize(MAX_PREVIEW),
  });
}));

// DOWNLOAD file
app.get('/api/download', asyncHandler(async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });

  const absPath = safePath(relPath);
  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot download a directory' });

  res.download(absPath, path.basename(absPath));
}));

// UPLOAD files
app.post('/api/upload', upload.array('files', 100), asyncHandler(async (req, res) => {
  const targetDir = (req.body.targetPath as string) || '/';
  const absDir = safePath(targetDir);

  const dirStat = await fs.stat(absDir);
  if (!dirStat.isDirectory()) {
    return res.status(400).json({ error: 'Target is not a directory' });
  }

  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const uploaded: string[] = [];
  for (const file of files) {
    const destPath = path.join(absDir, file.originalname);
    safePath(path.join(targetDir, file.originalname));
    await fs.rename(file.path, destPath);
    uploaded.push(file.originalname);
  }

  res.json({ success: true, uploaded });
}));

// CREATE directory
app.post('/api/mkdir', asyncHandler(async (req, res) => {
  const { parentPath, name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing folder name' });

  const absParent = safePath(parentPath || '/');
  const absTarget = path.join(absParent, name);
  safePath(path.join(parentPath || '/', name));

  await fs.mkdir(absTarget, { recursive: false });
  res.json({ success: true });
}));

// RENAME file/directory
app.post('/api/rename', asyncHandler(async (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) return res.status(400).json({ error: 'Missing oldPath or newName' });

  const absOld = safePath(oldPath);
  const parentDir = path.dirname(absOld);
  const absNew = path.join(parentDir, newName);

  const relParent = path.dirname(oldPath);
  safePath(path.join(relParent, newName));

  try {
    await fs.access(absNew);
    return res.status(409).json({ error: 'A file or folder with that name already exists' });
  } catch { /* good */ }

  await fs.rename(absOld, absNew);
  res.json({ success: true });
}));

// DELETE file/directory
app.delete('/api/delete', asyncHandler(async (req, res) => {
  const relPath = req.body.path;
  if (!relPath) return res.status(400).json({ error: 'Missing path' });

  const absPath = safePath(relPath);

  if (absPath === STORAGE_ROOT) {
    return res.status(403).json({ error: 'Cannot delete the storage root' });
  }

  const stat = await fs.stat(absPath);
  if (stat.isDirectory()) {
    await fs.rm(absPath, { recursive: true, force: true });
  } else {
    await fs.unlink(absPath);
  }

  res.json({ success: true });
}));

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message || err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`┌─────────────────────────────────────────┐`);
  console.log(`│  📁 Web File Manager                    │`);
  console.log(`│  http://localhost:${PORT}                  │`);
  console.log(`│  Storage: ${STORAGE_ROOT}`);
  console.log(`└─────────────────────────────────────────┘`);
});
