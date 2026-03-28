import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const APP_SECRET = process.env.APP_SECRET || 'change-me-in-env';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DEFAULT_WALLET_BALANCE = Number(process.env.DEFAULT_WALLET_BALANCE || 150);
const OXAPAY_API_BASE = process.env.OXAPAY_API_BASE || 'https://api.oxapay.com';
const OXAPAY_MERCHANT_API_KEY = process.env.OXAPAY_MERCHANT_API_KEY || '';
const OXAPAY_CALLBACK_URL = process.env.OXAPAY_CALLBACK_URL || `${PUBLIC_BASE_URL}/api/oxapay/webhook`;
const OXAPAY_RETURN_URL = process.env.OXAPAY_RETURN_URL || `${PUBLIC_BASE_URL}/abonnement.html`;
const OXAPAY_SANDBOX = String(process.env.OXAPAY_SANDBOX || 'true').toLowerCase() === 'true';

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'db.json');

const POWER_CATALOG = {
  vision: { name: 'Vision', priceUsd: 10, unitsPerPurchase: 2, emoji: '👀' },
  freeze: { name: 'Gel', priceUsd: 20, unitsPerPurchase: 2, emoji: '❄️' },
  second_chance: { name: 'Seconde Chance', priceUsd: 60, unitsPerPurchase: 2, emoji: '🍀' },
  shield: { name: 'Bouclier', priceUsd: 3, unitsPerPurchase: 2, emoji: '🛡️' }
};

function ensureDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    const initialState = { users: [], purchases: [] };
    fs.writeFileSync(dbPath, JSON.stringify(initialState, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function createEmptyPowers() {
  return Object.keys(POWER_CATALOG).reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    walletBalance: Number(user.walletBalance.toFixed(2)),
    powers: user.powers,
    createdAt: user.createdAt
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = storedHash.split(':');
  const currentHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeEqualStrings(currentHash, expectedHash);
}

function safeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) {
    return null;
  }
  const [body, signature] = token.split('.');
  const expectedSignature = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
  if (!safeEqualStrings(signature, expectedSignature)) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || Date.now() > payload.exp) {
    return null;
  }
  return payload;
}

function createAuthToken(user) {
  return signToken({
    userId: user.id,
    username: user.username,
    exp: Date.now() + (7 * 24 * 60 * 60 * 1000)
  });
}

function getAuthToken(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return null;
  }
  return authorization.slice('Bearer '.length);
}

function authRequired(req, res, next) {
  const token = getAuthToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  const db = readDb();
  const user = db.users.find((item) => item.id === payload.userId);
  if (!user) {
    return res.status(401).json({ error: 'Utilisateur introuvable.' });
  }

  req.user = user;
  req.db = db;
  next();
}

function normalizePowerKey(powerKey) {
  return String(powerKey || '').trim().toLowerCase();
}

function buildPowerResponse(user) {
  return {
    walletBalance: Number(user.walletBalance.toFixed(2)),
    powers: user.powers,
    catalog: POWER_CATALOG
  };
}

function createPurchase({ userId, powerKey, provider }) {
  const catalog = POWER_CATALOG[powerKey];
  return {
    id: crypto.randomUUID(),
    orderId: `ghostr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    powerKey,
    powerName: catalog.name,
    provider,
    status: provider === 'wallet' ? 'paid' : 'pending',
    units: catalog.unitsPerPurchase,
    priceUsd: catalog.priceUsd,
    oxapayTrackId: null,
    paymentUrl: null,
    rawWebhook: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function createOxaPayInvoice(purchase, username) {
  const response = await fetch(`${OXAPAY_API_BASE}/v1/payment/invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      merchant_api_key: OXAPAY_MERCHANT_API_KEY
    },
    body: JSON.stringify({
      amount: purchase.priceUsd,
      currency: 'USD',
      lifetime: 60,
      fee_paid_by_payer: 0,
      under_paid_coverage: 0,
      mixed_payment: false,
      callback_url: OXAPAY_CALLBACK_URL,
      return_url: OXAPAY_RETURN_URL,
      order_id: purchase.orderId,
      description: `${purchase.powerName} for ${username}`,
      sandbox: OXAPAY_SANDBOX
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data?.payment_url) {
    const errorMessage = payload?.message || 'Impossible de créer la facture OxaPay.';
    throw new Error(errorMessage);
  }

  return payload.data;
}

app.use(cors());
app.post('/api/oxapay/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!OXAPAY_MERCHANT_API_KEY) {
    return res.status(503).send('missing merchant api key');
  }

  const rawBody = req.body.toString('utf8');
  const hmacHeader = req.headers.hmac;
  const expectedHmac = crypto.createHmac('sha512', OXAPAY_MERCHANT_API_KEY).update(rawBody).digest('hex');

  if (typeof hmacHeader !== 'string' || !safeEqualStrings(hmacHeader, expectedHmac)) {
    return res.status(400).send('invalid hmac');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return res.status(400).send('invalid json');
  }

  const db = readDb();
  const purchase = db.purchases.find((item) => item.orderId === payload.order_id || item.oxapayTrackId === payload.track_id);
  if (!purchase) {
    return res.status(200).send('ok');
  }

  purchase.oxapayTrackId = payload.track_id || purchase.oxapayTrackId;
  purchase.rawWebhook = payload;
  purchase.updatedAt = new Date().toISOString();

  const normalizedStatus = String(payload.status || '').toLowerCase();
  if (normalizedStatus === 'paid' && purchase.status !== 'paid') {
    const user = db.users.find((item) => item.id === purchase.userId);
    if (user) {
      user.powers[purchase.powerKey] += purchase.units;
      purchase.status = 'paid';
    }
  } else {
    purchase.status = normalizedStatus || purchase.status;
  }

  writeDb(db);
  return res.status(200).send('ok');
});

app.use(express.json());

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Nom utilisateur >= 3 caractères et mot de passe >= 6 caractères.' });
  }

  const db = readDb();
  const existingUser = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (existingUser) {
    return res.status(409).json({ error: 'Nom utilisateur déjà utilisé.' });
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    walletBalance: DEFAULT_WALLET_BALANCE,
    powers: createEmptyPowers(),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  writeDb(db);

  return res.status(201).json({
    token: createAuthToken(user),
    user: sanitizeUser(user)
  });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const db = readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  return res.json({
    token: createAuthToken(user),
    user: sanitizeUser(user)
  });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/get-powers', authRequired, (req, res) => {
  res.json(buildPowerResponse(req.user));
});

app.post('/api/use-power', authRequired, (req, res) => {
  const powerKey = normalizePowerKey(req.body.powerKey);
  if (!POWER_CATALOG[powerKey]) {
    return res.status(400).json({ error: 'Pouvoir inconnu.' });
  }

  if (req.user.powers[powerKey] <= 0) {
    return res.status(400).json({ error: 'Aucune unité disponible pour ce pouvoir.' });
  }

  req.user.powers[powerKey] -= 1;
  writeDb(req.db);
  return res.json({
    message: `${POWER_CATALOG[powerKey].name} activé.`,
    ...buildPowerResponse(req.user)
  });
});

app.post('/api/buy-power', authRequired, async (req, res) => {
  const powerKey = normalizePowerKey(req.body.powerKey);
  const paymentMethod = String(req.body.paymentMethod || '').trim().toLowerCase();

  if (!POWER_CATALOG[powerKey]) {
    return res.status(400).json({ error: 'Pouvoir inconnu.' });
  }

  if (!['wallet', 'oxapay'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Méthode de paiement invalide.' });
  }

  const purchase = createPurchase({ userId: req.user.id, powerKey, provider: paymentMethod });
  req.db.purchases.push(purchase);

  if (paymentMethod === 'wallet') {
    if (req.user.walletBalance < purchase.priceUsd) {
      req.db.purchases = req.db.purchases.filter((item) => item.id !== purchase.id);
      return res.status(400).json({ error: 'Solde wallet insuffisant.' });
    }

    req.user.walletBalance = Number((req.user.walletBalance - purchase.priceUsd).toFixed(2));
    req.user.powers[powerKey] += purchase.units;
    writeDb(req.db);

    return res.json({
      status: 'paid',
      provider: 'wallet',
      purchaseId: purchase.id,
      ...buildPowerResponse(req.user)
    });
  }

  if (!OXAPAY_MERCHANT_API_KEY || !OXAPAY_CALLBACK_URL || !OXAPAY_RETURN_URL) {
    req.db.purchases = req.db.purchases.filter((item) => item.id !== purchase.id);
    return res.status(503).json({
      error: 'Configuration OxaPay incomplète.',
      required: ['OXAPAY_MERCHANT_API_KEY', 'OXAPAY_CALLBACK_URL', 'OXAPAY_RETURN_URL']
    });
  }

  try {
    const invoice = await createOxaPayInvoice(purchase, req.user.username);
    purchase.oxapayTrackId = invoice.track_id || null;
    purchase.paymentUrl = invoice.payment_url || null;
    writeDb(req.db);

    return res.status(201).json({
      status: 'pending',
      provider: 'oxapay',
      purchaseId: purchase.id,
      orderId: purchase.orderId,
      trackId: purchase.oxapayTrackId,
      paymentUrl: purchase.paymentUrl,
      ...buildPowerResponse(req.user)
    });
  } catch (error) {
    req.db.purchases = req.db.purchases.filter((item) => item.id !== purchase.id);
    return res.status(502).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'GhostR.html'));
});

app.get('/shop', (req, res) => {
  res.sendFile(path.join(__dirname, 'abonnement.html'));
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  ensureDb();
  console.log(`GhostR backend listening on ${PUBLIC_BASE_URL}`);
});
