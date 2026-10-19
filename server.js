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
app.use(express.urlencoded({
