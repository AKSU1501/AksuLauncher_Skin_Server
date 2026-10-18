const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Direct Supabase Connection with Administrative Service Role Key
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rtfuamnwfrtyitxbakrl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'EyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0ZnVhbW53ZnJ0eWl0eGJha3JsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjMzNjQ4OCwiZXhwIjoyMTA3OTEyNDg4fQ.HHd9Z51aFBmqBRZ8TPQEb7Y_XqgwpQRlkEm7ENvVbBM';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// RSA Keypair setup for authlib-injector
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
    <title>${title} | AksuLauncher</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/skinview3d@3.0.1/bundles/skinview3d.bundle.js"></script>
    <style>
      :root {
        --bg-deep: #080a0f;
        --bg-surface: #0f131d;
        --bg-card: rgba(22, 27, 40, 0.7);
        --border: #232a3d;
        --accent: #3b82f6;
        --accent-hover: #2563eb;
        --accent-glow: rgba(59, 130, 246, 0.4);
        --text: #f8fafc;
        --text-muted: #94a3b8;
        --success: #10b981;
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
          radial-gradient(circle at 85% 65%, rgba(139, 92, 246, 0.07) 0%, transparent 40%);
        background-attachment: fixed;
      }
      nav {
        background: rgba(15, 19, 29, 0.82);
        backdrop-filter: blur(16px);
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 32px;
        position: sticky;
        top: 0;
        z-index: 100;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 1.25rem;
        font-weight: 800;
        color: #fff;
        text-decoration: none;
        letter-spacing: -0.5px;
      }
      .brand img { width: 32px; height: 32px; border-radius: 6px; }
      .brand span { color: var(--accent); }
      .nav-links { display: flex; gap: 24px; align-items: center; }
      .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.95rem; font-weight: 600; transition: color 0.2s; }
      .nav-links a:hover { color: #fff; }
      
      .btn {
        background: var(--accent);
        color: #fff;
        padding: 12px 24px;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 700;
        font-size: 0.95rem;
        border: none;
        cursor: pointer;
        transition: all 0.25s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-shadow: 0 4px 18px var(--accent-glow);
      }
      .btn:hover { background: var(--accent-hover); transform: translateY(-2px); box-shadow: 0 6px 24px rgba(59, 130, 246, 0.55); }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .btn-secondary { background: rgba(35, 42, 61, 0.8); border: 1px solid var(--border); color: var(--text); box-shadow: none; }
      .btn-secondary:hover { background: rgba(45, 54, 78, 1); }
      
      .container { max-width: 1140px; margin: 0 auto; padding: 40px 20px; flex: 1; width: 100%; }
      .card {
        background: var(--bg-card);
        backdrop-filter: blur(12px);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 32px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.3);
      }
      footer { border-top: 1px solid var(--border); text-align: center; padding: 28px; color: var(--text-muted); font-size: 0.85rem; }
      
      #toast {
        position: fixed;
        bottom: 28px;
        right: 28px;
        background: #151a28;
        border: 1px solid var(--border);
        color: #fff;
        padding: 14px 24px;
        border-radius: 14px;
        font-weight: 600;
        box-shadow: 0 12px 36px rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        gap: 12px;
        transform: translateY(140%);
        transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 1000;
      }
      #toast.show { transform: translateY(0); }
      #toast.success { border-color: var(--success); }
    </style>
  </head>
  <body>
    <nav>
      <a href="/" class="brand">
        <img src="https://raw.githubusercontent.com/PrismLauncher/PrismLauncher/develop/launcher/resources/multimc/scalable/multimc.svg" alt="Icon">
        AKSU<span>LAUNCHER</span>
      </a>
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
    <footer>&copy; 2026 AksuLauncher &bull; Built for Android &bull; Powered by Supabase Cloud</footer>

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
    <div style="text-align: center; padding: 60px 0 50px; position: relative;">
      <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #60a5fa; padding: 6px 16px; border-radius: 30px; font-size: 0.85rem; font-weight: 700; margin-bottom: 24px;">
        🚀 Optimized for Samsung Galaxy Tab S9 FE & Android Devices
      </div>
      <h1 style="font-size: 3.4rem; font-weight: 800; margin-bottom: 20px; letter-spacing: -1.5px; line-height: 1.15;">
        Play Minecraft Java on Android.<br>
        <span style="background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          Custom Capes, Elytras & Skins.
        </span>
      </h1>
      <p style="color: var(--text-muted); font-size: 1.2rem; max-width: 680px; margin: 0 auto 36px; line-height: 1.6;">
        A high-performance Java Launcher running OpenJDK 17 with an integrated 3D cosmetics studio. Zero cloud resets, instant sync.
      </p>
      <div style="display: flex; justify-content: center; gap: 16px; flex-wrap: wrap;">
        <a href="/downloads" class="btn" style="padding: 15px 32px; font-size: 1.05rem;">
          📥 Download AksuLauncher APK
        </a>
        <a href="/auth" class="btn btn-secondary" style="padding: 15px 32px; font-size: 1.05rem;">
          🎨 Open 3D Wardrobe
        </a>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; margin-top: 30px;">
      <div class="card">
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 14px;">
          <div style="background: rgba(59, 130, 246, 0.15); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
            <img src="https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/26a1.png" style="width: 28px; height: 28px;">
          </div>
          <h3 style="font-size: 1.25rem; font-weight: 700;">Desktop Performance</h3>
        </div>
        <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.6;">
          Native ARM64 OpenJDK execution with hardware-accelerated Vulkan & OpenGL drivers tailored for modern tablets.
        </p>
      </div>

      <div class="card">
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 14px;">
          <div style="background: rgba(168, 85, 247, 0.15); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
            <img src="https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1fa9d.png" style="width: 28px; height: 28px;">
          </div>
          <h3 style="font-size: 1.25rem; font-weight: 700;">3D Cape & Elytra Rendering</h3>
        </div>
        <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.6;">
          Full support for custom animated capes and gliding Elytra wings using cryptographic Yggdrasil signatures via authlib-injector.
        </p>
      </div>

      <div class="card">
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 14px;">
          <div style="background: rgba(16, 185, 129, 0.15); width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
            <img src="https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/1f512.png" style="width: 28px; height: 28px;">
          </div>
          <h3 style="font-size: 1.25rem; font-weight: 700;">Zero Data Wipes</h3>
        </div>
        <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.6;">
          All user profiles, usernames, and skin files are permanently stored in an enterprise PostgreSQL and S3 cloud bucket powered by Supabase.
        </p>
      </div>
    </div>
  `;
  res.send(renderLayout('Home', content, req.session ? req.session.user : null));
});

// 2. Download Center
app.get('/downloads', (req, res) => {
  const content = `
    <div style="max-width: 780px; margin: 0 auto;">
      <div style="text-align: center; margin-bottom: 36px;">
        <h2 style="font-size: 2.4rem; font-weight: 800; letter-spacing: -0.5px;">Download AksuLauncher</h2>
        <p style="color: var(--text-muted); font-size: 1.05rem; margin-top: 8px;">Install the latest Java runtime environment on your Android device.</p>
      </div>

      <div class="card" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px;">
          <div style="display: flex; gap: 18px; align-items: center;">
            <img src="https://raw.githubusercontent.com/PrismLauncher/PrismLauncher/develop/launcher/resources/multimc/scalable/multimc.svg" style="width: 54px; height: 54px;">
            <div>
              <div style="font-weight: 800; font-size: 1.3rem;">AksuLauncher v3 (Latest Action Build)</div>
              <div style="color: #10b981; font-weight: 700; font-size: 0.85rem; margin-top: 4px;">● Verified Stable &bull; OpenJDK 17 + JRE 21</div>
            </div>
          </div>
          <a href="https://github.com/AKSU1501/AksuLauncher/actions" target="_blank" class="btn" style="padding: 14px 26px;">
            📥 Download Latest Build
          </a>
        </div>

        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; text-align: center;">
          <div style="background: rgba(15, 19, 29, 0.6); padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
            <div style="color: var(--text-muted); font-size: 0.75rem; font-weight: 700;">PLATFORM</div>
            <div style="font-weight: 800; font-size: 0.95rem; margin-top: 4px;">Android 8.0+</div>
          </div>
          <div style="background: rgba(15, 19, 29, 0.6); padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
            <div style="color: var(--text-muted); font-size: 0.75rem; font-weight: 700;">ARCHITECTURE</div>
            <div style="font-weight: 800; font-size: 0.95rem; margin-top: 4px;">ARM64 / AArch64</div>
          </div>
          <div style="background: rgba(15, 19, 29, 0.6); padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
            <div style="color: var(--text-muted); font-size: 0.75rem; font-weight: 700;">MINECRAFT</div>
            <div style="font-weight: 800; font-size: 0.95rem; margin-top: 4px;">1.7.10 to 1.21+</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 14px;">📋 Installation Instructions</h3>
        <ol style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.8; padding-left: 20px;">
          <li>Tap <b>Download Latest Build</b> to open GitHub Actions artifacts.</li>
          <li>Install the compiled APK on your device.</li>
          <li>Open AksuLauncher and add a Local/Offline account matching your website username.</li>
          <li>Your cloud skins, capes, and Elytras will automatically render inside the game.</li>
        </ol>
      </div>
    </div>
  `;
  res.send(renderLayout('Downloads', content, req.session ? req.session.user : null));
});

// 3. Auth Page
app.get('/auth', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');

  const content = `
    <div style="max-width: 440px; margin: 30px auto 0;">
      <div class="card" id="loginBox">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="font-size: 1.7rem; font-weight: 800;">Welcome Back</h2>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 6px;">Sign in to customize your in-game 3D wardrobe.</p>
        </div>
        <form action="/login" method="post">
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">Minecraft Username</label>
          <input type="text" name="username" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:16px; font-size: 0.95rem;">
          
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">Password</label>
          <input type="password" name="password" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:24px; font-size: 0.95rem;">

          <button type="submit" class="btn" style="width:100%;">Sign In to Studio</button>
        </form>
        <div style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: var(--text-muted);">
          Don't have an account? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; font-weight: 700;">Create one</a>
        </div>
      </div>

      <div class="card" id="registerBox" style="display: none;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="font-size: 1.7rem; font-weight: 800;">Claim Username</h2>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 6px;">Register your exact name to protect your skin & capes.</p>
        </div>
        <form action="/register" method="post">
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">Minecraft Username (Exact In-Game)</label>
          <input type="text" name="username" id="regUser" onkeyup="checkUsername()" required placeholder="e.g. SteveMaster" style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:4px; font-size: 0.95rem;">
          <div id="userFeedback" style="font-size:0.8rem; height: 18px; margin-bottom: 12px; font-weight: 700;"></div>

          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">Email Address</label>
          <input type="email" name="email" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:16px; font-size: 0.95rem;">

          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">Password</label>
          <input type="password" name="password" required style="width:100%; padding:12px 14px; border-radius:10px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:24px; font-size: 0.95rem;">

          <button type="submit" id="regBtn" class="btn" style="width:100%;">Register & Reserve</button>
        </form>
        <div style="text-align: center; margin-top: 20px; font-size: 0.9rem; color: var(--text-muted);">
          Already claimed? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; font-weight: 700;">Sign In</a>
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
          fb.innerText = 'Checking database...';
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
  res.send(renderLayout('Account Portal', content));
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
      .studio-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 28px; }
      @media(max-width: 880px) { .studio-grid { grid-template-columns: 1fr; } }
      
      .viewer-box {
        background: radial-gradient(circle at center, #151a28 0%, #090c13 100%);
        border: 1px solid var(--border);
        border-radius: 20px;
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 520px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.4);
      }
      
      .view-selector-bar {
        position: absolute;
        top: 18px;
        left: 18px;
        right: 18px;
        display: flex;
        justify-content: center;
        gap: 6px;
        z-index: 10;
        background: rgba(18, 23, 35, 0.85);
        backdrop-filter: blur(12px);
        padding: 6px;
        border-radius: 14px;
        border: 1px solid var(--border);
      }
      .view-tab {
        background: transparent;
        border: none;
        color: var(--text-muted);
        padding: 8px 14px;
        border-radius: 10px;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        flex: 1;
        text-align: center;
      }
      .view-tab.active {
        background: var(--accent);
        color: #fff;
        box-shadow: 0 2px 12px var(--accent-glow);
      }

      .viewer-controls {
        position: absolute;
        bottom: 18px;
        left: 18px;
        right: 18px;
        display: flex;
        justify-content: center;
        gap: 8px;
        z-index: 10;
        flex-wrap: wrap;
      }
      .pill-btn {
        background: rgba(24, 28, 42, 0.85);
        backdrop-filter: blur(8px);
        border: 1px solid var(--border);
        color: #fff;
        padding: 7px 16px;
        border-radius: 20px;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }
      .pill-btn.active { background: var(--accent); border-color: var(--accent); }
      
      .file-dropzone {
        border: 2px dashed var(--border);
        border-radius: 14px;
        padding: 20px;
        text-align: center;
        cursor: pointer;
        transition: all 0.25s;
        background: rgba(14, 17, 26, 0.6);
        margin-top: 6px;
      }
      .file-dropzone:hover { border-color: var(--accent); background: rgba(20, 26, 42, 0.9); }
      
      .upload-progress { height: 6px; background: #232a3d; border-radius: 4px; overflow: hidden; margin-top: 18px; display: none; }
      .progress-fill { height: 100%; width: 0%; background: var(--accent); transition: width 0.3s ease; }
    </style>

    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
      <div>
        <h2 style="font-size: 2.2rem; font-weight: 800; letter-spacing: -0.5px;">Cosmetics Studio</h2>
        <p style="color: var(--text-muted); font-size: 0.95rem;">Interactive 3D preview for player <b style="color:#60a5fa;">${req.session.user}</b></p>
      </div>
      <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 6px 16px; border-radius: 20px; font-size: 0.85rem; font-weight: 700;">
        ● Supabase Cloud Synced
      </div>
    </div>

    <div class="studio-grid">
      <!-- 3D Canvas Box -->
      <div class="viewer-box">
        <div class="view-selector-bar">
          <button type="button" class="view-tab active" onclick="switchView('full')">Full Player</button>
          <button type="button" class="view-tab" onclick="switchView('skin')">Skin Only</button>
          <button type="button" class="view-tab" onclick="switchView('cape')">Cape 3D</button>
          <button type="button" class="view-tab" onclick="switchView('elytra')">Elytra 3D</button>
        </div>

        <canvas id="skin_container"></canvas>

        <div class="viewer-controls">
          <button type="button" class="pill-btn active" id="btnAnim" onclick="toggleAnimation()">Walk Anim: ON</button>
          <button type="button" class="pill-btn" onclick="resetCamera()">Reset View</button>
        </div>
      </div>

      <!-- Settings & Form -->
      <div class="card">
        <form id="cosmeticsForm">
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">Arm Geometry Model</label>
          <select id="modelSelector" name="model" style="width:100%; padding:12px; border-radius:12px; border:1px solid var(--border); background:#0c0e14; color:#fff; margin-bottom:18px; font-size: 0.95rem;">
            <option value="default" ${modelType === 'default' ? 'selected' : ''}>Classic 4-pixel arm (Steve)</option>
            <option value="slim" ${modelType === 'slim' ? 'selected' : ''}>Slim 3-pixel arm (Alex)</option>
          </select>

          <!-- Skin Selector -->
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">Skin Texture (.png)</label>
          <div class="file-dropzone" onclick="document.getElementById('skinInput').click()">
            <div id="skinLabel" style="font-size: 0.95rem; font-weight: 600; color: #fff;">${skinUrl ? '✓ Custom Skin Loaded' : 'Select skin PNG'}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">64x64 or 64x32 PNG file</div>
            <input type="file" id="skinInput" name="skin" style="display:none;">
          </div>

          <!-- Cape Selector -->
          <label style="display:block; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); margin-top: 18px; margin-bottom: 6px;">Cape & Elytra (.png)</label>
          <div class="file-dropzone" onclick="document.getElementById('capeInput').click()">
            <div id="capeLabel" style="font-size: 0.95rem; font-weight: 600; color: #fff;">${capeUrl ? '✓ Custom Cape Loaded' : 'Select cape PNG'}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Standard Minecraft cape texture</div>
            <input type="file" id="capeInput" name="cape" style="display:none;">
          </div>

          <div class="upload-progress" id="progressWrap">
            <div class="progress-fill" id="progressBar"></div>
          </div>

          <button type="submit" id="saveBtn" class="btn" style="width:100%; margin-top:24px; padding:15px;">
            Save to Cloud
          </button>
        </form>
      </div>
    </div>

    <script>
      const defaultSkin = "https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f0f6fa9ff2cf93ae9cf745fca20ba5979f8a6";
      let activeSkinUrl = "${skinUrl}" || defaultSkin;
      let activeCapeUrl = "${capeUrl}";
      let currentMode = "full";

      const canvas = document.getElementById("skin_container");
      const skinViewer = new skinview3d.SkinViewer({
        canvas: canvas,
        width: 320,
        height: 440,
        skin: activeSkinUrl
      });

      let isWalking = true;
      let walkAnim = skinViewer.animations.add(skinview3d.WalkingAnimation);

      if (activeCapeUrl) {
        skinViewer.loadCape(activeCapeUrl, { backEquipment: 'cape' });
      }

      function setPlayerBodyVisibility(visible) {
        if (skinViewer.playerObject && skinViewer.playerObject.skin) {
          skinViewer.playerObject.skin.visible = visible;
        }
      }

      function switchView(mode) {
        currentMode = mode;
        document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
        event.target.classList.add('active');

        if (mode === 'full') {
          setPlayerBodyVisibility(true);
          if (activeCapeUrl) {
            skinViewer.loadCape(activeCapeUrl, { backEquipment: 'cape' });
          }
          resetCamera();
        } else if (mode === 'skin') {
          setPlayerBodyVisibility(true);
          skinViewer.loadCape(null);
          resetCamera();
        } else if (mode === 'cape') {
          if (!activeCapeUrl) {
            showToast('Select or upload a Cape first to inspect.', 'info');
          }
          setPlayerBodyVisibility(false);
          skinViewer.loadCape(activeCapeUrl || defaultSkin, { backEquipment: 'cape' });
          skinViewer.camera.position.x = 0;
          skinViewer.camera.position.y = 0;
          skinViewer.camera.position.z = -55;
          skinViewer.controls.reset();
        } else if (mode === 'elytra') {
          if (!activeCapeUrl) {
            showToast('Select or upload a Cape first to inspect Elytra.', 'info');
          }
          setPlayerBodyVisibility(false);
          skinViewer.loadCape(activeCapeUrl || defaultSkin, { backEquipment: 'elytra' });
          skinViewer.camera.position.x = 25;
          skinViewer.camera.position.y = 10;
          skinViewer.camera.position.z = -55;
          skinViewer.controls.reset();
        }
      }

      document.getElementById('modelSelector').addEventListener('change', (e) => {
        skinViewer.loadSkin(skinViewer.skinUrl, { model: e.target.value });
      });

      document.getElementById('skinInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            activeSkinUrl = evt.target.result;
            skinViewer.loadSkin(activeSkinUrl, { model: document.getElementById('modelSelector').value });
            setPlayerBodyVisibility(true);
            document.getElementById('skinLabel').innerText = 'Selected: ' + file.name;
            showToast('Previewing skin texture locally!', 'info');
          };
          reader.readAsDataURL(file);
        }
      });

      document.getElementById('capeInput').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = function(evt) {
            activeCapeUrl = evt.target.result;
            const equip = (currentMode === 'elytra') ? 'elytra' : 'cape';
            skinViewer.loadCape(activeCapeUrl, { backEquipment: equip });
            document.getElementById('capeLabel').innerText = 'Selected: ' + file.name;
            showToast('Previewing cape / elytra locally!', 'info');
          };
          reader.readAsDataURL(file);
        }
      });

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

      function resetCamera() {
        skinViewer.camera.position.x = 0;
        skinViewer.camera.position.y = 0;
        skinViewer.camera.position.z = 60;
        skinViewer.controls.reset();
      }

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

      if (new URLSearchParams(window.location.search).get('registered')) {
        showToast('Account registered successfully!', 'success');
      }
    </script>
  `;
  res.send(renderLayout('Cosmetics Studio', content, req.session.user));
});

// Cloud Upload API (Using flat root files to prevent bucket folder errors)
app.post('/upload', upload.fields([{ name: 'skin', maxCount: 1 }, { name: 'cape', maxCount: 1 }]), async (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).send('Unauthorized');

  const username = req.session.user;
  const model = req.body.model === 'slim' ? 'slim' : 'default';
  const updates = { model };

  try {
    if (req.files && req.files['skin'] && req.files['skin'][0]) {
      const file = req.files['skin'][0];
      const fileName = `${username.toLowerCase()}_skin_${Date.now()}.png`;
      const { data, error } = await supabase.storage
        .from('cosmetics')
        .upload(fileName, file.buffer, {
          contentType: 'image/png',
          upsert: true
        });

      if (error) {
        console.error('Skin upload error:', error);
        throw error;
      }

      const { data: publicData } = supabase.storage.from('cosmetics').getPublicUrl(fileName);
      updates.skin_url = publicData.publicUrl;
    }

    if (req.files && req.files['cape'] && req.files['cape'][0]) {
      const file = req.files['cape'][0];
      const fileName = `${username.toLowerCase()}_cape_${Date.now()}.png`;
      const { data, error } = await supabase.storage
        .from('cosmetics')
        .upload(fileName, file.buffer, {
          contentType: 'image/png',
          upsert: true
        });

      if (error) {
        console.error('Cape upload error:', error);
        throw error;
      }

      const { data: publicData } = supabase.storage.from('cosmetics').getPublicUrl(fileName);
      updates.cape_url = publicData.publicUrl;
    }

    const { error: dbError } = await supabase.from('users').update(updates).ilike('username', username);
    if (dbError) throw dbError;

    res.status(200).send('OK');
  } catch (err) {
    console.error('Upload handler error:', err);
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
