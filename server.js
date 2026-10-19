const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Supabase Administrative Connection
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rtfuamnwfrtyitxbakrl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0ZnVhbW53ZnJ0eWl0eGJha3JsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjMzNjQ4OCwiZXhwIjoyMTA3OTEyNDg4fQ.HHd9Z51aFBmqBRZ8TPQEb7Y_XqgwpQRlkEm7ENvVbBM';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'ue0qjmbk',
  api_key: process.env.CLOUDINARY_API_KEY || '464384322119385',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'xb0hUD0kVB8GtwydDWS7QAp17bY',
  secure: true
});

// RSA Keypair for Yggdrasil / authlib-injector
if (!fs.existsSync('keys')) fs.mkdirSync('keys');
if (!fs.existsSync('keys/private.pem')) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.writeFileSync('keys/public.pem', publicKey);
  fs.writeFileSync('keys/private.pem', privateKey);
}

const privateKey = fs.readFileSync('keys/private.pem', 'utf8');
const publicKey = fs.readFileSync('keys/public.pem', 'utf8');

// Allow up to 150MB for APK uploads in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'aksu_session',
  keys: ['aksu-permanent-secret-auth-key-2026'],
  maxAge: 60 * 24 * 60 * 60 * 1000
}));

function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass).digest('hex');
}

function getOfflineUUID(username) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

function uploadToCloudinary(buffer, publicId, folder, resourceType = 'image', format = 'png') {
  return new Promise((resolve, reject) => {
    const opts = {
      folder,
      public_id: publicId,
      overwrite: true,
      resource_type: resourceType
    };
    if (format) opts.format = format;

    const stream = cloudinary.uploader.upload_stream(opts, (error, result) => {
      if (error) return reject(error);
      resolve(result.secure_url);
    });
    stream.end(buffer);
  });
}

function renderLayout(title, content, session = {}) {
  const activeAccount = session.accountName || null;
  const isAdmin = session.isAdmin || false;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | AksuLauncher</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/skinview3d@3.0.1/bundles/skinview3d.bundle.js"></script>
    <style>
      :root {
        --bg-deep: #07090e;
        --bg-card: rgba(20, 25, 38, 0.78);
        --border: #232a3d;
        --accent: #3b82f6;
        --accent-hover: #2563eb;
        --accent-glow: rgba(59, 130, 246, 0.4);
        --danger: #ef4444;
        --success: #10b981;
        --text: #f8fafc;
        --text-muted: #94a3b8;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
      body {
        background-color: var(--bg-deep);
        color: var(--text);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background-image: 
          radial-gradient(circle at 15% 20%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
          radial-gradient(circle at 85% 65%, rgba(139, 92, 246, 0.08) 0%, transparent 40%);
        background-attachment: fixed;
      }
      nav {
        background: rgba(13, 17, 26, 0.85);
        backdrop-filter: blur(16px);
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 32px;
        position: sticky;
        top: 0;
        z-index: 100;
        flex-wrap: wrap;
        gap: 12px;
      }
      .brand { display: flex; align-items: center; gap: 10px; font-size: 1.25rem; font-weight: 800; color: #fff; text-decoration: none; }
      .brand img { width: 32px; height: 32px; }
      .brand span { color: var(--accent); }
      .nav-links { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
      .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.92rem; font-weight: 600; transition: color 0.2s; }
      .nav-links a:hover { color: #fff; }
      .badge-admin { background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #fbbf24; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 800; }
      
      .btn {
        background: var(--accent);
        color: #fff;
        padding: 11px 22px;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 700;
        font-size: 0.92rem;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-shadow: 0 4px 16px var(--accent-glow);
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
      <a href="/" class="brand">
        <img src="https://raw.githubusercontent.com/PrismLauncher/PrismLauncher/develop/launcher/resources/multimc/scalable/multimc.svg" alt="Logo">
        AKSU<span>LAUNCHER</span>
      </a>
      <div class="nav-links">
        <a href="/">Home</a>
        <a href="/downloads">Download APK</a>
        ${activeAccount 
          ? `<a href="/dashboard">Wardrobe & Usernames</a>
             ${isAdmin ? `<span class="badge-admin">★ ADMIN</span>` : ''}
             <a href="/logout" style="color:#f87171;">Log Out (${activeAccount})</a>` 
          : `<a href="/auth" class="btn" style="padding: 8px 18px;">Sign In / Register</a>`}
      </div>
    </nav>
    <div class="container">${content}</div>
    <div id="toast"></div>
    <footer>&copy; 2026 AksuLauncher &bull; Multi-Profile Cloud & Direct APK Distribution</footer>
    <script>
      function showToast(msg, type = 'info') {
        const t = document.getElementById('toast');
        t.className = type;
        t.innerHTML = (type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : 'ℹ ') + msg;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 4000);
      }
    </script>
  </body>
  </html>`;
}

// 1. Landing Page & Yggdrasil Root Metadata
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      meta: { serverName: "AksuSkinServer", implementationName: "AksuSkinServer", implementationVersion: "3.0.0" },
      skinDomains: [req.get('host'), 'res.cloudinary.com', new URL(SUPABASE_URL).hostname],
      signaturePublickey: publicKey
    });
  }

  const content = `
    <div style="text-align: center; padding: 50px 0 40px;">
      <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; padding: 6px 16px; border-radius: 30px; font-size: 0.85rem; font-weight: 700; margin-bottom: 20px;">
        ⚡ Multi-Username Account System & Direct APK Hosting
      </div>
      <h1 style="font-size: 3.2rem; font-weight: 800; margin-bottom: 18px; letter-spacing: -1px; line-height: 1.15;">
        One Account. Multiple Usernames.<br>
        <span style="background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          Full 3D Skins, Capes & Elytras.
        </span>
      </h1>
      <p style="color: var(--text-muted); font-size: 1.15rem; max-width: 660px; margin: 0 auto 32px; line-height: 1.6;">
        Claim and manage multiple Minecraft usernames under one master account, customize each profile in 3D, and download the official AksuLauncher APK directly.
      </p>
      <div style="display: flex; justify-content: center; gap: 16px; flex-wrap: wrap;">
        <a href="/downloads" class="btn" style="padding: 14px 30px; font-size: 1rem;">📥 Direct APK Download</a>
        <a href="/dashboard" class="btn btn-secondary" style="padding: 14px 30px; font-size: 1rem;">🎨 Manage My Usernames</a>
      </div>
    </div>
  `;
  res.send(renderLayout('Home', content, req.session));
});

// 2. Direct APK Download Center + Admin Upload Panel
app.get('/downloads', async (req, res) => {
  const { data: releases } = await supabase.from('releases').select('*').order('created_at', { ascending: false });
  const latest = releases && releases.length > 0 ? releases[0] : null;
  const isAdmin = req.session && req.session.isAdmin;

  const adminUploadHtml = isAdmin ? `
    <div class="card" style="margin-bottom: 28px; border-color: #f59e0b;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
        <h3 style="font-size: 1.25rem; color: #fbbf24;">★ Admin APK Publisher (AKSU1501 Only)</h3>
        <span class="badge-admin">ADMIN MODE</span>
      </div>
      <form id="apkUploadForm">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px;">
          <div>
            <label>Version Name (e.g., v3.2.0-stable)</label>
            <input type="text" name="version" required placeholder="v3.2.0">
          </div>
          <div>
            <label>Select Compiled .APK File</label>
            <input type="file" name="apk" accept=".apk" required style="padding: 9px;">
          </div>
        </div>
        <div style="margin-bottom: 14px;">
          <label>Release Notes / Changelog</label>
          <textarea name="notes" rows="2" placeholder="Added custom Elytra physics, updated OpenJDK 17..."></textarea>
        </div>
        <div style="margin-bottom: 16px;">
          <label>Or Paste Direct APK Link (Optional if uploading file above)</label>
          <input type="url" name="direct_url" placeholder="https://...">
        </div>
        <button type="submit" id="apkBtn" class="btn" style="background:#f59e0b; color:#000; width:100%;">🚀 Publish Official APK Release</button>
      </form>
    </div>
    <script>
      document.getElementById('apkUploadForm')?.addEventListener('submit', function(e) {
        e.preventDefault();
        const btn = document.getElementById('apkBtn');
        btn.disabled = true;
        btn.innerText = 'Uploading APK to Cloud Storage... Please wait...';
        const fd = new FormData(this);
        fetch('/admin/upload-apk', { method: 'POST', body: fd })
          .then(async r => {
            if (!r.ok) throw new Error(await r.text());
            showToast('APK Published Successfully!', 'success');
            setTimeout(() => location.reload(), 1200);
          })
          .catch(err => {
            showToast('Error: ' + err.message, 'error');
            btn.disabled = false;
            btn.innerText = '🚀 Publish Official APK Release';
          });
      });
    </script>
  ` : '';

  const releasesListHtml = (releases && releases.length > 0) ? releases.map((rel, idx) => `
    <div class="card" style="margin-bottom: 16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
      <div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-weight:800; font-size:1.25rem;">AksuLauncher ${rel.version}</span>
          ${idx === 0 ? `<span style="background:rgba(16,185,129,0.15); color:#34d399; padding:3px 10px; border-radius:20px; font-size:0.75rem; font-weight:700;">LATEST</span>` : ''}
        </div>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-top:6px;">${rel.notes || 'Official Android build with integrated custom cosmetics.'}</p>
        <div style="font-size:0.75rem; color:#64748b; margin-top:6px;">Published on ${new Date(rel.created_at).toLocaleDateString()} by ${rel.uploaded_by || 'AKSU1501'}</div>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <a href="${rel.apk_url}" download="AksuLauncher-${rel.version}.apk" class="btn">📥 Download APK</a>
        ${isAdmin ? `<button onclick="deleteRelease('${rel.id}')" class="btn btn-danger" style="padding:11px 14px;">🗑</button>` : ''}
      </div>
    </div>
  `).join('') : `
    <div class="card" style="text-align:center; padding: 48px 20px;">
      <h3 style="margin-bottom:8px;">No APK Uploaded Yet</h3>
      <p style="color:var(--text-muted); font-size:0.95rem;">The administrator (AKSU1501) has not published an APK build yet. Check back soon!</p>
    </div>
  `;

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
      async function deleteRelease(id) {
        if (!confirm('Delete this APK release?')) return;
        const r = await fetch('/admin/delete-apk/' + id, { method: 'DELETE' });
        if (r.ok) location.reload();
      }
    </script>
  `;
  res.send(renderLayout('Download APK', content, req.session));
});

// Admin APK Upload Endpoint
app.post('/admin/upload-apk', upload.single('apk'), async (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.status(403).send('Admin access only');

  const version = (req.body.version || 'v1.0').trim();
  const notes = (req.body.notes || '').trim();
  let apkUrl = (req.body.direct_url || '').trim();

  try {
    if (req.file) {
      const publicId = `AksuLauncher_${version.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.apk`;
      apkUrl = await uploadToCloudinary(req.file.buffer, publicId, 'aksu_apks', 'raw', null);
    }
    if (!apkUrl) return res.status(400).send('Please provide an APK file or direct URL');

    const { error } = await supabase.from('releases').insert({
      version,
      notes,
      apk_url: apkUrl,
      uploaded_by: req.session.accountName
    });
    if (error) throw error;
    res.status(200).send('OK');
  } catch (err) {
    console.error('APK Upload Error:', err);
    res.status(500).send(err.message);
  }
});

app.delete('/admin/delete-apk/:id', async (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.status(403).send('Unauthorized');
  await supabase.from('releases').delete().eq('id', req.params.id);
  res.status(200).send('OK');
});

// 3. Master Account Auth Page
app.get('/auth', (req, res) => {
  if (req.session && req.session.accountId) return res.redirect('/dashboard');

  const content = `
    <div style="max-width: 460px; margin: 24px auto 0;">
      <div class="card" id="loginBox">
        <h2 style="font-size: 1.7rem; font-weight: 800; text-align:center; margin-bottom:6px;">Sign In</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; text-align:center; margin-bottom: 24px;">Access your account and all claimed Minecraft usernames.</p>
        <form action="/login" method="post">
          <div style="margin-bottom: 16px;">
            <label>Account Name or Email</label>
            <input type="text" name="login_id" required placeholder="e.g. AKSU1501">
          </div>
          <div style="margin-bottom: 24px;">
            <label>Password</label>
            <input type="password" name="password" required>
          </div>
          <button type="submit" class="btn" style="width:100%;">Sign In to Account</button>
        </form>
        <div style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: var(--text-muted);">
          New player? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; font-weight: 700;">Create a Master Account</a>
        </div>
      </div>

      <div class="card" id="registerBox" style="display: none;">
        <h2 style="font-size: 1.7rem; font-weight: 800; text-align:center; margin-bottom:6px;">Create Master Account</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; text-align:center; margin-bottom: 24px;">One account lets you claim & manage multiple in-game usernames.</p>
        <form action="/register" method="post">
          <div style="margin-bottom: 14px;">
            <label>Master Account Name</label>
            <input type="text" name="account_name" required placeholder="e.g. AKSU1501">
          </div>
          <div style="margin-bottom: 14px;">
            <label>First Minecraft In-Game Username (Optional, can add more later)</label>
            <input type="text" name="first_mc_username" placeholder="e.g. AksuPro">
          </div>
          <div style="margin-bottom: 14px;">
            <label>Email Address</label>
            <input type="email" name="email" required placeholder="you@example.com">
          </div>
          <div style="margin-bottom: 22px;">
            <label>Password</label>
            <input type="password" name="password" required>
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
        const l = document.getElementById('loginBox');
        const r = document.getElementById('registerBox');
        l.style.display = l.style.display === 'none' ? 'block' : 'none';
        r.style.display = r.style.display === 'none' ? 'block' : 'none';
      }
    </script>
  `;
  res.send(renderLayout('Sign In', content, req.session));
});

app.post('/register', async (req, res) => {
  const accountName = (req.body.account_name || '').trim();
  const firstMc = (req.body.first_mc_username || accountName).trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password;

  if (!accountName || !email || !password) return res.redirect('/auth');

  const isAdmin = accountName.toUpperCase() === 'AKSU1501';

  const { data: acc, error } = await supabase.from('accounts').insert({
    account_name: accountName,
    email,
    password_hash: hashPassword(password),
    is_admin: isAdmin
  }).select().single();

  if (error) {
    return res.send(renderLayout('Error', `<div class="card" style="text-align:center;"><h3>Registration Error</h3><p style="margin:12px 0; color:var(--text-muted);">${error.message}</p><a href="/auth" class="btn">Back</a></div>`));
  }

  if (firstMc) {
    await supabase.from('profiles').insert({
      account_id: acc.id,
      mc_username: firstMc
    });
  }

  req.session.accountId = acc.id;
  req.session.accountName = acc.account_name;
  req.session.isAdmin = acc.is_admin;
  res.redirect('/dashboard');
});

app.post('/login', async (req, res) => {
  const loginId = (req.body.login_id || '').trim();
  const password = req.body.password;

  const { data: acc } = await supabase
    .from('accounts')
    .select('*')
    .or(`account_name.ilike.${loginId},email.ilike.${loginId}`)
    .maybeSingle();

  if (!acc || acc.password_hash !== hashPassword(password)) {
    return res.send(renderLayout('Error', `<div class="card" style="text-align:center;"><h3>Invalid Credentials</h3><p style="margin:14px 0;"><a href="/auth" class="btn">Try Again</a></p></div>`));
  }

  const isAdmin = acc.is_admin || acc.account_name.toUpperCase() === 'AKSU1501';
  req.session.accountId = acc.id;
  req.session.accountName = acc.account_name;
  req.session.isAdmin = isAdmin;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// 4. Multi-Username Dashboard & 3D Studio
app.get('/dashboard', async (req, res) => {
  if (!req.session || !req.session.accountId) return res.redirect('/auth');

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .eq('account_id', req.session.accountId)
    .order('created_at', { ascending: true });

  const list = profiles || [];
  const selectedId = req.query.profile || (list[0] ? list[0].id : null);
  const activeProfile = list.find(p => p.id === selectedId) || list[0] || null;

  const skinUrl = activeProfile && activeProfile.skin_url ? activeProfile.skin_url : '';
  const capeUrl = activeProfile && activeProfile.cape_url ? activeProfile.cape_url : '';
  const modelType = activeProfile && activeProfile.model === 'slim' ? 'slim' : 'default';

  const profilesSidebarHtml = list.map(p => {
    const isSel = activeProfile && p.id === activeProfile.id;
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:12px; border:1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}; background:${isSel ? 'rgba(59,130,246,0.12)' : '#0c0f17'}; margin-bottom:10px;">
        <a href="/dashboard?profile=${p.id}" style="color:#fff; text-decoration:none; font-weight:700; flex:1;">
          🎮 ${p.mc_username}
          <span style="display:block; font-size:0.72rem; color:var(--text-muted); font-weight:500;">
            ${p.skin_url ? 'Custom Skin' : 'Default Skin'} &bull; ${p.cape_url ? 'Cape Equipped' : 'No Cape'}
          </span>
        </a>
        <button onclick="deleteProfile('${p.id}', '${p.mc_username}')" class="btn btn-danger" style="padding:6px 10px; font-size:0.75rem;" title="Release/Delete Username">🗑</button>
      </div>
    `;
  }).join('');

  const studioEditorHtml = activeProfile ? `
    <div class="studio-grid">
      <!-- 3D Viewer -->
      <div class="viewer-box">
        <div class="view-selector-bar">
          <button type="button" class="view-tab active" onclick="switchView('full', event)">Full Player</button>
          <button type="button" class="view-tab" onclick="switchView('skin', event)">Skin Only</button>
          <button type="button" class="view-tab" onclick="switchView('cape', event)">Cape 3D</button>
          <button type="button" class="view-tab" onclick="switchView('elytra', event)">Elytra 3D</button>
        </div>
        <canvas id="skin_container"></canvas>
        <div class="viewer-controls">
          <button type="button" class="pill-btn active" id="btnAnim" onclick="toggleAnimation()">Walk: ON</button>
          <button type="button" class="pill-btn" onclick="resetCamera()">Reset Camera</button>
        </div>
      </div>

      <!-- Cosmetics Controls for Selected Username -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid var(--border); padding-bottom:12px;">
          <div>
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">EDITING USERNAME</span>
            <h3 style="font-size:1.4rem; font-weight:800; color:#60a5fa;">${activeProfile.mc_username}</h3>
          </div>
          <button type="button" onclick="renameProfile('${activeProfile.id}', '${activeProfile.mc_username}')" class="btn btn-secondary" style="padding:7px 12px; font-size:0.8rem;">✏ Rename</button>
        </div>

        <form id="cosmeticsForm">
          <input type="hidden" name="profile_id" value="${activeProfile.id}">

          <label>Arm Geometry Model</label>
          <select id="modelSelector" name="model" style="margin-bottom:16px;">
            <option value="default" ${modelType === 'default' ? 'selected' : ''}>Classic 4-pixel (Steve)</option>
            <option value="slim" ${modelType === 'slim' ? 'selected' : ''}>Slim 3-pixel (Alex)</option>
          </select>

          <label>Skin Texture (.png)</label>
          <div class="file-dropzone" id="skinDropZone" ondragover="event.preventDefault(); this.style.borderColor='var(--accent)';" ondragleave="this.style.borderColor='var(--border)';" ondrop="handleDrop(event, 'skinInput', 'skinLabel')">
            <div id="skinLabel" style="font-weight:700; pointer-events:none;">${skinUrl ? '✓ Custom Skin Active (Tap or Drop Here)' : 'Tap or Drag & Drop Skin PNG'}</div>
            <input type="file" id="skinInput" name="skin" accept="image/*,.png" style="display:none;">
          </div>
          ${skinUrl ? `<button type="button" onclick="clearAsset('${activeProfile.id}', 'skin')" class="btn btn-danger" style="width:100%; margin-top:8px; padding:8px; font-size:0.8rem;">Remove Custom Skin</button>` : ''}

          <label style="margin-top:16px;">Cape & Elytra (.png)</label>
          <div class="file-dropzone" id="capeDropZone" ondragover="event.preventDefault(); this.style.borderColor='var(--accent)';" ondragleave="this.style.borderColor='var(--border)';" ondrop="handleDrop(event, 'capeInput', 'capeLabel')">
            <div id="capeLabel" style="font-weight:700; pointer-events:none;">${capeUrl ? '✓ Custom Cape Active (Tap or Drop Here)' : 'Tap or Drag & Drop Cape PNG'}</div>
            <input type="file" id="capeInput" name="cape" accept="image/*,.png" style="display:none;">
          </div>
          ${capeUrl ? `<button type="button" onclick="clearAsset('${activeProfile.id}', 'cape')" class="btn btn-danger" style="width:100%; margin-top:8px; padding:8px; font-size:0.8rem;">Remove Custom Cape</button>` : ''}

          <button type="submit" id="saveBtn" class="btn" style="width:100%; margin-top:22px; padding:14px;">💾 Save Changes to Cloud</button>
        </form>
      </div>
    </div>
  ` : `
    <div class="card" style="text-align:center; padding:48px 20px;">
      <h3>No Minecraft Usernames Claimed Yet</h3>
      <p style="color:var(--text-muted); margin-top:8px;">Use the panel on the left to claim your first in-game username!</p>
    </div>
  `;

  const content = `
    <style>
      .dashboard-layout { display: grid; grid-template-columns: 310px 1fr; gap: 24px; align-items: start; }
      .studio-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 24px; }
      @media(max-width: 960px) { .dashboard-layout, .studio-grid { grid-template-columns: 1fr; } }
      .viewer-box { background: radial-gradient(circle, #161c2e 0%, #090c14 100%); border: 1px solid var(--border); border-radius: 20px; position: relative; min-height: 500px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .view-selector-bar { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; gap: 6px; background: rgba(13, 17, 26, 0.85); padding: 6px; border-radius: 12px; border: 1px solid var(--border); z-index: 10; }
      .view-tab { flex: 1; background: transparent; border: none; color: var(--text-muted); padding: 8px; border-radius: 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
      .view-tab.active { background: var(--accent); color: #fff; }
      .viewer-controls { position: absolute; bottom: 14px; display: flex; gap: 8px; z-index: 10; }
      .pill-btn { background: rgba(20, 25, 38, 0.85); border: 1px solid var(--border); color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
      .pill-btn.active { background: var(--accent); border-color: var(--accent); }
      .file-dropzone { border: 2px dashed var(--border); border-radius: 12px; padding: 16px; text-align: center; cursor: pointer; background: rgba(11, 14, 22, 0.6); transition: border-color 0.2s; }
      .file-dropzone:hover { border-color: var(--accent); }
    </style>

    <div class="dashboard-layout">
      <!-- Left Sidebar: Claimed Usernames List & Add New -->
      <div class="card" style="padding: 22px;">
        <h3 style="font-size: 1.15rem; font-weight: 800; margin-bottom: 4px;">My Usernames (${list.length})</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px;">Select a username to customize its 3D skin & cape.</p>
        
        ${profilesSidebarHtml}

        <form id="addProfileForm" style="margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border);">
          <label>Claim Another Username</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="newMcName" required placeholder="New username...">
            <button type="submit" class="btn" style="padding: 0 16px;">+ Add</button>
          </div>
        </form>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
          <button onclick="deleteEntireAccount()" class="btn btn-danger" style="width:100%; font-size:0.8rem; padding:9px;">⚠ Delete Entire Account</button>
        </div>
      </div>

      <!-- Right Area: 3D Studio for Active Username -->
      <div>${studioEditorHtml}</div>
    </div>

    <script>
      document.getElementById('addProfileForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const mc_username = document.getElementById('newMcName').value.trim();
        if (!mc_username) return;
        const r = await fetch('/api/profiles/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mc_username })
        });
        if (r.ok) {
          const data = await r.json();
          location.href = '/dashboard?profile=' + data.id;
        } else {
          showToast(await r.text(), 'error');
        }
      });

      async function deleteProfile(id, name) {
        if (!confirm('Release and delete username "' + name + '"?')) return;
        const r = await fetch('/api/profiles/' + id, { method: 'DELETE' });
        if (r.ok) location.href = '/dashboard';
      }

      async function renameProfile(id, oldName) {
        const newName = prompt('Enter new Minecraft username:', oldName);
        if (!newName || newName.trim() === oldName) return;
        const r = await fetch('/api/profiles/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_id: id, new_name: newName.trim() })
        });
        if (r.ok) location.reload();
        else showToast(await r.text(), 'error');
      }

      async function clearAsset(profileId, type) {
        if (!confirm('Remove custom ' + type + ' from this username?')) return;
        const r = await fetch('/api/profiles/clear-asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_id: profileId, type })
        });
        if (r.ok) location.reload();
      }

      async function deleteEntireAccount() {
        if (!confirm('Are you sure? This will permanently delete your master account and ALL claimed usernames!')) return;
        const r = await fetch('/api/account', { method: 'DELETE' });
        if (r.ok) location.href = '/';
      }

      function handleDrop(e, inputId, labelId) {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          const input = document.getElementById(inputId);
          input.files = files;
          const event = new Event('change', { bubbles: true });
          input.dispatchEvent(event);
        }
      }

      const canvas = document.getElementById("skin_container");
      if (canvas) {
        const defaultSkin = "https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f0f6fa9ff2cf93ae9cf745fca20ba5979f8a6";
        let activeSkinUrl = "${skinUrl}" || defaultSkin;
        let activeCapeUrl = "${capeUrl}";
        let currentMode = "full";

        const skinViewer = new skinview3d.SkinViewer({
          canvas, width: 310, height: 430, skin: activeSkinUrl
        });

        let walkAnim = skinViewer.animations.add(skinview3d.WalkingAnimation);
        let isWalking = true;

        if (activeCapeUrl) skinViewer.loadCape(activeCapeUrl, { backEquipment: 'cape' });

        window.setPlayerBodyVisibility = (vis) => {
          if (skinViewer.playerObject && skinViewer.playerObject.skin) {
            skinViewer.playerObject.skin.visible = vis;
          }
        };

        window.switchView = (mode, evt) => {
          currentMode = mode;
          document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
          if (evt && evt.target) evt.target.classList.add('active');

          if (mode === 'full') {
            setPlayerBodyVisibility(true);
            if (activeCapeUrl) skinViewer.loadCape(activeCapeUrl, { backEquipment: 'cape' });
            resetCamera();
          } else if (mode === 'skin') {
            setPlayerBodyVisibility(true);
            skinViewer.loadCape(null);
            resetCamera();
          } else if (mode === 'cape') {
            setPlayerBodyVisibility(false);
            skinViewer.loadCape(activeCapeUrl || defaultSkin, { backEquipment: 'cape' });
            skinViewer.camera.position.set(0, 0, -55);
            skinViewer.controls.reset();
          } else if (mode === 'elytra') {
            setPlayerBodyVisibility(false);
            skinViewer.loadCape(activeCapeUrl || defaultSkin, { backEquipment: 'elytra' });
            skinViewer.camera.position.set(25, 10, -55);
            skinViewer.controls.reset();
          }
        };

        window.toggleAnimation = () => {
          const btn = document.getElementById('btnAnim');
          isWalking = !isWalking;
          walkAnim.paused = !isWalking;
          btn.innerText = isWalking ? 'Walk: ON' : 'Walk: OFF';
          btn.classList.toggle('active', isWalking);
        };

        window.resetCamera = () => {
          skinViewer.camera.position.set(0, 0, 60);
          skinViewer.controls.reset();
        };

        document.getElementById('modelSelector')?.addEventListener('change', (e) => {
          skinViewer.loadSkin(skinViewer.skinUrl, { model: e.target.value });
        });

        document.getElementById('skinDropZone')?.addEventListener('click', () => {
          document.getElementById('skinInput').click();
        });

        document.getElementById('capeDropZone')?.addEventListener('click', () => {
          document.getElementById('capeInput').click();
        });

        document.getElementById('skinInput')?.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            activeSkinUrl = ev.target.result;
            skinViewer.loadSkin(activeSkinUrl, { model: document.getElementById('modelSelector').value });
            setPlayerBodyVisibility(true);
            document.getElementById('skinLabel').innerText = 'Selected: ' + file.name;
            showToast('Previewing new skin in 3D!', 'info');
          };
          reader.readAsDataURL(file);
        });

        document.getElementById('capeInput')?.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            activeCapeUrl = ev.target.result;
            skinViewer.loadCape(activeCapeUrl, { backEquipment: currentMode === 'elytra' ? 'elytra' : 'cape' });
            document.getElementById('capeLabel').innerText = 'Selected: ' + file.name;
            showToast('Previewing new cape/elytra in 3D!', 'info');
          };
          reader.readAsDataURL(file);
        });

        document.getElementById('cosmeticsForm')?.addEventListener('submit', function(e) {
          e.preventDefault();
          const btn = document.getElementById('saveBtn');
          btn.disabled = true;
          btn.innerText = 'Saving to Cloud...';
          fetch('/upload', { method: 'POST', body: new FormData(this) })
            .then(async r => {
              if (!r.ok) throw new Error(await r.text());
              showToast('Saved & synced to username!', 'success');
              setTimeout(() => location.reload(), 1000);
            })
            .catch(err => {
              showToast(err.message, 'error');
              btn.disabled = false;
              btn.innerText = '💾 Save Changes to Cloud';
            });
        });
      }
    </script>
  `;
  res.send(renderLayout('Wardrobe & Usernames', content, req.session));
});

// 5. Profile & Account Management APIs
app.post('/api/profiles/add', async (req, res) => {
  if (!req.session || !req.session.accountId) return res.status(401).send('Unauthorized');
  const mc_username = (req.body.mc_username || '').trim();
  if (!mc_username) return res.status(400).send('Username required');

  const { data: exists } = await supabase.from('profiles').select('id').ilike('mc_username', mc_username).maybeSingle();
  if (exists) return res.status(400).send('Username is already claimed by a player');

  const { data, error } = await supabase.from('profiles').insert({
    account_id: req.session.accountId,
    mc_username
  }).select().single();

  if (error) return res.status(500).send(error.message);
  res.json(data);
});

app.post('/api/profiles/rename', async (req, res) => {
  if (!req.session || !req.session.accountId) return res.status(401).send('Unauthorized');
  const { profile_id, new_name } = req.body;

  const { data: taken } = await supabase.from('profiles').select('id').ilike('mc_username', new_name).maybeSingle();
  if (taken) return res.status(400).send('That username is already taken');

  const { error } = await supabase.from('profiles')
    .update({ mc_username: new_name })
    .eq('id', profile_id)
    .eq('account_id', req.session.accountId);

  if (error) return res.status(500).send(error.message);
  res.send('OK');
});

app.post('/api/profiles/clear-asset', async (req, res) => {
  if (!req.session || !req.session.accountId) return res.status(401).send('Unauthorized');
  const { profile_id, type } = req.body;
  const updates = type === 'skin' ? { skin_url: '' } : { cape_url: '' };

  await supabase.from('profiles').update(updates).eq('id', profile_id).eq('account_id', req.session.accountId);
  res.send('OK');
});

app.delete('/api/profiles/:id', async (req, res) => {
  if (!req.session || !req.session.accountId) return res.status(401).send('Unauthorized');
  await supabase.from('profiles').delete().eq('id', req.params.id).eq('account_id', req.session.accountId);
  res.send('OK');
});

app.delete('/api/account', async (req, res) => {
  if (!req.session || !req.session.accountId) return res.status(401).send('Unauthorized');
  await supabase.from('accounts').delete().eq('id', req.session.accountId);
  req.session = null;
  res.send('OK');
});

// 6. Upload Cosmetics for a Specific Username Profile
app.post('/upload', upload.fields([{ name: 'skin', maxCount: 1 }, { name: 'cape', maxCount: 1 }]), async (req, res) => {
  if (!req.session || !req.session.accountId) return res.status(401).send('Unauthorized');

  const profileId = req.body.profile_id;
  const model = req.body.model === 'slim' ? 'slim' : 'default';
  const updates = { model };

  try {
    const { data: prof } = await supabase.from('profiles')
      .select('*')
      .eq('id', profileId)
      .eq('account_id', req.session.accountId)
      .single();

    if (!prof) return res.status(403).send('Profile not found');

    if (req.files && req.files['skin'] && req.files['skin'][0]) {
      const file = req.files['skin'][0];
      const publicId = `${prof.mc_username.toLowerCase()}_skin_${Date.now()}`;
      updates.skin_url = await uploadToCloudinary(file.buffer, publicId, 'aksu_skins', 'image', 'png');
    }

    if (req.files && req.files['cape'] && req.files['cape'][0]) {
      const file = req.files['cape'][0];
      const publicId = `${prof.mc_username.toLowerCase()}_cape_${Date.now()}`;
      updates.cape_url = await uploadToCloudinary(file.buffer, publicId, 'aksu_capes', 'image', 'png');
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', profileId);
    if (error) throw error;

    res.status(200).send('OK');
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).send(err.message);
  }
});

// 7. Yggdrasil Session Profile Endpoint for AksuLauncher
app.get('/sessionserver/session/minecraft/profile/:uuid', async (req, res) => {
  const uuid = req.params.uuid.replace(/-/g, '').toLowerCase();

  const { data: profiles } = await supabase.from('profiles').select('*');
  if (!profiles) return res.status(204).end();

  const matched = profiles.find(p => getOfflineUUID(p.mc_username) === uuid);
  if (!matched || (!matched.skin_url && !matched.cape_url)) {
    return res.status(204).end();
  }

  const textures = {};
  if (matched.skin_url) {
    textures.SKIN = { url: matched.skin_url };
    if (matched.model === 'slim') textures.SKIN.metadata = { model: 'slim' };
  }
  if (matched.cape_url) {
    textures.CAPE = { url: matched.cape_url };
  }

  const textureData = {
    timestamp: Date.now(),
    profileId: uuid,
    profileName: matched.mc_username,
    textures
  };

  const base64Textures = Buffer.from(JSON.stringify(textureData)).toString('base64');
  const signer = crypto.createSign('SHA1');
  signer.update(base64Textures);
  const signature = signer.sign(privateKey, 'base64');

  res.json({
    id: uuid,
    name: matched.mc_username,
    properties: [{ name: 'textures', value: base64Textures, signature }]
  });
});

app.listen(PORT, () => console.log(`AksuLauncher Multi-Profile & APK Server active on port ${PORT}`));
