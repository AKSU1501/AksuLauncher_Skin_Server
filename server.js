const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Direct Supabase Connection
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rtfuamnwfrtyitxbakrl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0ZnVhbW53ZnJ0eWl0eGJha3JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzY0ODgsImV4cCI6MjEwNzkxMjQ4OH0.treB5Pf3sA_07z5v20RnZXz5flHWdNg3RrpbR_sQEIY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// RSA Keypair setup
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

const upload = multer({ storage: multer.memoryStorage() });

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

function renderLayout(title, content, activeUser = null) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | AksuLauncher Studio</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/skinview3d@3.0.1/bundles/skinview3d.bundle.js"></script>
    <style>
      :root {
        --bg-deep: #090b10;
        --bg-surface: #12151f;
        --bg-card: #181c2a;
        --border: #24293d;
        --border-focus: #3b82f6;
        --accent: #3b82f6;
        --accent-hover: #2563eb;
        --accent-glow: rgba(59, 130, 246, 0.35);
        --text: #f8fafc;
        --text-muted: #94a3b8;
        --success: #10b981;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
      body { background-color: var(--bg-deep); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
      nav { background: rgba(18, 21, 31, 0.85); backdrop-filter: blur(14px); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; position: sticky; top: 0; z-index: 100; }
      .brand { font-size: 1.3rem; font-weight: 800; color: #fff; text-decoration: none; letter-spacing: -0.5px; }
      .brand span { color: var(--accent); }
      .nav-links { display: flex; gap: 24px; align-items: center; }
      .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.95rem; font-weight: 600; transition: color 0.2s; }
      .nav-links a:hover { color: #fff; }
      .btn { background: var(--accent); color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 0.95rem; border: none; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 16px var(--accent-glow); }
      .btn:hover { background: var(--accent-hover); transform: translateY(-1px); }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .btn-secondary { background: #24293d; color: var(--text); box-shadow: none; }
      .btn-secondary:hover { background: #2f3650; }
      .container { max-width: 1100px; margin: 0 auto; padding: 36px 20px; flex: 1; width: 100%; }
      .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 28px; }
      footer { border-top: 1px solid var(--border); text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.85rem; }
      
      /* Toast notification */
      #toast { position: fixed; bottom: 28px; right: 28px; background: #1e293b; border: 1px solid var(--border); color: #fff; padding: 14px 22px; border-radius: 12px; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 12px; transform: translateY(120%); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); z-index: 1000; }
      #toast.show { transform: translateY(0); }
      #toast.success { border-color: var(--success); }
    </style>
  </head>
  <body>
    <nav>
      <a href="/" class="brand">AKSU<span>LAUNCHER</span></a>
      <div class="nav-links">
        <a href="/">Home</a>
        <a href="/downloads">Download APK</a>
        ${activeUser 
          ? `<a href="/dashboard">Cosmetics Studio</a><a href="/logout" style="color:#f87171;">Log Out (${activeUser})</a>` 
          : `<a href="/auth" class="btn" style="padding: 9px 18px;">Sign In</a>`}
      </div>
    </nav>
    <div class="container">${content}</div>
    <div id="toast"></div>
    <footer>&copy; 2026 AksuLauncher &bull; Powered by Supabase & AKSU1501</footer>

    <script>
      function showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.className = type;
        toast.innerHTML = (type === 'success' ? '✓ ' : 'ℹ ') + message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
      }
    </script>
  </body>
  </html>`;
}

// 1. Landing Page
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      meta: { serverName: "AksuSkinServer", implementationName: "AksuSkinServer", implementationVersion: "2.0.0" },
      skinDomains: [req.get('host'), new URL(SUPABASE_URL).hostname],
      signaturePublickey: publicKey
    });
  }

  const content = `
    <div style="text-align: center; padding: 50px 0 30px;">
      <h1 style="font-size: 3rem; font-weight: 800; margin-bottom: 16px; letter-spacing: -1px;">
        Minecraft Java for Android.<br><span style="color: var(--accent);">Interactive 3D Cosmetics.</span>
      </h1>
      <p style="color: var(--text-muted); font-size: 1.15rem; max-width: 620px; margin: 0 auto 32px; line-height: 1.6;">
        Live real-time cape, elytra, and skin preview engine synced directly to AksuLauncher with zero database wipes.
      </p>
      <div style="display: flex; justify-content: center; gap: 16px;">
        <a href="/downloads" class="btn">Download AksuLauncher APK</a>
        <a href="/auth" class="btn btn-secondary">Open Cosmetics Studio</a>
      </div>
    </div>
  `;
  res.send(renderLayout('Home', content, req.session ? req.session.user : null));
});

// 2. APK Downloads Page
app.get('/downloads', (req, res) => {
  const content = `
    <div style="max-width: 650px; margin: 0 auto;">
      <h2 style="font-size: 2rem; margin-bottom: 8px;">Download Center</h2>
      <p style="color: var(--text-muted); margin-bottom: 24px;">Grab the latest compiled APK for your tablet.</p>
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; font-size: 1.1rem;">AksuLauncher (Android Build)</div>
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">OpenJDK 17 &bull; Custom Cosmetics Sync Enabled</div>
          </div>
          <a href="https://github.com/AKSU1501/AksuLauncher/actions" target="_blank" class="btn" style="padding: 10px 20px;">Download</a>
        </div>
      </div>
    </div>
  `;
  res.send(renderLayout('Downloads', content, req.session ? req.session.user : null));
});

// 3. Auth Page
app.get('/auth', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');

  const content = `
    <div style="max-width: 440px; margin: 40px auto 0;">
      <div class="card" id="loginBox">
        <h2 style="font-size: 1.6rem; margin-bottom: 6px;">Sign In</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 22px;">Access your 3D wardrobe & cosmetics.</p>
        <form action="/login" method="post">
          <label style="display:block; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Minecraft Username</label>
          <input type="text" name="username" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:16px; font-size: 0.95rem;">
          
          <label style="display:block; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Password</label>
          <input type="password" name="password" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:24px; font-size: 0.95rem;">

          <button type="submit" class="btn" style="width:100%;">Sign In</button>
        </form>
        <div style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: var(--text-muted);">
          Don't have an account? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; font-weight: 600;">Create one</a>
        </div>
      </div>

      <div class="card" id="registerBox" style="display: none;">
        <h2 style="font-size: 1.6rem; margin-bottom: 6px;">Create Account</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 22px;">Reserve your in-game username.</p>
        <form action="/register" method="post">
          <label style="display:block; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Minecraft Username</label>
          <input type="text" name="username" id="regUser" onkeyup="checkUsername()" required placeholder="Exact in-game name" style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:4px; font-size: 0.95rem;">
          <div id="userFeedback" style="font-size:0.8rem; height: 18px; margin-bottom: 12px; font-weight: 600;"></div>

          <label style="display:block; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Email Address</label>
          <input type="email" name="email" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:16px; font-size: 0.95rem;">

          <label style="display:block; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">Password</label>
          <input type="password" name="password" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:24px; font-size: 0.95rem;">

          <button type="submit" id="regBtn" class="btn" style="width:100%;">Register Account</button>
        </form>
        <div style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: var(--text-muted);">
          Already claimed? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; font-weight: 600;">Sign In</a>
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

      let timeout = null;
      function checkUsername() {
        clearTimeout(timeout);
        const name = document.getElementById('regUser').value.trim();
        const fb = document.getElementById('userFeedback');
        const btn = document.getElementById('regBtn');
        if (!name) { fb.innerText = ''; return; }
        
        timeout = setTimeout(async () => {
          fb.innerText = 'Checking...';
          fb.style.color = '#94a3b8';
          const res = await fetch('/api/check-user?username=' + encodeURIComponent(name));
          const data = await res.json();
          if (data.available) {
            fb.innerText = '✓ Username is available';
            fb.style.color = '#10b981';
            btn.disabled = false;
          } else {
            fb.innerText = '✕ Username is already claimed';
            fb.style.color = '#ef4444';
            btn.disabled = true;
          }
        }, 300);
      }
    </script>
  `;
  res.send(renderLayout('Account', content));
});

app.get('/api/check-user', async (req, res) => {
  const user = (req.query.username || '').toLowerCase().trim();
  const { data } = await supabase.from('users').select('username').ilike('username', user).maybeSingle();
  res.json({ available: !data });
});

app.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password;

  if (!username || !email || !password) return res.redirect('/auth');

  const { data: existing } = await supabase.from('users').select('id').ilike('username', username).maybeSingle();
  if (existing) {
    return res.send(renderLayout('Error', `<div class="card" style="text-align:center;"><h3>Username already claimed</h3><p style="margin:16px 0;"><a href="/auth" class="btn">Try Again</a></p></div>`));
  }

  const { error } = await supabase.from('users').insert({
    username,
    email,
    password_hash: hashPassword(password)
  });

  if (error) return res.status(500).send('Database error: ' + error.message);

  req.session.user = username;
  res.redirect('/dashboard?registered=true');
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password;

  const { data: user } = await supabase.from('users').select('*').ilike('username', username).maybeSingle();

  if (!user || user.password_hash !== hashPassword(password)) {
    return res.send(renderLayout('Error', `<div class="card" style="text-align:center;"><h3>Incorrect username or password</h3><p style="margin:16px 0;"><a href="/auth" class="btn">Back to Login</a></p></div>`));
  }

  req.session.user = user.username;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// 4. Interactive 3D Cosmetics Studio
app.get('/dashboard', async (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/auth');

  const { data: user } = await supabase.from('users').select('*').ilike('username', req.session.user).maybeSingle();
  const skinUrl = user && user.skin_url ? user.skin_url : '';
  const capeUrl = user && user.cape_url ? user.cape_url : '';
  const modelType = user && user.model === 'slim' ? 'slim' : 'default';

  const content = `
    <style>
      .studio-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 28px; }
      @media(max-width: 860px) { .studio-grid { grid-template-columns: 1fr; } }
      .viewer-box { background: #0c0f17; border: 1px solid var(--border); border-radius: 16px; position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 440px; }
      .viewer-controls { position: absolute; bottom: 16px; left: 16px; right: 16px; display: flex; justify-content: center; gap: 8px; z-index: 10; flex-wrap: wrap; }
      .pill-btn { background: rgba(24, 28, 42, 0.85); backdrop-filter: blur(8px); border: 1px solid var(--border); color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
      .pill-btn.active { background: var(--accent); border-color: var(--accent); }
      .file-dropzone { border: 2px dashed var(--border); border-radius: 12px; padding: 20px; text-align: center; cursor: pointer; transition: all 0.2s; background: #0e111a; margin-top: 8px; }
      .file-dropzone:hover { border-color: var(--accent); background: #121624; }
      .upload-progress { height: 6px; background: #24293d; border-radius: 4px; overflow: hidden; margin-top: 16px; display: none; }
      .progress-fill { height: 100%; width: 0%; background: var(--accent); transition: width 0.3s ease; }
    </style>

    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
      <div>
        <h2 style="font-size: 2.2rem; font-weight: 800; letter-spacing: -0.5px;">Cosmetics Studio</h2>
        <p style="color: var(--text-muted); font-size: 0.95rem;">Interactive 3D real-time preview for player <b>${req.session.user}</b></p>
      </div>
      <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 6px 16px; border-radius: 20px; font-size: 0.85rem; font-weight: 700;">
        ● Supabase Cloud Synced
      </div>
    </div>

    <div class="studio-grid">
      <!-- 3D Canvas Box -->
      <div class="viewer-box">
        <canvas id="skin_container"></canvas>
        <div class="viewer-controls">
          <button type="button" class="pill-btn active" id="btnAnim" onclick="toggleAnimation()">Walk Anim: ON</button>
          <button type="button" class="pill-btn" id="btnEquip" onclick="toggleEquipment()">Mode: Cape</button>
          <button type="button" class="pill-btn" onclick="resetCamera()">Reset View</button>
        </div>
      </div>

      <!-- Settings & Uploads -->
      <div class="card">
        <form id="cosmeticsForm">
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">Arm Geometry Model</label>
          <select id="modelSelector" name="model" style="width:100%; padding:12px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:20px; font-size: 0.95rem;">
            <option value="default" ${modelType === 'default' ? 'selected' : ''}>Classic 4-pixel (Steve)</option>
            <option value="slim" ${modelType === 'slim' ? 'selected' : ''}>Slim 3-pixel (Alex)</option>
          </select>

          <!-- Skin Input -->
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">Skin Texture (.png)</label>
          <div class="file-dropzone" onclick="document.getElementById('skinInput').click()">
            <div id="skinLabel" style="font-size: 0.9rem; color: #fff;">${skinUrl ? '✓ Custom Skin Loaded' : 'Tap to select skin PNG'}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">64x64 or 64x32 PNG</div>
            <input type="file" id="skinInput" name="skin" style="display:none;">
          </div>

          <!-- Cape Input -->
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-top: 20px; margin-bottom: 6px;">Cape & Elytra (.png)</label>
          <div class="file-dropzone" onclick="document.getElementById('capeInput').click()">
            <div id="capeLabel" style="font-size: 0.9rem; color: #fff;">${capeUrl ? '✓ Custom Cape Loaded' : 'Tap to select cape PNG'}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Standard Minecraft cape layout</div>
            <input type="file" id="capeInput" name="cape" style="display:none;">
          </div>

          <div class="upload-progress" id="progressWrap">
            <div class="progress-fill" id="progressBar"></div>
          </div>

          <button type="submit" id="saveBtn" class="btn" style="width:100%; margin-top:24px; padding:14px;">
            Save to Cloud
          </button>
        </form>
      </div>
    </div>

    <script>
      // 3D Engine Setup
      const canvas = document.getElementById("skin_container");
      const skinViewer = new skinview3d.SkinViewer({
        canvas: canvas,
        width: 320,
        height: 400,
        skin: "${skinUrl || 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f0f6fa9ff2cf93ae9cf745fca20ba5979f8a6'}"
      });

      let currentCape = "${capeUrl}";
      let currentEquip = 'cape';
      let isWalking = true;
      let walkAnim = skinViewer.animations.add(skinview3d.WalkingAnimation);

      if (currentCape) {
        skinViewer.loadCape(currentCape, { backEquipment: currentEquip });
      }

      // Model Switcher
      document.getElementById('modelSelector').addEventListener('change', (e) => {
        skinViewer.loadSkin(skinViewer.skinUrl, { model: e.target.value });
      });

      // Local Skin Preview
      document.getElementById('skinInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            skinViewer.loadSkin(evt.target.result, { model: document.getElementById('modelSelector').value });
            document.getElementById('skinLabel').innerText = 'Selected: ' + file.name;
            showToast('Previewing new skin locally!', 'info');
          };
          reader.readAsDataURL(file);
        }
      });

      // Local Cape Preview
      document.getElementById('capeInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            currentCape = evt.target.result;
            skinViewer.loadCape(currentCape, { backEquipment: currentEquip });
            document.getElementById('capeLabel').innerText = 'Selected: ' + file.name;
            showToast('Previewing new cape locally!', 'info');
          };
          reader.readAsDataURL(file);
        }
      });

      // Animation Toggle
      function toggleAnimation() {
        const btn = document.getElementById('btnAnim');
        if (isWalking) {
          walkAnim.paused = true;
          btn.innerText = 'Walk Anim: OFF';
          btn.classList.remove('active');
          isWalking = false;
        } else {
          walkAnim.paused = false;
          btn.innerText = 'Walk Anim: ON';
          btn.classList.add('active');
          isWalking = true;
        }
      }

      // Elytra / Cape Toggle
      function toggleEquipment() {
        const btn = document.getElementById('btnEquip');
        currentEquip = currentEquip === 'cape' ? 'elytra' : 'cape';
        btn.innerText = currentEquip === 'cape' ? 'Mode: Cape' : 'Mode: Elytra';
        if (currentCape) {
          skinViewer.loadCape(currentCape, { backEquipment: currentEquip });
        }
      }

      function resetCamera() {
        skinViewer.camera.position.x = 0;
        skinViewer.camera.position.y = 0;
        skinViewer.camera.position.z = 60;
        skinViewer.controls.reset();
      }

      // AJAX Upload with Progress & Instant Feedback
      document.getElementById('cosmeticsForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const btn = document.getElementById('saveBtn');
        const progressWrap = document.getElementById('progressWrap');
        const progressBar = document.getElementById('progressBar');
        
        btn.disabled = true;
        btn.innerText = 'Uploading to Supabase...';
        progressWrap.style.display = 'block';
        progressBar.style.width = '30%';

        const formData = new FormData(this);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.onprogress = function(e) {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 90);
            progressBar.style.width = pct + '%';
          }
        };

        xhr.onload = function() {
          progressBar.style.width = '100%';
          if (xhr.status === 200) {
            showToast('Cosmetics saved and synced to Cloud!', 'success');
            btn.innerText = '✓ Saved Successfully!';
            setTimeout(() => {
              btn.disabled = false;
              btn.innerText = 'Save to Cloud';
              progressWrap.style.display = 'none';
              progressBar.style.width = '0%';
            }, 2500);
          } else {
            showToast('Upload failed: ' + xhr.responseText, 'error');
            btn.disabled = false;
            btn.innerText = 'Save to Cloud';
          }
        };

        xhr.onerror = function() {
          showToast('Network error while saving.', 'error');
          btn.disabled = false;
          btn.innerText = 'Save to Cloud';
        };

        xhr.send(formData);
      });

      // Show welcome toast if just registered
      if (new URLSearchParams(window.location.search).get('registered')) {
        showToast('Account registered successfully!', 'success');
      }
    </script>
  `;
  res.send(renderLayout('Cosmetics Studio', content, req.session.user));
});

// Cloud Upload API
app.post('/upload', upload.fields([{ name: 'skin', maxCount: 1 }, { name: 'cape', maxCount: 1 }]), async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).send('Unauthorized');

  const username = req.session.user;
  const model = req.body.model === 'slim' ? 'slim' : 'default';
  const updates = { model };

  try {
    if (req.files && req.files['skin'] && req.files['skin'][0]) {
      const file = req.files['skin'][0];
      const filePath = `skins/${username.toLowerCase()}_${Date.now()}.png`;
      const { data, error } = await supabase.storage.from('cosmetics').upload(filePath, file.buffer, { contentType: 'image/png', upsert: true });
      if (error) throw error;
      const { data: publicData } = supabase.storage.from('cosmetics').getPublicUrl(filePath);
      updates.skin_url = publicData.publicUrl;
    }

    if (req.files && req.files['cape'] && req.files['cape'][0]) {
      const file = req.files['cape'][0];
      const filePath = `capes/${username.toLowerCase()}_${Date.now()}.png`;
      const { data, error } = await supabase.storage.from('cosmetics').upload(filePath, file.buffer, { contentType: 'image/png', upsert: true });
      if (error) throw error;
      const { data: publicData } = supabase.storage.from('cosmetics').getPublicUrl(filePath);
      updates.cape_url = publicData.publicUrl;
    }

    const { error: dbError } = await supabase.from('users').update(updates).ilike('username', username);
    if (dbError) throw dbError;

    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 5. Yggdrasil API Session profile for AksuLauncher
app.get('/sessionserver/session/minecraft/profile/:uuid', async (req, res) => {
  const uuid = req.params.uuid.replace(/-/g, '').toLowerCase();

  const { data: users } = await supabase.from('users').select('*');
  if (!users) return res.status(204).end();

  const matchedUser = users.find(u => getOfflineUUID(u.username) === uuid);
  if (!matchedUser || (!matchedUser.skin_url && !matchedUser.cape_url)) {
    return res.status(204).end();
  }

  const textures = {};
  if (matchedUser.skin_url) {
    textures.SKIN = { url: matchedUser.skin_url };
    if (matchedUser.model === 'slim') textures.SKIN.metadata = { model: 'slim' };
  }
  if (matchedUser.cape_url) {
    textures.CAPE = { url: matchedUser.cape_url };
  }

  const textureData = {
    timestamp: Date.now(),
    profileId: uuid,
    profileName: matchedUser.username,
    textures
  };

  const base64Textures = Buffer.from(JSON.stringify(textureData)).toString('base64');
  const signer = crypto.createSign('SHA1');
  signer.update(base64Textures);
  const signature = signer.sign(privateKey, 'base64');

  res.json({
    id: uuid,
    name: matchedUser.username,
    properties: [{ name: 'textures', value: base64Textures, signature }]
  });
});

app.listen(PORT, () => console.log(`AksuLauncher 3D Studio active on port ${PORT}`));
