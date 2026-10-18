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

// Persistent RSA keypair generation
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

// In-memory file processing for direct cloud upload
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'aksu_session',
  keys: ['aksu-permanent-secret-auth-key'],
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
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
      :root { --bg: #0b0d13; --card: #151821; --border: #232736; --accent: #3b82f6; --accent-hover: #2563eb; --text: #f3f4f6; --dim: #9ca3af; }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
      body { background-color: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
      nav { background: rgba(21, 24, 33, 0.9); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; padding: 16px 28px; position: sticky; top: 0; z-index: 100; }
      .brand { font-size: 1.25rem; font-weight: 800; color: #fff; text-decoration: none; }
      .brand span { color: var(--accent); }
      .nav-links { display: flex; gap: 20px; align-items: center; }
      .nav-links a { color: var(--dim); text-decoration: none; font-size: 0.95rem; font-weight: 500; }
      .nav-links a:hover { color: #fff; }
      .btn { background: var(--accent); color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9rem; border: none; cursor: pointer; display: inline-block; text-align: center; }
      .btn:hover { background: var(--accent-hover); }
      .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
      .btn-outline:hover { background: #1c202d; }
      .container { max-width: 950px; margin: 0 auto; padding: 40px 20px; flex: 1; width: 100%; }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 28px; }
      footer { border-top: 1px solid var(--border); text-align: center; padding: 20px; color: var(--dim); font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <nav>
      <a href="/" class="brand">AKSU<span>LAUNCHER</span></a>
      <div class="nav-links">
        <a href="/">Home</a>
        <a href="/downloads">Download APK</a>
        ${activeUser 
          ? `<a href="/dashboard">Cosmetics</a><a href="/logout" style="color:#ef4444;">Log Out (${activeUser})</a>` 
          : `<a href="/auth" class="btn" style="padding: 8px 16px;">Sign In</a>`}
      </div>
    </nav>
    <div class="container">${content}</div>
    <footer>&copy; 2026 AksuLauncher &bull; Powered by AKSU1501</footer>
  </body>
  </html>`;
}

// 1. Home
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
      <h1 style="font-size: 2.8rem; font-weight: 800; margin-bottom: 16px;">
        Minecraft Java on Android.<br><span style="color: var(--accent);">Cloud-Synced Cosmetics.</span>
      </h1>
      <p style="color: var(--dim); font-size: 1.1rem; max-width: 600px; margin: 0 auto 30px;">
        Upload custom skins and capes that stay permanently saved and sync seamlessly to AksuLauncher.
      </p>
      <div style="display: flex; justify-content: center; gap: 16px;">
        <a href="/downloads" class="btn" style="font-size: 1rem; padding: 13px 26px;">Download Launcher</a>
        <a href="/auth" class="btn btn-outline" style="font-size: 1rem; padding: 13px 26px;">Manage Cosmetics</a>
      </div>
    </div>
  `;
  res.send(renderLayout('Home', content, req.session ? req.session.user : null));
});

// 2. APK Downloads Page
app.get('/downloads', (req, res) => {
  const content = `
    <div style="max-width: 650px; margin: 0 auto;">
      <h2 style="font-size: 2rem; margin-bottom: 10px;">Downloads Center</h2>
      <p style="color: var(--dim); margin-bottom: 24px;">Grab the latest compiled AksuLauncher APK build.</p>
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 0;">
          <div>
            <div style="font-weight: 600; font-size: 1.05rem;">AksuLauncher (Actions Build)</div>
            <div style="color: var(--dim); font-size: 0.85rem; margin-top: 4px;">Optimized for Galaxy Tab S9 FE &bull; Java 17</div>
          </div>
          <a href="https://github.com/AKSU1501/AksuLauncher/actions" target="_blank" class="btn" style="padding: 10px 18px;">Get APK</a>
        </div>
      </div>
    </div>
  `;
  res.send(renderLayout('Downloads', content, req.session ? req.session.user : null));
});

// 3. Auth Page (Real-time availability check)
app.get('/auth', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');

  const content = `
    <div style="max-width: 420px; margin: 0 auto;">
      <div class="card" id="loginBox">
        <h2 style="margin-bottom: 6px;">Sign In</h2>
        <p style="color: var(--dim); font-size: 0.9rem; margin-bottom: 20px;">Manage your AksuLauncher cosmetics.</p>
        <form action="/login" method="post">
          <label style="display:block; font-size: 0.85rem; color: var(--dim); margin-bottom: 6px;">Minecraft Username</label>
          <input type="text" name="username" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:#0b0d13; color:#fff; margin-bottom:14px;">
          
          <label style="display:block; font-size: 0.85rem; color: var(--dim); margin-bottom: 6px;">Password</label>
          <input type="password" name="password" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:#0b0d13; color:#fff; margin-bottom:20px;">

          <button type="submit" class="btn" style="width:100%; padding:12px;">Log In</button>
        </form>
        <div style="text-align: center; margin-top: 18px; font-size: 0.85rem; color: var(--dim);">
          Need an account? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; text-decoration: underline;">Create one</a>
        </div>
      </div>

      <div class="card" id="registerBox" style="display: none;">
        <h2 style="margin-bottom: 6px;">Create Account</h2>
        <p style="color: var(--dim); font-size: 0.9rem; margin-bottom: 20px;">Claim your exact in-game name permanently.</p>
        <form action="/register" method="post">
          <label style="display:block; font-size: 0.85rem; color: var(--dim); margin-bottom: 6px;">Minecraft Username</label>
          <input type="text" name="username" id="regUser" onkeyup="checkUsername()" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:#0b0d13; color:#fff; margin-bottom:4px;">
          <div id="userFeedback" style="font-size:0.8rem; margin-bottom: 12px; height: 16px;"></div>

          <label style="display:block; font-size: 0.85rem; color: var(--dim); margin-bottom: 6px;">Email Address</label>
          <input type="email" name="email" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:#0b0d13; color:#fff; margin-bottom:14px;">

          <label style="display:block; font-size: 0.85rem; color: var(--dim); margin-bottom: 6px;">Password</label>
          <input type="password" name="password" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:#0b0d13; color:#fff; margin-bottom:20px;">

          <button type="submit" id="regBtn" class="btn" style="width:100%; padding:12px;">Register & Claim</button>
        </form>
        <div style="text-align: center; margin-top: 18px; font-size: 0.85rem; color: var(--dim);">
          Already claimed? <a onclick="toggleAuth()" style="color: var(--accent); cursor: pointer; text-decoration: underline;">Log In</a>
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

      async function checkUsername() {
        const name = document.getElementById('regUser').value.trim();
        const fb = document.getElementById('userFeedback');
        const btn = document.getElementById('regBtn');
        if (!name) { fb.innerText = ''; return; }

        const res = await fetch('/api/check-user?username=' + encodeURIComponent(name));
        const data = await res.json();
        if (data.available) {
          fb.innerText = '✓ Username is available';
          fb.style.color = '#22c55e';
          btn.disabled = false;
        } else {
          fb.innerText = '✕ Username is already claimed';
          fb.style.color = '#ef4444';
          btn.disabled = true;
        }
      }
    </script>
  `;
  res.send(renderLayout('Account', content));
});

// Check availability against Supabase
app.get('/api/check-user', async (req, res) => {
  const user = (req.query.username || '').toLowerCase().trim();
  const { data } = await supabase.from('users').select('username').ilike('username', user).maybeSingle();
  res.json({ available: !data });
});

// Cloud Registration
app.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password;

  if (!username || !email || !password) return res.redirect('/auth');

  const { data: existing } = await supabase.from('users').select('id').ilike('username', username).maybeSingle();
  if (existing) {
    return res.send(renderLayout('Error', `<div class="card" style="text-align:center;"><h3>Username is already claimed</h3><p style="margin:16px 0;"><a href="/auth" class="btn">Try Again</a></p></div>`));
  }

  const { error } = await supabase.from('users').insert({
    username,
    email,
    password_hash: hashPassword(password)
  });

  if (error) return res.status(500).send('Database error: ' + error.message);

  req.session.user = username;
  res.redirect('/dashboard');
});

// Cloud Login
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

// 4. Cosmetics Studio
app.get('/dashboard', async (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/auth');

  const { data: user } = await supabase.from('users').select('*').ilike('username', req.session.user).maybeSingle();
  const skinExists = !!(user && user.skin_url);
  const capeExists = !!(user && user.cape_url);

  const content = `
    <div style="max-width: 650px; margin: 0 auto;">
      <h2 style="font-size: 2rem; margin-bottom: 8px;">Cosmetics Studio</h2>
      <p style="color: var(--dim); margin-bottom: 24px;">Configuring permanent cloud cosmetics for <b>${req.session.user}</b>.</p>

      <div class="card">
        <form action="/upload" method="post" enctype="multipart/form-data">
          <label style="display:block; font-size: 0.9rem; font-weight: 600; margin-bottom: 6px;">Skin Model Type</label>
          <select name="model" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); background:#0b0d13; color:#fff; margin-bottom:18px;">
            <option value="default" ${user && user.model === 'default' ? 'selected' : ''}>Classic 4-pixel arm (Steve)</option>
            <option value="slim" ${user && user.model === 'slim' ? 'selected' : ''}>Slim 3-pixel arm (Alex)</option>
          </select>

          <label style="display:block; font-size: 0.9rem; font-weight: 600; margin-bottom: 6px;">Skin Texture (.png)</label>
          <input type="file" name="skin" style="width:100%; margin-bottom:6px; color: var(--dim);">
          <div style="font-size: 0.8rem; color: ${skinExists ? '#22c55e' : '#9ca3af'}; margin-bottom: 18px;">
            ${skinExists ? '✓ Cloud-synced skin active' : 'No custom skin set'}
          </div>

          <label style="display:block; font-size: 0.9rem; font-weight: 600; margin-bottom: 6px;">Cape & Elytra (.png, optional)</label>
          <input type="file" name="cape" style="width:100%; margin-bottom:6px; color: var(--dim);">
          <div style="font-size: 0.8rem; color: ${capeExists ? '#22c55e' : '#9ca3af'}; margin-bottom: 24px;">
            ${capeExists ? '✓ Cloud-synced cape active' : 'No cape set'}
          </div>

          <button type="submit" class="btn" style="width: 100%; padding: 12px; font-size: 1rem;">Save to Cloud</button>
        </form>
      </div>
    </div>
  `;
  res.send(renderLayout('Dashboard', content, req.session.user));
});

// Upload direct to Supabase Storage
app.post('/upload', upload.fields([{ name: 'skin', maxCount: 1 }, { name: 'cape', maxCount: 1 }]), async (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/auth');

  const username = req.session.user;
  const model = req.body.model === 'slim' ? 'slim' : 'default';
  const updates = { model };

  if (req.files && req.files['skin'] && req.files['skin'][0]) {
    const file = req.files['skin'][0];
    const filePath = `skins/${username.toLowerCase()}_${Date.now()}.png`;
    const { data } = await supabase.storage.from('cosmetics').upload(filePath, file.buffer, { contentType: 'image/png', upsert: true });
    if (data) {
      const { data: publicData } = supabase.storage.from('cosmetics').getPublicUrl(filePath);
      updates.skin_url = publicData.publicUrl;
    }
  }

  if (req.files && req.files['cape'] && req.files['cape'][0]) {
    const file = req.files['cape'][0];
    const filePath = `capes/${username.toLowerCase()}_${Date.now()}.png`;
    const { data } = await supabase.storage.from('cosmetics').upload(filePath, file.buffer, { contentType: 'image/png', upsert: true });
    if (data) {
      const { data: publicData } = supabase.storage.from('cosmetics').getPublicUrl(filePath);
      updates.cape_url = publicData.publicUrl;
    }
  }

  await supabase.from('users').update(updates).ilike('username', username);
  res.redirect('/dashboard');
});

// 5. Yggdrasil API Session profile for launcher
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

app.listen(PORT, () => console.log(`AksuLauncher Portal connected to Supabase on port ${PORT}`));
