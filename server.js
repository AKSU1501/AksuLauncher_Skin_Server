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
        select { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2e3446; background:
