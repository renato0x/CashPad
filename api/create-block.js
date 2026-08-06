const admin = require('firebase-admin');

function parsePrivateKey(raw) {
  if (!raw) return undefined;
  let key = raw.trim();
  key = key.replace(/^"|"$/g, '');
  key = key.replace(/\\n/g, '\n');

  if (!key.includes('-----BEGIN')) return undefined;
  return key;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });
}

const db = admin.firestore();
const LOG_COLLECTION = 'block_creation_log';
const USERS_COLLECTION = 'users';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_CREATES_PER_WINDOW = 5;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, confirmDelete, deviceId } = req.body;

    if (!code || typeof code !== 'string' || !/^[A-Z0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: 'Codigo invalido' });
    }

    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 10) {
      return res.status(400).json({ error: 'Device ID invalido' });
    }

    const now = Date.now();
    const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS);

    const recentLogs = await db.collection(LOG_COLLECTION)
      .where('deviceId', '==', deviceId)
      .where('createdAt', '>', admin.firestore.Timestamp.fromDate(new Date(windowStart)))
      .get();

    if (recentLogs.size >= MAX_CREATES_PER_WINDOW) {
      return res.status(429).json({ error: 'Muitas criacoes. Aguarde um minuto.' });
    }

    const existingBlocks = await db.collection(LOG_COLLECTION)
      .where('deviceId', '==', deviceId)
      .get();

    const sorted = existingBlocks.docs.sort((a, b) => {
      const tA = a.data().createdAt?.toMillis?.() || 0;
      const tB = b.data().createdAt?.toMillis?.() || 0;
      return tA - tB;
    });

    if (sorted.length === 0) {
      await db.collection(LOG_COLLECTION).add({
        code,
        deviceId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection(USERS_COLLECTION).doc(code).set({
        people: [],
        expenses: [],
        settlements: [],
        theme: 'light',
      });

      return res.status(200).json({ success: true });
    }

    const existingDoc = sorted[0];
    const existingData = existingDoc.data();

    const userSnap = await db.collection(USERS_COLLECTION).doc(existingData.code).get();
    if (!userSnap.exists) {
      await existingDoc.ref.delete();
      await db.collection(LOG_COLLECTION).add({
        code,
        deviceId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection(USERS_COLLECTION).doc(code).set({
        people: [],
        expenses: [],
        settlements: [],
        theme: 'light',
      });
      return res.status(200).json({ success: true });
    }

    if (!confirmDelete) {
      return res.status(200).json({
        success: false,
        needsConfirm: true,
        existing: {
          code: existingData.code,
          createdAt: existingData.createdAt?.toDate?.()?.toISOString?.() || null,
        },
      });
    }

    if (confirmDelete !== existingData.code) {
      return res.status(400).json({ error: 'Codigo para deletar nao corresponde' });
    }

    await db.collection(USERS_COLLECTION).doc(existingData.code).delete();
    await existingDoc.ref.delete();

    await db.collection(LOG_COLLECTION).add({
      code,
      deviceId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection(USERS_COLLECTION).doc(code).set({
      people: [],
      expenses: [],
      settlements: [],
      theme: 'light',
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Create block error:', error.message, error.stack);
    return res.status(500).json({ error: 'Erro interno do servidor', detail: error.message });
  }
};
