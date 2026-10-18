const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Generate RSA keys if not present
if (!fs.existsSync('keys')) {
  fs.mkdirSync('keys');
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

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const user = (req.body.username || 'unknown').toLowerCase().trim();
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
app.use('/textures', express.static(path.join(__dirname, 'uploads')));

// Upload UI with Skin, Cape, and Model options
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
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>AksuLauncher Cosmetics</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: #1a1d27; padding: 28px; border-radius: 12px; width: 100%; max-width: 380px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); box-sizing: border-box; }
        h2 { margin-top: 0; text-align: center; font-size: 1.4rem; }
        label { display: block; margin-top: 14px; margin-bottom: 6px; font-size: 0.85rem; color: #9ca3af; }
        input[type="text"], select { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #2e3446; background: #0f1117; color: #fff; box-sizing: border-box; }
        input[type="file"] { width: 100%; font-size: 0.85rem; color: #9ca3af; margin-bottom: 4px; }
        button { width: 100%; margin-top: 22px; padding: 12px; border: none; border-radius: 6px; background: #3b82f6; color: #fff; font-weight: 600; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #2563eb; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>AksuLauncher Cosmetics</h2>
        <form action="/upload" method="post" enctype="multipart/form-data">
          <label>Minecraft Username</label>
          <input type="text" name="username" placeholder="Exact in-game username" required>
          
          <label>Skin Model</label>
          <select name="model">
            <option value="default">Classic 4px (Steve)</option>
            <option value="slim">Slim 3px (Alex)</option>
          </select>

          <label>Skin File (.png)</label>
          <input type="file" name="skin" accept=".png">

          <label>Cape / Elytra File (.png, optional)</label>
          <input type="file" name="cape" accept=".png">

          <button type="submit">Save Cosmetics</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Handle multi-part upload for skin + cape + model metadata
app.post('/upload', upload.fields([{ name: 'skin', maxCount: 1 }, { name: 'cape', maxCount: 1 }]), (req, res) => {
  const username = (req.body.username || '').toLowerCase().trim();
  const model = req.body.model === 'slim' ? 'slim' : 'default';

  if (!username) {
    return res.status(400).send('Username is required.');
  }

  // Store model selection
  fs.writeFileSync(path.join('uploads', `${username}_meta.json`), JSON.stringify({ model }));

  res.send(`
    <body style="font-family:sans-serif;background:#0f1117;color:#fff;text-align:center;padding-top:50px;">
      <h3>Updated cosmetics for <b>${req.body.username}</b>!</h3>
      <p style="color:#9ca3af;">Launch or restart AksuLauncher to apply the skin and cape.</p>
      <a href="/" style="color:#3b82f6;text-decoration:none;">Go Back</a>
    </body>
  `);
});

// Calculate offline UUID
function getOfflineUUID(username) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

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

  // Check cape (Minecraft uses the cape texture automatically for elytra)
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

app.listen(PORT, () => console.log(`Skin and cape server running on port ${PORT}`));
