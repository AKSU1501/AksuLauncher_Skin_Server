const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cookieSession = require('cookie-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
if (!fs.existsSync('keys')) fs.mkdirSync('keys');
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('data')) fs.mkdirSync('data');

const USERS_FILE = path.join('data', 'users.json');
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({}));
}

// Generate RSA keys if not present
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

// Storage for skins and capes
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const user = req.session.user.toLowerCase();
    if (file.fieldname === 'skin') {
      cb(null, `${user}_skin.png`);
    } else if (file.fieldname === 'cape') {
      cb(null, `${user}_cape.png`);
    } else {
      cb(null, `${user}_${file.originalname}`);
    }
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'aksu_session',
  keys: ['aksu-launcher-secret-key-salt'],
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
}));

app.use('/textures', express.static(path.join(__dirname, 'uploads')));

// Helper functions for user storage
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function getOfflineUUID(username) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

// Main page (Dashboard if logged in, Login/Register if guest)
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    const host = req.get('host');
    return res.json({
      meta: {
        serverName: "AksuSkinServer",
        implementationName: "AksuSkinServer",
        implementationVersion: "1.0.0"
      },
      skinDomains: [host],
      signaturePublickey: publicKey
    });
  }

  const currentUser = req.session ? req.session.user : null;

  if (!currentUser) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>AksuLauncher Accounts</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
          .card { background: #1a1d27; padding: 28px; border-radius: 12px; width: 100%; max-width: 380px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
          h2 { margin-top: 0; text-align: center; }
          label { display: block; margin-top: 12px; margin-bottom: 6px; font-size: 0.85rem; color: #9ca3af; }
          input { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2e3446; background: #0f1117; color: #fff; box-sizing: border-box; }
          button { width: 100%; margin-top: 18px; padding: 11px; border: none; border-radius: 6px; background: #3b82f6; color: #fff; font-weight: 600; cursor: pointer; }
          .toggle { text-align: center; margin-top: 16px; font-size: 0.85rem; color: #9ca3af; }
          .toggle a { color: #60a5fa; cursor: pointer; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="card" id="loginBox">
          <h2>Log In</h2>
          <form action="/login" method="post">
            <label>Username</label>
            <input type="text" name="username" required>
            <label>Password</label>
            <input type="password" name="password" required>
            <button type="submit">Sign In</button>
          </form>
          <div class="toggle">Don't have an account? <a onclick="toggle()">Register</a></div>
        </div>

        <div class="card" id="registerBox" style="display:none;">
          <h2>Create Account</h2>
          <form action="/register" method="post">
            <label>Minecraft Username</label>
            <input type="text" name="username" placeholder="Exact in-game name" required>
            <label>Email</label>
            <input type="email" name="email" required>
            <label>Password</label>
            <input type="password" name="password" required>
            <button type="submit">Register</button>
          </form>
          <div class="toggle">Already have an account? <a onclick="toggle()">Log In</a></div>
        </div>

        <script>
          function toggle() {
            const l = document.getElementById('loginBox');
            const r = document.getElementById('registerBox');
            l.style.display = l.style.display === 'none' ? 'block' : 'none';
            r.style.display = r.style.display === 'none' ? 'block' : 'none';
          }
        </script>
      </body>
      </html>
    `);
  }

  // Dashboard for logged-in user
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>AksuLauncher - ${currentUser}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
        .card { background: #1a1d27; padding: 28px; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
        h2 { margin-top: 0; text-align: center; }
        .user-tag { text-align: center; color: #60a5fa; font-size: 0.95rem; margin-bottom: 20px; }
        label { display: block; margin-top: 14px; margin-bottom: 6px; font-size: 0.85rem; color: #9ca3af; }
        select { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2e3446; background: #0f1117; color: #fff; box-sizing: border-box; }
        input[type="file"] { width: 100%; font-size: 0.85rem; color: #9ca3af; }
        button { width: 100%; margin-top: 20px; padding: 12px; border: none; border-radius: 6px; background: #3b82f6; color: #fff; font-weight: 600; cursor: pointer; }
        .logout { display: block; text-align: center; margin-top: 16px; color: #ef4444; text-decoration: none; font-size: 0.85rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Cosmetics Manager</h2>
        <div class="user-tag">Logged in as: <b>${currentUser}</b></div>
        <form action="/upload" method="post" enctype="multipart/form-data">
          <label>Skin Model</label>
          <select name="model">
            <option value="default">Classic 4px (Steve)</option>
            <option value="slim">Slim 3px (Alex)</option>
          </select>

          <label>Skin Texture (.png)</label>
          <input type="file" name="skin">

          <label>Cape / Elytra (.png, optional)</label>
          <input type="file" name="cape">

          <button type="submit">Save Cosmetics</button>
        </form>
        <a class="logout" href="/logout">Log Out</a>
      </div>
    </body>
    </html>
  `);
});

// Authentication routes
app.post('/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password;

  if (!username || !email || !password) {
    return res.status(400).send('All fields are required. <a href="/">Back</a>');
  }

  const users = loadUsers();
  const key = username.toLowerCase();

  if (users[key]) {
    return res.status(400).send('Username already claimed. <a href="/">Try another or Log In</a>');
  }

  users[key] = {
    username: username,
    email: email,
    passwordHash: hashPassword(password),
    registeredAt: Date.now()
  };
  saveUsers(users);

  req.session.user = username;
  res.redirect('/');
});

app.post('/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password;

  const users = loadUsers();
  const key = username.toLowerCase();
  const user = users[key];

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).send('Invalid username or password. <a href="/">Try again</a>');
  }

  req.session.user = user.username;
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// Handle cosmetic uploads
app.post('/upload', (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).redirect('/');
  }
  next();
}, upload.fields([{ name: 'skin', maxCount: 1 }, { name: 'cape', maxCount: 1 }]), (req, res) => {
  const username = req.session.user.toLowerCase();
  const model = req.body.model === 'slim' ? 'slim' : 'default';

  fs.writeFileSync(path.join('uploads', `${username}_meta.json`), JSON.stringify({ model }));

  res.send(`
    <body style="font-family:sans-serif;background:#0f1117;color:#fff;text-align:center;padding-top:50px;">
      <h3>Updated cosmetics for <b>${req.session.user}</b>!</h3>
      <p style="color:#9ca3af;">Launch AksuLauncher with username "${req.session.user}" to view your skin & cape in-game.</p>
      <a href="/" style="color:#3b82f6;text-decoration:none;">Dashboard</a>
    </body>
  `);
});

// Yggdrasil Session Profile endpoint (Skin + Cape + Elytra)
app.get('/sessionserver/session/minecraft/profile/:uuid', (req, res) => {
  const uuid = req.params.uuid.replace(/-/g, '').toLowerCase();

  const files = fs.readdirSync('uploads');
  let matchedUser = null;

  for (const f of files) {
    if (f.endsWith('_skin.png') || f.endsWith('_cape.png')) {
      const user = f.replace(/_(skin|cape)\.png$/, '');
      if (getOfflineUUID(user) === uuid) {
        matchedUser = user;
        break;
      }
    }
  }

  if (!matchedUser) return res.status(204).end();

  const host = req.get('host');
  const protocol = req.protocol;
  const textures = {};

  // Check skin
  const skinPath = path.join('uploads', `${matchedUser}_skin.png`);
  if (fs.existsSync(skinPath)) {
    let model = 'default';
    const metaPath = path.join('uploads', `${matchedUser}_meta.json`);
    if (fs.existsSync(metaPath)) {
      try {
        model = JSON.parse(fs.readFileSync(metaPath, 'utf8')).model || 'default';
      } catch (e) {}
    }

    textures.SKIN = {
      url: `${protocol}://${host}/textures/${matchedUser}_skin.png`
    };
    if (model === 'slim') {
      textures.SKIN.metadata = { model: 'slim' };
    }
  }

  // Check cape (Minecraft automatically maps this to elytra)
  const capePath = path.join('uploads', `${matchedUser}_cape.png`);
  if (fs.existsSync(capePath)) {
    textures.CAPE = {
      url: `${protocol}://${host}/textures/${matchedUser}_cape.png`
    };
  }

  const textureData = {
    timestamp: Date.now(),
    profileId: uuid,
    profileName: matchedUser,
    textures: textures
  };

  const base64Textures = Buffer.from(JSON.stringify(textureData)).toString('base64');
  const signer = crypto.createSign('SHA1');
  signer.update(base64Textures);
  const signature = signer.sign(privateKey, 'base64');

  res.json({
    id: uuid,
    name: matchedUser,
    properties: [
      {
        name: 'textures',
        value: base64Textures,
        signature: signature
      }
    ]
  });
});

app.listen(PORT, () => console.log(`AksuLauncher Skin & Cape Server running on port ${PORT}`));
