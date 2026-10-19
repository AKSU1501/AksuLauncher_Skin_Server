'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

/* =====================================================================
   1. CONFIG  (no hardcoded secrets - everything comes from the environment)
   ===================================================================== */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error('Missing required environment variable: ' + name);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_KEY = requireEnv('SUPABASE_KEY');
const SESSION_SECRET = requireEnv('SESSION_SECRET');
if (SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters long.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

cloudinary.config({
  cloud_name: requireEnv('CLOUDINARY_CLOUD_NAME'),
  api_key: requireEnv('CLOUDINARY_API_KEY'),
  api_secret: requireEnv('CLOUDINARY_API_SECRET'),
  secure: true
});

// RSA keypair for Yggdrasil / authlib-injector signatures.
// Preferred: set YGG_PRIVATE_KEY / YGG_PUBLIC_KEY (PEM, newlines may be written as \n).
// Fallback: keys/ folder (only safe on hosts with a persistent disk).
function loadKeys() {
  if (process.env.YGG_PRIVATE_KEY && process.env.YGG_PUBLIC_KEY) {
    return {
      privateKey: process.env.YGG_PRIVATE_KEY.replace(/\\n/g, '\n'),
      publicKey: process.env.YGG_PUBLIC_KEY.replace(/\\n/g, '\n')
    };
  }
  const dir = path.join(__dirname, 'keys');
  const privFile = path.join(dir, 'private.pem');
  const pubFile = path.join(dir, 'public.pem');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(privFile) || !fs.existsSync(pubFile)) {
    console.warn('[keys] No YGG_PRIVATE_KEY/YGG_PUBLIC_KEY set - generating keys/ on local disk. ' +
      'On hosts with ephemeral disks, set the env vars instead or signatures will break after every deploy.');
    const kp = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(pubFile, kp.publicKey);
    fs.writeFileSync(privFile, kp.privateKey, { mode: 0o600 });
  }
  return { privateKey: fs.readFileSync(privFile, 'utf8'), publicKey: fs.readFileSync(pubFile, 'utf8') };
}
const { privateKey, publicKey } = loadKeys();

/* =====================================================================
   2. HELPERS
   ===================================================================== */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const RE_MC_NAME = /^[A-Za-z0-9_]{3,16}$/;
const RE_ACCOUNT = /^[A-Za-z0-9_.-]{3,32}$/;
const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const RE_VERSION = /^[A-Za-z0-9._+-]{1,40}$/;
const MAX_PROFILES = 15;

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Safe for embedding inside <script> blocks
function jsonForScript(v) {
  return JSON.stringify(v == null ? null : v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function escapeLike(s) { return String(s).replace(/[\\%_]/g, '\\$&'); }
function isUniqueViolation(err) { return !!err && (err.code === '23505' || /duplicate key/i.test(err.message || '')); }
function isHttpsUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u); }

function getOfflineUUID(username) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

// ---- Passwords (bcrypt, with transparent upgrade from the old unsalted SHA-256) ----
const DUMMY_HASH = bcrypt.hashSync('aksu-dummy-password', 12);

function hashPassword(pass) { return bcrypt.hash(pass, 12); }

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 128 || !stored) {
    await bcrypt.compare('x', DUMMY_HASH);
    return { ok: false, upgrade: false };
  }
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const a = crypto.createHash('sha256').update(password).digest();
    const b = Buffer.from(stored, 'hex');
    const ok = crypto.timingSafeEqual(a, b);
    return { ok, upgrade: ok };
  }
  return { ok: await bcrypt.compare(password, stored), upgrade: false };
}

async function upgradeHash(accountId, password) {
  try {
    await supabase.from('accounts').update({ password_hash: await hashPassword(password) }).eq('id', accountId);
  } catch (e) { console.warn('Hash upgrade failed:', e.message); }
}

// ---- Cloudinary ----
function uploadToCloudinary(buffer, publicId, folder, resourceType = 'image', format = 'png') {
  return new Promise((resolve, reject) => {
    const opts = { folder, public_id: publicId, overwrite: true, resource_type: resourceType };
    if (format) opts.format = format;
    const stream = cloudinary.uploader.upload_stream(opts, (error, result) => {
      if (error) return reject(error);
      resolve(result.secure_url);
    });
    stream.end(buffer);
  });
}

function parseCloudinaryUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'res.cloudinary.com') return null;
    const m = u.pathname.match(/^\/([^/]+)\/(image|raw)\/upload\/(?:v\d+\/)?(.+)$/);
    if (!m || m[1] !== cloudinary.config().cloud_name) return null;
    let publicId = decodeURIComponent(m[3]);
    if (m[2] === 'image') publicId = publicId.replace(/\.[a-z0-9]+$/i, '');
    if (!publicId.startsWith('aksu_')) return null; // only ever delete our own folders
    return { resourceType: m[2], publicId };
  } catch (e) { return null; }
}

async function deleteCloudinaryAsset(url) {
  if (!url) return;
  const a = parseCloudinaryUrl(url);
  if (!a) return;
  try {
    await cloudinary.uploader.destroy(a.publicId, { resource_type: a.resourceType, invalidate: true });
  } catch (e) { console.warn('Cloudinary delete failed:', e.message); }
}

async function purgeProfileAssets(profile) {
  await deleteCloudinaryAsset(profile.skin_url);
  await deleteCloudinaryAsset(profile.cape_url);
}

// ---- Image validation (PNG signature + dimensions) ----
const SKIN_SIZES = ['64x64', '64x32', '128x128', '128x64'];
const CAPE_SIZES = ['64x32', '128x64', '22x17', '46x22', '92x44'];
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function validatePng(buf, allowedSizes, label) {
  if (!buf || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new HttpError(400, label + ' must be a valid PNG image');
  }
  const size = buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20);
  if (!allowedSizes.includes(size)) {
    throw new HttpError(400, label + ' has invalid dimensions (' + size + '). Allowed: ' + allowedSizes.join(', '));
  }
}

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 2 } });
const apkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024, files: 1 } });

function runUpload(middleware, tooLargeMsg) {
  return (req, res, next) => middleware(req, res, (err) => {
    if (err) return res.status(400).send(err.code === 'LIMIT_FILE_SIZE' ? tooLargeMsg : 'Upload error: ' + err.message);
    next();
  });
}

/* =====================================================================
   3. MIDDLEWARE
   ===================================================================== */
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieSession({
  name: 'aksu_session',
  keys: [SESSION_SECRET],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PROD
}));

// Launcher (Yggdrasil) endpoints are token-based, not cookie-based, so they are exempt from CSRF.
function isLauncherApi(req) {
  return req.path.startsWith('/authserver') || req.path.startsWith('/sessionserver') || req.path === '/api/profiles/minecraft';
}

// CSRF protection: token stored in the session, required on every state-changing browser request
app.use((req, res, next) => {
  if (isLauncherApi(req)) return next();
  if (!req.session) req.session = {};
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const sent = String(req.get('x-csrf-token') || (req.body && req.body._csrf) || '');
  const a = Buffer.from(sent);
  const b = Buffer.from(req.session.csrf);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).send('Invalid or missing CSRF token. Refresh the page and try again.');
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: 'Too many attempts. Please wait 15 minutes and try again.'
});
const yggAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'ForbiddenOperationException', errorMessage: 'Too many attempts. Try again later.' })
});
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const sessionLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });

function requireLoginPage(req, res, next) {
  if (!req.session || !req.session.accountId) return res.redirect('/auth');
  next();
}
function requireLoginApi(req, res, next) {
  if (!req.session || !req.session.accountId) return res.status(401).send('Unauthorized');
  next();
}
// Admin rights are always re-checked in the database (never trusted from the cookie alone)
const requireAdmin = wrap(async (req, res, next) => {
  if (!req.session || !req.session.accountId) return res.status(403).send('Admin access only');
  const { data } = await supabase.from('accounts').select('is_admin').eq('id', req.session.accountId).maybeSingle();
  if (!data || !data.is_admin) return res.status(403).send('Admin access only');
  next();
});

/* =====================================================================
   4. HTML LAYOUT
   ===================================================================== */
function renderLayout(title, content, session) {
  session = session || {};
  const activeAccount = session.accountName || null;
  const isAdmin = !!session.isAdmin;
  const csrf = session.csrf || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | AksuLauncher</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/skinview3d@3.0.1/bundles/skinview3d.bundle.js"></script>
  <style>
    :root {
      --bg-deep: #07090e; --bg-card: rgba(20, 25, 38, 0.78); --border: #232a3d;
      --accent: #3b82f6; --accent-hover: #2563eb; --accent-glow: rgba(59, 130, 246, 0.4);
      --danger: #ef4444; --success: #10b981; --text: #f8fafc; --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body {
      background-color: var(--bg-deep); color: var(--text); min-height: 100vh; display: flex; flex-direction: column;
      background-image: radial-gradient(circle at 15% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
                        radial-gradient(circle at 85% 65%, rgba(139, 92, 246, 0.08) 0%, transparent 40%);
      background-attachment: fixed;
    }
    nav {
      background: rgba(13, 17, 26, 0.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center; padding: 16px 32px;
      position: sticky; top: 0; z-index: 100; flex-wrap: wrap; gap: 12px;
    }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 1.25rem; font-weight: 800; color: #fff; text-decoration: none; }
    .brand span { color: var(--accent); }
    .nav-links { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
    .nav-links a, .linklike { color: var(--text-muted); text-decoration: none; font-size: 0.92rem; font-weight: 600; transition: color 0.2s; }
    .nav-links a:hover, .linklike:hover { color: #fff; }
    .linklike { background: none; border: none; cursor: pointer; color: #f87171; }
    .badge-admin { background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #fbbf24; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 800; }
    .btn {
      background: var(--accent); color: #fff; padding: 11px 22px; border-radius: 12px; text-decoration: none;
      font-weight: 700; font-size: 0.92rem; border: none; cursor: pointer; transition: all 0.2s ease;
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 16px var(--accent-glow);
    }
    .btn:hover { background: var(--accent-hover); transform: translateY(-1px); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: rgba(35, 42, 61, 0.85); border: 1px solid var(--border); color: var(--text); box-shadow: none; }
    .btn-secondary:hover { background: #2d364f; }
    .btn-danger { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; box-shadow: none; }
    .btn-danger:hover { background: var(--danger); color: #fff; }
    .container { max-width: 1180px; margin: 0 auto; padding: 36px 20px; flex: 1; width: 100%; }
    .card { background: var(--bg-card); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 20px; padding: 28px; box-shadow: 0 14px 34px rgba(0,0,0,0.3); }
    input, select, textarea { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: #0b0e16; color: #fff; font-size: 0.92rem; }
    label { display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; }
    footer { border-top: 1px solid var(--border); text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem; }
    #toast {
      position: fixed; bottom: 28px; right: 28px; background: #151a28; border: 1px solid var(--border); color: #fff;
      padding: 14px 22px; border-radius: 14px; font-weight: 600; box-shadow: 0 12px 36px rgba(0,0,0,0.65);
      display: flex; align-items: center; gap: 10px; transform: translateY(150%); transition: transform 0.3s ease; z-index: 1000;
    }
    #toast.show { transform: translateY(0); }
    #toast.success { border-color: var(--success); }
    #toast.error { border-color: var(--danger); }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="brand">⚡ AKSU<span>LAUNCHER</span></a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="/downloads">Download APK</a>
      ${activeAccount
        ? `<a href="/dashboard">Wardrobe &amp; Usernames</a>
           ${isAdmin ? '<span class="badge-admin">★ ADMIN</span>' : ''}
           <form method="post" action="/logout" style="display:inline;">
             <input type="hidden" name="_csrf" value="${esc(csrf)}">
             <button type="submit" class="linklike">Log Out (${esc(activeAccount)})</button>
           </form>`
        : `<a href="/auth" class="btn" style="padding: 8px 18px;">Sign In / Register</a>`}
    </div>
  </nav>
  <div class="container">${content}</div>
  <div id="toast"></div>
  <footer>&copy; 2026 AksuLauncher &bull; Multi-Profile Cloud &amp; Direct APK Distribution</footer>
  <script>
    var CSRF = ${jsonForScript(csrf)};
    function csrfFetch(url, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ 'X-CSRF-Token': CSRF }, opts.headers || {});
      opts.credentials = 'same-origin';
      return fetch(url, opts);
    }
    function showToast(msg, type) {
      type = type || 'info';
      var t = document.getElementById('toast');
      t.className = type;
      t.textContent = (type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : 'ℹ ') + msg;
      t.classList.add('show');
      setTimeout(function () { t.classList.remove('show'); }, 4000);
    }
  </script>
</body>
</html>`;
}

function errorPage(req, title, message, backHref) {
  return renderLayout('Error', `<div class="card" style="text-align:center; max-width:520px; margin:0 auto;">
    <h3>${esc(title)}</h3>
    <p style="margin:14px 0; color:var(--text-muted);">${esc(message)}</p>
    <a href="${esc(backHref || '/auth')}" class="btn">Back</a></div>`, req.session);
}

/* =====================================================================
   5. PAGES
   ===================================================================== */
// Landing page + Yggdrasil root metadata (authlib-injector fetches this URL and expects JSON)
app.get('/', (req, res) => {
  const ua = req.get('user-agent') || '';
  const wantsJson = req.accepts(['html', 'json']) === 'json' || !/Mozilla/i.test(ua);
  if (wantsJson) {
    const origin = req.protocol + '://' + req.get('host');
    return res.json({
      meta: {
        serverName: 'AksuSkinServer',
        implementationName: 'AksuSkinServer',
        implementationVersion: '4.0.0',
        links: { homepage: origin },
        'feature.non_email_login': true
      },
      skinDomains: [req.get('host'), 'res.cloudinary.com', new URL(SUPABASE_URL).hostname],
      signaturePublickey: publicKey
    });
  }

  const content = `
    <div style="text-align: center; padding: 50px 0 40px;">
      <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; padding: 6px 16px; border-radius: 30px; font-size: 0.85rem; font-weight: 700; margin-bottom: 20px;">
        ⚡ Multi-Username Account System &amp; Direct APK Hosting
      </div>
      <h1 style="font-size: 3.2rem; font-weight: 800; margin-bottom: 18px; letter-spacing: -1px; line-height: 1.15;">
        One Account. Multiple Usernames.<br>
        <span style="background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          Full 3D Skins, Capes &amp; Elytras.
        </span>
      </h1>
      <p style="color: var(--text-muted); font-size: 1.15rem; max-width: 660px; margin: 0 auto 32px; line-height: 1.6;">
        Claim and manage multiple Minecraft usernames under one master account, customize each profile in 3D, and download the official AksuLauncher APK directly.
      </p>
      <div style="display: flex; justify-content: center; gap: 16px; flex-wrap: wrap;">
        <a href="/downloads" class="btn" style="padding: 14px 30px; font-size: 1rem;">📥 Direct APK Download</a>
        <a href="/dashboard" class="btn btn-secondary" style="padding: 14px 30px; font-size: 1rem;">🎨 Manage My Usernames</a>
      </div>
    </div>`;
  res.send(renderLayout('Home', content, req.session));
});

// Direct APK Download Center + Admin Upload Panel
app.get('/downloads', wrap(async (req, res) => {
  const { data: releases } = await supabase.from('releases').select('*').order('created_at', { ascending: false });
  const isAdmin = !!(req.session && req.session.isAdmin);

  const adminUploadHtml = isAdmin ? `
    <div class="card" style="margin-bottom: 28px; border-color: #f59e0b;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
        <h3 style="font-size: 1.25rem; color: #fbbf24;">★ Admin APK Publisher</h3>
        <span class="badge-admin">ADMIN MODE</span>
      </div>
      <form id="apkUploadForm">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px;">
          <div>
            <label>Version Name (e.g., v3.2.0-stable)</label>
            <input type="text" name="version" required maxlength="40" pattern="[A-Za-z0-9._+\\-]{1,40}" placeholder="v3.2.0">
          </div>
          <div>
            <label>Select Compiled .APK File</label>
            <input type="file" name="apk" accept=".apk,application/vnd.android.package-archive,application/octet-stream" style="padding: 9px;">
          </div>
        </div>
        <div style="margin-bottom: 14px;">
          <label>Release Notes / Changelog</label>
          <textarea name="notes" rows="2" maxlength="2000" placeholder="Added custom Elytra physics, updated OpenJDK 17..."></textarea>
        </div>
        <div style="margin-bottom: 16px;">
          <label>Or Paste Direct APK Link (https only, optional if uploading file above)</label>
          <input type="url" name="direct_url" placeholder="https://...">
        </div>
        <button type="submit" id="apkBtn" class="btn" style="background:#f59e0b; color:#000; width:100%;">🚀 Publish Official APK Release</button>
      </form>
    </div>
    <script>
      document.getElementById('apkUploadForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = document.getElementById('apkBtn');
        btn.disabled = true;
        btn.textContent = 'Uploading APK to Cloud Storage... Please wait...';
        csrfFetch('/admin/upload-apk', { method: 'POST', body: new FormData(this) })
          .then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
            showToast('APK Published Successfully!', 'success');
            setTimeout(function () { location.reload(); }, 1200);
          })
          .catch(function (err) {
            showToast('Error: ' + err.message, 'error');
            btn.disabled = false;
            btn.textContent = '🚀 Publish Official APK Release';
          });
      });
    </script>` : '';

  const releasesListHtml = (releases && releases.length > 0) ? releases.map((rel, idx) => {
    const safeUrl = isHttpsUrl(rel.apk_url) ? rel.apk_url : '#';
    return `
    <div class="card" style="margin-bottom: 16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
      <div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-weight:800; font-size:1.25rem;">AksuLauncher ${esc(rel.version)}</span>
          ${idx === 0 ? '<span style="background:rgba(16,185,129,0.15); color:#34d399; padding:3px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">LATEST</span>' : ''}
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:6px;">${esc(rel.notes || 'Official Android build with integrated custom cosmetics.')}</p>
        <div style="font-size:0.75rem; color:#64748b; margin-top:6px;">Published on ${esc(new Date(rel.created_at).toLocaleDateString('en-US'))} by ${esc(rel.uploaded_by || 'admin')}</div>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <a href="${esc(safeUrl)}" download="AksuLauncher-${esc(rel.version)}.apk" rel="noopener" class="btn">📥 Download APK</a>
        ${isAdmin ? `<button type="button" class="btn btn-danger js-delete-release" data-id="${esc(rel.id)}" style="padding:11px 14px;">🗑</button>` : ''}
      </div>
    </div>`;
  }).join('') : `
    <div class="card" style="text-align:center; padding: 48px 20px;">
      <h3 style="margin-bottom:8px;">No APK Uploaded Yet</h3>
      <p style="color:var(--text-muted); font-size:0.95rem;">The administrator has not published an APK build yet. Check back soon!</p>
    </div>`;

  const content = `
    <div style="max-width: 820px; margin: 0 auto;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h2 style="font-size: 2.3rem; font-weight: 800;">Direct APK Download Center</h2>
        <p style="color: var(--text-muted); margin-top: 6px;">Download and install AksuLauncher directly onto your Android device.</p>
      </div>
      ${adminUploadHtml}
      ${releasesListHtml}
    </div>
    <script>
      document.addEventListener('click', function (e) {
        var btn = e.target.closest('.js-delete-release');
        if (!btn) return;
        if (!confirm('Delete this APK release?')) return;
        csrfFetch('/admin/delete-apk/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' })
          .then(function (r) { if (r.ok) location.reload(); else r.text().then(function (t) { showToast(t, 'error'); }); });
      });
    </script>`;
  res.send(renderLayout('Download APK', content, req.session));
}));

// Admin APK upload / delete
app.post('/admin/upload-apk', requireAdmin, apiLimiter,
  runUpload(apkUpload.single('apk'), 'APK is too large (max 150 MB)'),
  wrap(async (req, res) => {
    const version = String(req.body.version || '').trim();
    const notes = String(req.body.notes || '').trim().slice(0, 2000);
    let apkUrl = String(req.body.direct_url || '').trim();

    if (!RE_VERSION.test(version)) throw new HttpError(400, 'Invalid version name (letters, numbers, . _ + - only, max 40 chars)');

    if (req.file) {
      const buf = req.file.buffer;
      if (!/\.apk$/i.test(req.file.originalname || '')) throw new HttpError(400, 'File must have a .apk extension');
      if (buf.length < 4 || buf.readUInt32BE(0) !== 0x504b0304) throw new HttpError(400, 'File is not a valid APK (zip) archive');
      const publicId = 'AksuLauncher_' + version.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Date.now() + '.apk';
      apkUrl = await uploadToCloudinary(buf, publicId, 'aksu_apks', 'raw', null);
    }
    if (!apkUrl) throw new HttpError(400, 'Please provide an APK file or a direct URL');
    if (!isHttpsUrl(apkUrl) || apkUrl.length > 500) throw new HttpError(400, 'Direct URL must be a valid https:// link');

    const { error } = await supabase.from('releases').insert({
      version, notes, apk_url: apkUrl, uploaded_by: req.session.accountName
    });
    if (error) throw error;
    res.status(200).send('OK');
  }));

app.delete('/admin/delete-apk/:id', requireAdmin, wrap(async (req, res) => {
  const { data: rel } = await supabase.from('releases').select('apk_url').eq('id', req.params.id).maybeSingle();
  await supabase.from('releases').delete().eq('id', req.params.id);
  if (rel) await deleteCloudinaryAsset(rel.apk_url);
  res.status(200).send('OK');
}));

// Auth pages
app.get('/auth', (req, res) => {
  if (req.session && req.session.accountId) return res.redirect('/dashboard');
  const csrf = esc(req.session.csrf);

  const content = `
    <div style="max-width: 460px; margin: 24px auto 0;">
      <div class="card" id="loginBox">
        <h2 style="font-size: 1.7rem; font-weight: 800; text-align:center; margin-bottom:6px;">Sign In</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; text-align:center; margin-bottom: 24px;">Access your account and all claimed Minecraft usernames.</p>
        <form action="/login" method="post">
          <input type="hidden" name="_csrf" value="${csrf}">
          <div style="margin-bottom: 16px;">
            <label>Account Name or Email</label>
            <input type="text" name="login_id" required maxlength="254" placeholder="Account name or email">
          </div>
          <div style="margin-bottom: 24px;">
            <label>Password</label>
            <input type="password" name="password" required maxlength="128">
          </div>
          <button type="submit" class="btn" style="width:100%;">Sign In to Account</button>
        </form>
        <div style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: var(--text-muted);">
          New player? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; font-weight: 700;">Create a Master Account</a>
        </div>
      </div>

      <div class="card" id="registerBox" style="display: none;">
        <h2 style="font-size: 1.7rem; font-weight: 800; text-align:center; margin-bottom:6px;">Create Master Account</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; text-align:center; margin-bottom: 24px;">One account lets you claim &amp; manage multiple in-game usernames.</p>
        <form action="/register" method="post">
          <input type="hidden" name="_csrf" value="${csrf}">
          <div style="margin-bottom: 14px;">
            <label>Master Account Name (3-32 chars: letters, numbers, . _ -)</label>
            <input type="text" name="account_name" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_.\\-]{3,32}">
          </div>
          <div style="margin-bottom: 14px;">
            <label>First Minecraft Username (optional, 3-16 letters/numbers/_)</label>
            <input type="text" name="first_mc_username" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" placeholder="e.g. AksuPro">
          </div>
          <div style="margin-bottom: 14px;">
            <label>Email Address</label>
            <input type="email" name="email" required maxlength="254" placeholder="you@example.com">
          </div>
          <div style="margin-bottom: 22px;">
            <label>Password (min 8 characters)</label>
            <input type="password" name="password" required minlength="8" maxlength="72">
          </div>
          <button type="submit" class="btn" style="width:100%;">Create Account</button>
        </form>
        <div style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: var(--text-muted);">
          Already registered? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; font-weight: 700;">Sign In</a>
        </div>
      </div>
    </div>
    <script>
      function toggleAuth() {
        var l = document.getElementById('loginBox');
        var r = document.getElementById('registerBox');
        l.style.display = l.style.display === 'none' ? 'block' : 'none';
        r.style.display = r.style.display === 'none' ? 'block' : 'none';
      }
    </script>`;
  res.send(renderLayout('Sign In', content, req.session));
});

function startSession(req, acc) {
  // Fresh session (new CSRF token) on every login/registration
  req.session = {
    accountId: acc.id,
    accountName: acc.account_name,
    isAdmin: !!acc.is_admin,
    csrf: crypto.randomBytes(24).toString('hex')
  };
}

async function isMcNameTaken(name, exceptProfileId) {
  const { data } = await supabase.from('profiles').select('id').ilike('mc_username', escapeLike(name)).limit(1);
  if (!data || data.length === 0) return false;
  return !(exceptProfileId && String(data[0].id) === String(exceptProfileId));
}

app.post('/register', authLimiter, wrap(async (req, res) => {
  const accountName = String(req.body.account_name || '').trim();
  const firstMcRaw = String(req.body.first_mc_username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!RE_ACCOUNT.test(accountName)) return res.status(400).send(errorPage(req, 'Registration Error', 'Account name must be 3-32 characters: letters, numbers, dot, underscore or dash.'));
  if (!RE_EMAIL.test(email) || email.length > 254) return res.status(400).send(errorPage(req, 'Registration Error', 'Please enter a valid email address.'));
  if (password.length < 8 || password.length > 72) return res.status(400).send(errorPage(req, 'Registration Error', 'Password must be 8-72 characters long.'));
  if (firstMcRaw && !RE_MC_NAME.test(firstMcRaw)) return res.status(400).send(errorPage(req, 'Registration Error', 'Minecraft username must be 3-16 characters: letters, numbers or underscore.'));

  // Falls back to the account name if it is also a valid Minecraft username
  const firstMc = firstMcRaw || (RE_MC_NAME.test(accountName) ? accountName : '');
  if (firstMcRaw && await isMcNameTaken(firstMcRaw)) {
    return res.status(400).send(errorPage(req, 'Registration Error', 'That Minecraft username is already claimed.'));
  }

  // is_admin is NEVER set here. Grant admin manually in the database.
  const { data: acc, error } = await supabase.from('accounts').insert({
    account_name: accountName,
    email,
    password_hash: await hashPassword(password),
    is_admin: false
  }).select().single();

  if (error) {
    const msg = isUniqueViolation(error) ? 'That account name or email is already registered.' : 'Could not create the account. Please try again.';
    if (!isUniqueViolation(error)) console.error('Register error:', error);
    return res.status(400).send(errorPage(req, 'Registration Error', msg));
  }

  if (firstMc && !(await isMcNameTaken(firstMc))) {
    const { error: pErr } = await supabase.from('profiles').insert({
      account_id: acc.id, mc_username: firstMc, offline_uuid: getOfflineUUID(firstMc)
    });
    if (pErr && !isUniqueViolation(pErr)) console.error('First profile error:', pErr);
  }

  startSession(req, acc);
  res.redirect('/dashboard');
}));

// Looks up an account by email / account name (and optionally by Minecraft profile name for launcher logins)
async function findAccountByLogin(loginId, allowProfileName) {
  const id = String(loginId || '').trim();
  if (!id || id.length > 254) return null;

  if (id.includes('@')) {
    const { data } = await supabase.from('accounts').select('*').eq('email', id.toLowerCase()).maybeSingle();
    return data ? { acc: data, profile: null } : null;
  }

  const { data: acc } = await supabase.from('accounts').select('*').ilike('account_name', escapeLike(id)).maybeSingle();
  if (acc) return { acc, profile: null };

  if (allowProfileName && RE_MC_NAME.test(id)) {
    const { data: profile } = await supabase.from('profiles').select('*').ilike('mc_username', escapeLike(id)).maybeSingle();
    if (profile) {
      const { data: owner } = await supabase.from('accounts').select('*').eq('id', profile.account_id).maybeSingle();
      if (owner) return { acc: owner, profile };
    }
  }
  return null;
}

app.post('/login', authLimiter, wrap(async (req, res) => {
  const found = await findAccountByLogin(req.body.login_id, false);
  const password = String(req.body.password || '');
  const result = await verifyPassword(password, found && found.acc.password_hash);

  if (!found || !result.ok) {
    return res.status(401).send(errorPage(req, 'Invalid Credentials', 'The account name/email or password is incorrect.'));
  }
  if (result.upgrade) await upgradeHash(found.acc.id, password);

  startSession(req, found.acc);
  res.redirect('/dashboard');
}));

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// Multi-username dashboard & 3D studio
app.get('/dashboard', requireLoginPage, wrap(async (req, res) => {
  const { data: profiles, error } = await supabase
    .from('profiles').select('*')
    .eq('account_id', req.session.accountId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const list = profiles || [];
  const selectedId = req.query.profile ? String(req.query.profile) : (list[0] ? String(list[0].id) : null);
  const activeProfile = list.find((p) => String(p.id) === selectedId) || list[0] || null;

  const skinUrl = activeProfile && isHttpsUrl(activeProfile.skin_url) ? activeProfile.skin_url : '';
  const capeUrl = activeProfile && isHttpsUrl(activeProfile.cape_url) ? activeProfile.cape_url : '';
  const modelType = activeProfile && activeProfile.model === 'slim' ? 'slim' : 'default';

  const profilesSidebarHtml = list.map((p) => {
    const isSel = activeProfile && String(p.id) === String(activeProfile.id);
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:12px; border:1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}; background:${isSel ? 'rgba(59,130,246,0.12)' : '#0c0f17'}; margin-bottom:10px;">
        <a href="/dashboard?profile=${encodeURIComponent(p.id)}" style="color:#fff; text-decoration:none; font-weight:700; flex:1;">
          🎮 ${esc(p.mc_username)}
          <span style="display:block; font-size:0.72rem; color:var(--text-muted); font-weight:500;">
            ${p.skin_url ? 'Custom Skin' : 'Default Steve'} &bull; ${p.cape_url ? 'Cape Equipped' : 'No Cape'}
          </span>
        </a>
        <button type="button" class="btn btn-danger js-delete-profile" data-id="${esc(p.id)}" data-name="${esc(p.mc_username)}" style="padding:6px 10px; font-size:0.75rem;" title="Release/Delete Username">🗑</button>
      </div>`;
  }).join('');

  const studioEditorHtml = activeProfile ? `
    <div class="studio-grid">
      <div class="viewer-box">
        <div class="view-selector-bar">
          <button type="button" class="view-tab active" onclick="switchView('full', this)">Full Player</button>
          <button type="button" class="view-tab" onclick="switchView('skin', this)">Skin Only</button>
          <button type="button" class="view-tab" onclick="switchView('cape', this)">Cape 3D</button>
          <button type="button" class="view-tab" onclick="switchView('elytra', this)">Elytra 3D</button>
        </div>
        <canvas id="skin_container"></canvas>
        <div class="viewer-controls">
          <button type="button" class="pill-btn active" id="btnAnim" onclick="toggleAnimation()">Walk: ON</button>
          <button type="button" class="pill-btn" onclick="resetCamera()">Reset Camera</button>
        </div>
      </div>

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid var(--border); padding-bottom:12px;">
          <div>
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">EDITING USERNAME</span>
            <h3 style="font-size:1.4rem; font-weight:800; color:#60a5fa;">${esc(activeProfile.mc_username)}</h3>
          </div>
          <button type="button" class="btn btn-secondary js-rename-profile" data-id="${esc(activeProfile.id)}" data-name="${esc(activeProfile.mc_username)}" style="padding:7px 12px; font-size:0.8rem;">✏ Rename</button>
        </div>

        <form id="cosmeticsForm">
          <input type="hidden" name="profile_id" value="${esc(activeProfile.id)}">

          <label>Arm Geometry Model</label>
          <select id="modelSelector" name="model" style="margin-bottom:16px;">
            <option value="default" ${modelType === 'default' ? 'selected' : ''}>Classic 4-pixel (Steve)</option>
            <option value="slim" ${modelType === 'slim' ? 'selected' : ''}>Slim 3-pixel (Alex)</option>
          </select>

          <label>Skin Texture (.png, max 1 MB)</label>
          <div class="file-dropzone" ondragover="event.preventDefault(); this.style.borderColor='var(--accent)';" ondragleave="this.style.borderColor='var(--border)';" ondrop="handleDrop(event, 'skinInput')">
            <div id="skinLabel" style="font-weight:700; margin-bottom:8px;">${skinUrl ? '✓ Custom Skin Active' : 'Default Steve Skin Active'}</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;">Drag &amp; Drop PNG here or tap below</div>
            <input type="file" id="skinInput" name="skin" accept="image/png" class="native-file-btn">
          </div>
          ${skinUrl ? `<button type="button" class="btn btn-danger js-clear-asset" data-type="skin" style="width:100%; margin-top:8px; padding:8px; font-size:0.8rem;">Remove Custom Skin (Revert to Steve)</button>` : ''}

          <label style="margin-top:16px;">Cape &amp; Elytra (.png, max 1 MB)</label>
          <div class="file-dropzone" ondragover="event.preventDefault(); this.style.borderColor='var(--accent)';" ondragleave="this.style.borderColor='var(--border)';" ondrop="handleDrop(event, 'capeInput')">
            <div id="capeLabel" style="font-weight:700; margin-bottom:8px;">${capeUrl ? '✓ Custom Cape Active' : 'No Custom Cape Equipped'}</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;">Drag &amp; Drop PNG here or tap below</div>
            <input type="file" id="capeInput" name="cape" accept="image/png" class="native-file-btn">
          </div>
          ${capeUrl ? `<button type="button" class="btn btn-danger js-clear-asset" data-type="cape" style="width:100%; margin-top:8px; padding:8px; font-size:0.8rem;">Remove Custom Cape</button>` : ''}

          <button type="submit" id="saveBtn" class="btn" style="width:100%; margin-top:22px; padding:14px;">💾 Save Changes to Cloud</button>
        </form>
      </div>
    </div>` : `
    <div class="card" style="text-align:center; padding:48px 20px;">
      <h3>No Minecraft Usernames Claimed Yet</h3>
      <p style="color:var(--text-muted); margin-top:8px;">Use the panel on the left to claim your first in-game username!</p>
    </div>`;

  const content = `
    <style>
      .dashboard-layout { display: grid; grid-template-columns: 310px 1fr; gap: 24px; align-items: start; }
      .studio-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 24px; }
      @media(max-width: 960px) { .dashboard-layout, .studio-grid { grid-template-columns: 1fr; } }
      .viewer-box { background: radial-gradient(circle, #161c2e 0%, #090c14 100%); border: 1px solid var(--border); border-radius: 20px; position: relative; min-height: 500px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .view-selector-bar { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; gap: 6px; background: rgba(13, 17, 26, 0.85); padding: 6px; border-radius: 12px; border: 1px solid var(--border); z-index: 20; }
      .view-tab { flex: 1; background: transparent; border: none; color: var(--text-muted); padding: 8px; border-radius: 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: all 0.2s; }
      .view-tab.active { background: var(--accent); color: #fff; }
      .viewer-controls { position: absolute; bottom: 14px; display: flex; gap: 8px; z-index: 20; }
      .pill-btn { background: rgba(20, 25, 38, 0.85); border: 1px solid var(--border); color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
      .pill-btn.active { background: var(--accent); border-color: var(--accent); }
      .file-dropzone { border: 2px dashed var(--border); border-radius: 12px; padding: 14px; text-align: center; background: rgba(11, 14, 22, 0.6); transition: border-color 0.2s; }
      .file-dropzone:hover { border-color: var(--accent); }
      .native-file-btn { background: #141926; border: 1px solid var(--border); padding: 8px; border-radius: 8px; font-size: 0.82rem; color: #fff; cursor: pointer; width: 100%; }
      .native-file-btn::file-selector-button { background: var(--accent); color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 700; margin-right: 10px; cursor: pointer; }
    </style>

    <div class="dashboard-layout">
      <div class="card" style="padding: 22px;">
        <h3 style="font-size: 1.15rem; font-weight: 800; margin-bottom: 4px;">My Usernames (${list.length}/${MAX_PROFILES})</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px;">Select a username to customize its 3D skin &amp; cape.</p>

        ${profilesSidebarHtml}

        <form id="addProfileForm" style="margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border);">
          <label>Claim Another Username</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="newMcName" required maxlength="16" pattern="[A-Za-z0-9_]{3,16}" placeholder="New username...">
            <button type="submit" class="btn" style="padding: 0 16px;">+ Add</button>
          </div>
        </form>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
          <button type="button" id="deleteAccountBtn" class="btn btn-danger" style="width:100%; font-size:0.8rem; padding:9px;">⚠ Delete Entire Account</button>
        </div>
      </div>

      <div>${studioEditorHtml}</div>
    </div>

    <script>
      var SKIN_URL = ${jsonForScript(skinUrl)};
      var CAPE_URL = ${jsonForScript(capeUrl)};
      var MODEL_TYPE = ${jsonForScript(modelType)};

      function jsonPost(url, body) {
        return csrfFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }

      var addForm = document.getElementById('addProfileForm');
      if (addForm) addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = document.getElementById('newMcName').value.trim();
        if (!name) return;
        jsonPost('/api/profiles/add', { mc_username: name }).then(function (r) {
          if (r.ok) return r.json().then(function (d) { location.href = '/dashboard?profile=' + encodeURIComponent(d.id); });
          return r.text().then(function (t) { showToast(t, 'error'); });
        });
      });

      document.addEventListener('click', function (e) {
        var del = e.target.closest('.js-delete-profile');
        if (del) {
          if (!confirm('Release and delete username "' + del.dataset.name + '"?')) return;
          csrfFetch('/api/profiles/' + encodeURIComponent(del.dataset.id), { method: 'DELETE' })
            .then(function (r) { if (r.ok) location.href = '/dashboard'; else r.text().then(function (t) { showToast(t, 'error'); }); });
          return;
        }
        var ren = e.target.closest('.js-rename-profile');
        if (ren) {
          var newName = prompt('Enter new Minecraft username:', ren.dataset.name);
          if (!newName || newName.trim() === ren.dataset.name) return;
          jsonPost('/api/profiles/rename', { profile_id: ren.dataset.id, new_name: newName.trim() }).then(function (r) {
            if (r.ok) location.reload(); else r.text().then(function (t) { showToast(t, 'error'); });
          });
          return;
        }
        var clr = e.target.closest('.js-clear-asset');
        if (clr) {
          if (!confirm('Remove custom ' + clr.dataset.type + ' from this username?')) return;
          var pid = document.querySelector('#cosmeticsForm input[name=profile_id]').value;
          jsonPost('/api/profiles/clear-asset', { profile_id: pid, type: clr.dataset.type }).then(function (r) {
            if (r.ok) location.reload(); else r.text().then(function (t) { showToast(t, 'error'); });
          });
        }
      });

      document.getElementById('deleteAccountBtn').addEventListener('click', function () {
        if (!confirm('Are you sure? This will permanently delete your master account and ALL claimed usernames!')) return;
        csrfFetch('/api/account', { method: 'DELETE' }).then(function (r) { if (r.ok) location.href = '/'; });
      });

      function handleDrop(e, inputId) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.style.borderColor = 'var(--border)';
        var files = e.dataTransfer.files;
        if (files && files.length > 0) {
          var input = document.getElementById(inputId);
          input.files = files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Local 64x64 Steve-style skin so the preview always renders (no CORS issues)
      function createDefaultSteveDataURL() {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#b58463'; ctx.fillRect(0, 0, 32, 16);
        ctx.fillStyle = '#4a3222'; ctx.fillRect(8, 0, 8, 8); ctx.fillRect(8, 8, 8, 2);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(9, 12, 2, 1); ctx.fillRect(13, 12, 2, 1);
        ctx.fillStyle = '#4b387c'; ctx.fillRect(10, 12, 1, 1); ctx.fillRect(13, 12, 1, 1);
        ctx.fillStyle = '#734731'; ctx.fillRect(11, 14, 2, 1);
        ctx.fillStyle = '#009999'; ctx.fillRect(16, 16, 24, 16);
        ctx.fillStyle = '#b58463'; ctx.fillRect(40, 16, 16, 16); ctx.fillRect(32, 48, 16, 16);
        ctx.fillStyle = '#009999'; ctx.fillRect(40, 20, 16, 4); ctx.fillRect(32, 52, 16, 4);
        ctx.fillStyle = '#383884'; ctx.fillRect(0, 16, 16, 16); ctx.fillRect(16, 48, 16, 16);
        return c.toDataURL('image/png');
      }

      // Local 64x32 default cape/elytra texture
      function createDefaultCapeDataURL() {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 32;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, 64, 32);
        ctx.fillStyle = '#3b82f6'; ctx.fillRect(1, 1, 10, 16); ctx.fillRect(22, 0, 22, 22);
        ctx.fillStyle = '#60a5fa'; ctx.fillRect(3, 4, 6, 10);
        return c.toDataURL('image/png');
      }

      var canvas = document.getElementById('skin_container');
      if (canvas) {
        var defaultSteveSkin = createDefaultSteveDataURL();
        var defaultCapeTexture = createDefaultCapeDataURL();
        var activeSkinUrl = SKIN_URL || defaultSteveSkin;
        var activeCapeUrl = CAPE_URL;
        var currentMode = 'full';
        var currentModel = MODEL_TYPE || 'default';

        var skinViewer = new skinview3d.SkinViewer({ canvas: canvas, width: 340, height: 450 });

        skinViewer.loadSkin(activeSkinUrl, { model: currentModel }).catch(function () {
          skinViewer.loadSkin(defaultSteveSkin, { model: currentModel });
        });
        if (activeCapeUrl) skinViewer.loadCape(activeCapeUrl, { backEquipment: 'cape' });

        var walkAnim = skinViewer.animations.add(skinview3d.WalkingAnimation);
        var isWalking = true;

        window.setPlayerBodyVisibility = function (vis) {
          if (skinViewer.playerObject && skinViewer.playerObject.skin) skinViewer.playerObject.skin.visible = vis;
        };

        window.resetCamera = function () {
          if (currentMode === 'cape' || currentMode === 'elytra') skinViewer.camera.position.set(0, 0, -55);
          else skinViewer.camera.position.set(0, 0, 60);
          skinViewer.camera.lookAt(0, 0, 0);
        };

        window.switchView = async function (mode, btnEl) {
          currentMode = mode;
          document.querySelectorAll('.view-tab').forEach(function (b) { b.classList.remove('active'); });
          if (btnEl) btnEl.classList.add('active');
          var capeToRender = activeCapeUrl || defaultCapeTexture;

          if (mode === 'full') {
            setPlayerBodyVisibility(true);
            if (activeCapeUrl) await skinViewer.loadCape(activeCapeUrl, { backEquipment: 'cape' });
            else skinViewer.loadCape(null);
            skinViewer.camera.position.set(0, 0, 60);
          } else if (mode === 'skin') {
            setPlayerBodyVisibility(true);
            skinViewer.loadCape(null);
            skinViewer.camera.position.set(0, 0, 60);
          } else if (mode === 'cape') {
            await skinViewer.loadCape(capeToRender, { backEquipment: 'cape' });
            setPlayerBodyVisibility(false);
            skinViewer.camera.position.set(0, 0, -55);
          } else if (mode === 'elytra') {
            await skinViewer.loadCape(capeToRender, { backEquipment: 'elytra' });
            setPlayerBodyVisibility(false);
            skinViewer.camera.position.set(0, 0, -55);
          }
          skinViewer.camera.lookAt(0, 0, 0);
        };

        window.toggleAnimation = function () {
          var btn = document.getElementById('btnAnim');
          isWalking = !isWalking;
          walkAnim.paused = !isWalking;
          btn.textContent = isWalking ? 'Walk: ON' : 'Walk: OFF';
          btn.classList.toggle('active', isWalking);
        };

        document.getElementById('modelSelector').addEventListener('change', function (e) {
          currentModel = e.target.value;
          skinViewer.loadSkin(activeSkinUrl, { model: currentModel });
        });

        document.getElementById('skinInput').addEventListener('change', function (e) {
          var file = e.target.files[0];
          if (!file) return;
          if (file.size > 1024 * 1024) { showToast('Skin must be under 1 MB', 'error'); e.target.value = ''; return; }
          var reader = new FileReader();
          reader.onload = async function (ev) {
            activeSkinUrl = ev.target.result;
            await skinViewer.loadSkin(activeSkinUrl, { model: document.getElementById('modelSelector').value });
            if (currentMode === 'full' || currentMode === 'skin') setPlayerBodyVisibility(true);
            document.getElementById('skinLabel').textContent = 'Selected: ' + file.name;
            showToast('Previewing new skin in 3D!', 'info');
          };
          reader.readAsDataURL(file);
        });

        document.getElementById('capeInput').addEventListener('change', function (e) {
          var file = e.target.files[0];
          if (!file) return;
          if (file.size > 1024 * 1024) { showToast('Cape must be under 1 MB', 'error'); e.target.value = ''; return; }
          var reader = new FileReader();
          reader.onload = async function (ev) {
            activeCapeUrl = ev.target.result;
            var equipMode = currentMode === 'elytra' ? 'elytra' : 'cape';
            await skinViewer.loadCape(activeCapeUrl, { backEquipment: equipMode });
            document.getElementById('capeLabel').textContent = 'Selected: ' + file.name;
            showToast('Previewing new cape/elytra in 3D!', 'info');
          };
          reader.readAsDataURL(file);
        });

        document.getElementById('cosmeticsForm').addEventListener('submit', function (e) {
          e.preventDefault();
          var btn = document.getElementById('saveBtn');
          btn.disabled = true;
          btn.textContent = 'Saving to Cloud...';
          csrfFetch('/upload', { method: 'POST', body: new FormData(this) })
            .then(function (r) {
              if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
              showToast('Saved & synced to username!', 'success');
              setTimeout(function () { location.reload(); }, 1000);
            })
            .catch(function (err) {
              showToast(err.message, 'error');
              btn.disabled = false;
              btn.textContent = '💾 Save Changes to Cloud';
            });
        });
      }
    </script>`;
  res.send(renderLayout('Wardrobe & Usernames', content, req.session));
}));

/* =====================================================================
   6. PROFILE & ACCOUNT MANAGEMENT APIs
   ===================================================================== */
app.post('/api/profiles/add', requireLoginApi, apiLimiter, wrap(async (req, res) => {
  const mc_username = String((req.body && req.body.mc_username) || '').trim();
  if (!RE_MC_NAME.test(mc_username)) throw new HttpError(400, 'Username must be 3-16 characters: letters, numbers or underscore');

  const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_id', req.session.accountId);
  if ((count || 0) >= MAX_PROFILES) throw new HttpError(400, 'You can claim at most ' + MAX_PROFILES + ' usernames');

  if (await isMcNameTaken(mc_username)) throw new HttpError(400, 'Username is already claimed by a player');

  const { data, error } = await supabase.from('profiles').insert({
    account_id: req.session.accountId, mc_username, offline_uuid: getOfflineUUID(mc_username)
  }).select().single();

  if (error) {
    if (isUniqueViolation(error)) throw new HttpError(400, 'Username is already claimed by a player');
    throw error;
  }
  res.json({ id: data.id });
}));

app.post('/api/profiles/rename', requireLoginApi, apiLimiter, wrap(async (req, res) => {
  const profileId = String((req.body && req.body.profile_id) || '');
  const newName = String((req.body && req.body.new_name) || '').trim();
  if (!RE_MC_NAME.test(newName)) throw new HttpError(400, 'Username must be 3-16 characters: letters, numbers or underscore');
  if (await isMcNameTaken(newName, profileId)) throw new HttpError(400, 'That username is already taken');

  const { data, error } = await supabase.from('profiles')
    .update({ mc_username: newName, offline_uuid: getOfflineUUID(newName) })
    .eq('id', profileId).eq('account_id', req.session.accountId).select('id');

  if (error) {
    if (isUniqueViolation(error)) throw new HttpError(400, 'That username is already taken');
    throw error;
  }
  if (!data || data.length === 0) throw new HttpError(404, 'Profile not found');
  res.send('OK');
}));

app.post('/api/profiles/clear-asset', requireLoginApi, apiLimiter, wrap(async (req, res) => {
  const profileId = String((req.body && req.body.profile_id) || '');
  const type = req.body && req.body.type;
  if (type !== 'skin' && type !== 'cape') throw new HttpError(400, 'Invalid asset type');

  const { data: prof } = await supabase.from('profiles').select('*').eq('id', profileId).eq('account_id', req.session.accountId).maybeSingle();
  if (!prof) throw new HttpError(404, 'Profile not found');

  const field = type === 'skin' ? 'skin_url' : 'cape_url';
  await supabase.from('profiles').update({ [field]: null }).eq('id', profileId).eq('account_id', req.session.accountId);
  await deleteCloudinaryAsset(prof[field]);
  res.send('OK');
}));

app.delete('/api/profiles/:id', requireLoginApi, apiLimiter, wrap(async (req, res) => {
  const { data: prof } = await supabase.from('profiles').select('*').eq('id', req.params.id).eq('account_id', req.session.accountId).maybeSingle();
  if (!prof) throw new HttpError(404, 'Profile not found');

  await supabase.from('tokens').delete().eq('profile_id', String(prof.id));
  await supabase.from('profiles').delete().eq('id', prof.id).eq('account_id', req.session.accountId);
  await purgeProfileAssets(prof);
  res.send('OK');
}));

app.delete('/api/account', requireLoginApi, apiLimiter, wrap(async (req, res) => {
  const accountId = req.session.accountId;
  const { data: profs } = await supabase.from('profiles').select('*').eq('account_id', accountId);

  // Explicit deletes - we do not rely on ON DELETE CASCADE being configured
  await supabase.from('tokens').delete().eq('account_id', String(accountId));
  await supabase.from('profiles').delete().eq('account_id', accountId);
  const { error } = await supabase.from('accounts').delete().eq('id', accountId);
  if (error) throw error;

  for (const p of profs || []) await purgeProfileAssets(p);
  req.session = null;
  res.send('OK');
}));

// Upload cosmetics for one username profile
app.post('/upload', requireLoginApi, apiLimiter,
  runUpload(imageUpload.fields([{ name: 'skin', maxCount: 1 }, { name: 'cape', maxCount: 1 }]), 'File too large (max 1 MB per image)'),
  wrap(async (req, res) => {
    const profileId = String(req.body.profile_id || '');
    const model = req.body.model === 'slim' ? 'slim' : 'default';

    const { data: prof } = await supabase.from('profiles').select('*').eq('id', profileId).eq('account_id', req.session.accountId).maybeSingle();
    if (!prof) throw new HttpError(403, 'Profile not found');

    const updates = { model };
    const replaced = [];
    const skinFile = req.files && req.files['skin'] && req.files['skin'][0];
    const capeFile = req.files && req.files['cape'] && req.files['cape'][0];

    // Validate everything before uploading anything
    if (skinFile) validatePng(skinFile.buffer, SKIN_SIZES, 'Skin');
    if (capeFile) validatePng(capeFile.buffer, CAPE_SIZES, 'Cape');

    if (skinFile) {
      updates.skin_url = await uploadToCloudinary(skinFile.buffer, prof.mc_username.toLowerCase() + '_skin_' + Date.now(), 'aksu_skins', 'image', 'png');
      if (prof.skin_url) replaced.push(prof.skin_url);
    }
    if (capeFile) {
      updates.cape_url = await uploadToCloudinary(capeFile.buffer, prof.mc_username.toLowerCase() + '_cape_' + Date.now(), 'aksu_capes', 'image', 'png');
      if (prof.cape_url) replaced.push(prof.cape_url);
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', prof.id).eq('account_id', req.session.accountId);
    if (error) throw error;

    for (const old of replaced) await deleteCloudinaryAsset(old);
    res.status(200).send('OK');
  }));

/* =====================================================================
   7. YGGDRASIL / AUTHLIB-INJECTOR API  (authserver + sessionserver)
   ===================================================================== */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function yggError(res, status, error, message) {
  return res.status(status).json({ error, errorMessage: message });
}
const invalidCredentials = (res) => yggError(res, 403, 'ForbiddenOperationException', 'Invalid credentials. Invalid username or password.');
const invalidToken = (res) => yggError(res, 403, 'ForbiddenOperationException', 'Invalid token.');

const newToken = () => crypto.randomBytes(16).toString('hex');
const profileUuid = (p) => p.offline_uuid || getOfflineUUID(p.mc_username);
const toYggProfile = (p) => ({ id: profileUuid(p), name: p.mc_username });
const toYggUser = (acc) => ({ id: String(acc.id).replace(/-/g, '').toLowerCase(), properties: [] });

async function getValidToken(accessToken, clientToken) {
  if (typeof accessToken !== 'string' || !/^[a-f0-9]{32}$/.test(accessToken)) return null;
  const { data } = await supabase.from('tokens').select('*').eq('access_token', accessToken).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.created_at).getTime() > TOKEN_TTL_MS) {
    await supabase.from('tokens').delete().eq('access_token', accessToken);
    return null;
  }
  if (clientToken && data.client_token !== clientToken) return null;
  return data;
}

function cleanClientToken(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

// Signed profile response (used by profile lookup and hasJoined)
function buildProfileResponse(p) {
  const uuid = profileUuid(p);
  const textures = {};
  if (isHttpsUrl(p.skin_url)) {
    textures.SKIN = { url: p.skin_url };
    if (p.model === 'slim') textures.SKIN.metadata = { model: 'slim' };
  }
  if (isHttpsUrl(p.cape_url)) textures.CAPE = { url: p.cape_url };

  const textureData = { timestamp: Date.now(), profileId: uuid, profileName: p.mc_username, textures };
  const base64Textures = Buffer.from(JSON.stringify(textureData)).toString('base64');
  const signer = crypto.createSign('RSA-SHA1');
  signer.update(base64Textures);
  const signature = signer.sign(privateKey, 'base64');

  return { id: uuid, name: p.mc_username, properties: [{ name: 'textures', value: base64Textures, signature }] };
}

app.post('/authserver/authenticate', yggAuthLimiter, wrap(async (req, res) => {
  const { username, password, clientToken, requestUser } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return invalidCredentials(res);

  const found = await findAccountByLogin(username, true);
  const result = await verifyPassword(password, found && found.acc.password_hash);
  if (!found || !result.ok) return invalidCredentials(res);
  if (result.upgrade) await upgradeHash(found.acc.id, password);

  const { data: profiles } = await supabase.from('profiles').select('*').eq('account_id', found.acc.id).order('created_at', { ascending: true });
  const list = profiles || [];
  const selected = found.profile || (list.length === 1 ? list[0] : null);

  const accessToken = newToken();
  const client = cleanClientToken(clientToken) || newToken();
  const { error } = await supabase.from('tokens').insert({
    access_token: accessToken, client_token: client,
    account_id: String(found.acc.id), profile_id: selected ? String(selected.id) : null
  });
  if (error) throw error;

  const body = { accessToken, clientToken: client, availableProfiles: list.map(toYggProfile) };
  if (selected) body.selectedProfile = toYggProfile(selected);
  if (requestUser) body.user = toYggUser(found.acc);
  res.json(body);
}));

app.post('/authserver/refresh', yggAuthLimiter, wrap(async (req, res) => {
  const { accessToken, clientToken, requestUser, selectedProfile } = req.body || {};
  const tok = await getValidToken(accessToken, cleanClientToken(clientToken));
  if (!tok) return invalidToken(res);

  let profileId = tok.profile_id;
  let selected = null;

  if (selectedProfile && selectedProfile.id) {
    if (tok.profile_id) return yggError(res, 400, 'IllegalArgumentException', 'Access token already has a profile assigned.');
    const uuid = String(selectedProfile.id).replace(/-/g, '').toLowerCase();
    const { data: p } = await supabase.from('profiles').select('*').eq('offline_uuid', uuid).eq('account_id', tok.account_id).maybeSingle();
    if (!p) return yggError(res, 403, 'ForbiddenOperationException', 'Invalid profile.');
    selected = p; profileId = String(p.id);
  } else if (profileId) {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', profileId).maybeSingle();
    selected = p || null;
    if (!p) profileId = null;
  }

  const newAccess = newToken();
  await supabase.from('tokens').delete().eq('access_token', tok.access_token);
  const { error } = await supabase.from('tokens').insert({
    access_token: newAccess, client_token: tok.client_token, account_id: tok.account_id, profile_id: profileId
  });
  if (error) throw error;

  const body = { accessToken: newAccess, clientToken: tok.client_token };
  if (selected) body.selectedProfile = toYggProfile(selected);
  if (requestUser) {
    const { data: acc } = await supabase.from('accounts').select('id').eq('id', tok.account_id).maybeSingle();
    if (acc) body.user = toYggUser(acc);
  }
  res.json(body);
}));

app.post('/authserver/validate', yggAuthLimiter, wrap(async (req, res) => {
  const { accessToken, clientToken } = req.body || {};
  const tok = await getValidToken(accessToken, cleanClientToken(clientToken));
  if (!tok) return invalidToken(res);
  res.status(204).end();
}));

app.post('/authserver/invalidate', yggAuthLimiter, wrap(async (req, res) => {
  const { accessToken } = req.body || {};
  if (typeof accessToken === 'string' && /^[a-f0-9]{32}$/.test(accessToken)) {
    await supabase.from('tokens').delete().eq('access_token', accessToken);
  }
  res.status(204).end();
}));

app.post('/authserver/signout', yggAuthLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return invalidCredentials(res);
  const found = await findAccountByLogin(username, true);
  const result = await verifyPassword(password, found && found.acc.password_hash);
  if (!found || !result.ok) return invalidCredentials(res);
  await supabase.from('tokens').delete().eq('account_id', String(found.acc.id));
  res.status(204).end();
}));

// Server join handshake. NOTE: kept in memory (30s TTL) - use a shared store if you run multiple instances.
const joinSessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of joinSessions) if (v.expires < now) joinSessions.delete(k);
}, 30 * 1000).unref();

app.post('/sessionserver/session/minecraft/join', sessionLimiter, wrap(async (req, res) => {
  const { accessToken, selectedProfile, serverId } = req.body || {};
  if (typeof selectedProfile !== 'string' || typeof serverId !== 'string' || serverId.length > 128) {
    return yggError(res, 400, 'IllegalArgumentException', 'Invalid request.');
  }
  const tok = await getValidToken(accessToken);
  if (!tok) return invalidToken(res);

  const uuid = selectedProfile.replace(/-/g, '').toLowerCase();
  const { data: p } = await supabase.from('profiles').select('*').eq('offline_uuid', uuid).maybeSingle();
  if (!p || String(p.account_id) !== String(tok.account_id) || (tok.profile_id && String(tok.profile_id) !== String(p.id))) {
    return invalidToken(res);
  }
  joinSessions.set(serverId + ':' + p.mc_username.toLowerCase(), { expires: Date.now() + 30 * 1000 });
  res.status(204).end();
}));

app.get('/sessionserver/session/minecraft/hasJoined', sessionLimiter, wrap(async (req, res) => {
  const username = String(req.query.username || '');
  const serverId = String(req.query.serverId || '');
  if (!RE_MC_NAME.test(username) || !serverId) return res.status(204).end();

  const key = serverId + ':' + username.toLowerCase();
  const entry = joinSessions.get(key);
  if (!entry || entry.expires < Date.now()) return res.status(204).end();
  joinSessions.delete(key);

  const { data: p } = await supabase.from('profiles').select('*').ilike('mc_username', escapeLike(username)).maybeSingle();
  if (!p) return res.status(204).end();
  res.json(buildProfileResponse(p));
}));

app.get('/sessionserver/session/minecraft/profile/:uuid', sessionLimiter, wrap(async (req, res) => {
  const uuid = String(req.params.uuid).replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(uuid)) return res.status(204).end();
  const { data: p } = await supabase.from('profiles').select('*').eq('offline_uuid', uuid).maybeSingle();
  if (!p) return res.status(204).end();
  res.json(buildProfileResponse(p));
}));

// Batch name -> profile lookup
app.post('/api/profiles/minecraft', sessionLimiter, wrap(async (req, res) => {
  const names = Array.isArray(req.body) ? req.body : [];
  const wanted = [...new Set(names.filter((n) => typeof n === 'string' && RE_MC_NAME.test(n)).map((n) => n.toLowerCase()))].slice(0, 100);
  if (wanted.length === 0) return res.json([]);

  const found = [];
  for (const name of wanted) {
    const { data: p } = await supabase.from('profiles').select('mc_username, offline_uuid').ilike('mc_username', escapeLike(name)).maybeSingle();
    if (p) found.push(toYggProfile(p));
  }
  res.json(found);
}));

/* =====================================================================
   8. ERROR HANDLING & STARTUP
   ===================================================================== */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).send(err.message);
  console.error('Unhandled error:', err);
  res.status(500).send('Internal server error');
});

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

// Backfill offline_uuid for profiles created before this column existed
async function backfillOfflineUuids() {
  try {
    for (let i = 0; i < 100; i++) {
      const { data, error } = await supabase.from('profiles').select('id, mc_username').is('offline_uuid', null).limit(200);
      if (error) throw error;
      if (!data || data.length === 0) return;
      for (const p of data) {
        await supabase.from('profiles').update({ offline_uuid: getOfflineUUID(p.mc_username) }).eq('id', p.id);
      }
    }
  } catch (e) {
    console.warn('[startup] offline_uuid backfill skipped - did you run the SQL migration? (' + e.message + ')');
  }
}

async function pruneExpiredTokens() {
  try {
    const cutoff = new Date(Date.now() - TOKEN_TTL_MS).toISOString();
    await supabase.from('tokens').delete().lt('created_at', cutoff);
  } catch (e) { /* table may not exist yet */ }
}

app.listen(PORT, () => {
  console.log('AksuLauncher Multi-Profile & APK Server active on port ' + PORT);
  backfillOfflineUuids();
  pruneExpiredTokens();
  setInterval(pruneExpiredTokens, 60 * 60 * 1000).unref();
});
