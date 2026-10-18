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
    cb(null, `${user}.png`);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/textures', express.static(path.join(__dirname, 'uploads')));

// Metadata & Upload UI
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
    <head><title>AksuLauncher Skins</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="font-family:sans-serif;max-width:400px;margin:40px auto;padding:20px;text-align:center;">
      <h2>Upload Minecraft Skin</h2>
      <form action="/upload" method="post" enctype="multipart/form-data">
        <input type="text" name="username" placeholder="Minecraft Username" required style="width:100%;padding:10px;margin-bottom:12px;box-sizing:border-box;"><br>
        <input type="file" name="skin" accept=".png" required style="margin-bottom:16px;"><br>
        <button type="submit" style="padding:10px 20px;background:#0070f3;color:#fff;border:none;border-radius:4px;cursor:pointer;">Upload Skin</button>
      </form>
    </body>
    </html>
  `);
});

// Handle skin uploads
app.post('/upload', upload.single('skin'), (req, res) => {
  const username = (req.body.username || '').trim();
  res.send(`<p>Skin uploaded for <b>${username}</b>! Launch the game to view it.</p><a href="/">Back</a>`);
});

// Compute offline UUID
function getOfflineUUID(username) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

// Yggdrasil Session Profile endpoint
app.get('/sessionserver/session/minecraft/profile/:uuid', (req, res) => {
  const uuid = req.params.uuid.replace(/-/g, '').toLowerCase();

  const files = fs.readdirSync('uploads').filter(f => f.endsWith('.png'));
  let matchedUser = null;
  for (const f of files) {
    const user = f.replace('.png', '');
    if (getOfflineUUID(user) === uuid) {
      matchedUser = user;
      break;
    }
  }

  if (!matchedUser) return res.status(204).end();

  const host = req.get('host');
  const protocol = req.protocol;
  const textureUrl = `${protocol}://${host}/textures/${matchedUser}.png`;

  const textureData = {
    timestamp: Date.now(),
    profileId: uuid,
    profileName: matchedUser,
    textures: {
      SKIN: {
        url: textureUrl
      }
    }
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

app.listen(PORT, () => console.log(`Skin server running on port ${PORT}`));
