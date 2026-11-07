import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { GoogleGenAI } from '@google/genai';

const PORT = Number(process.env.PORT || 8787);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_BODY_BYTES = 1_600_000;
const DIST = join(process.cwd(), 'dist');
const CONTENT_TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const checkInResponseSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Warm, specific headline, maximum 55 characters.' },
    reassurance: { type: 'string', description: 'No diagnosis or promise; maximum 150 characters.' },
    photoObservation: { type: 'string', description: 'Photo observation with image limitation; maximum 100 characters.' },
    phase: { type: 'string', enum: ['consistency', 'adjustment', 'patience', 'review'] },
    roadmap: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', description: 'Action step, maximum 85 characters.' } },
    safetyFlag: { type: 'string', enum: ['none', 'monitor', 'contact_clinician', 'urgent_care'] },
    safetyMessage: { type: 'string', description: 'Safety guidance, maximum 120 characters.' },
    nextCheckIn: { type: 'string', description: 'Next check-in timing, maximum 60 characters.' }
  },
  required: ['headline', 'reassurance', 'photoObservation', 'phase', 'roadmap', 'safetyFlag', 'safetyMessage', 'nextCheckIn'],
  additionalProperties: false
};
const clean = (value, max = 280) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const sendJson = (res, status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };

function parseModelJson(response) {
  const raw = String(response?.text || '').trim();
  try { return JSON.parse(raw); } catch {
    const object = raw.match(/\{[\s\S]*\}/)?.[0];
    if (object) { try { return JSON.parse(object); } catch {} }
    console.error('[Gemini invalid structured response]', { raw: raw.slice(0, 800), finishReason: response?.candidates?.[0]?.finishReason });
    throw new Error('Gemini returned a response that did not match the required scanner format. Check the server terminal for details.');
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY_BYTES) { reject(new Error('Request is too large. Use a single compressed image under 1 MB.')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid request.')); } });
    req.on('error', reject);
  });
}

function compactJourney(journey = {}, products = []) {
  return {
    day: Math.min(730, Math.max(1, Number(journey.day) || 1)), lastApplied: clean(journey.lastApplied, 40),
    intendedRoutine: clean(journey.routine, 180), symptom: clean(journey.symptom), notes: clean(journey.notes),
    recentCheckIns: Array.isArray(journey.recentCheckIns) ? journey.recentCheckIns.slice(-5).map(item => ({ date: clean(item.date, 16), type: clean(item.type, 20), summary: clean(item.summary, 90) })) : [],
    recentEvaluations: Array.isArray(journey.evaluations) ? journey.evaluations.slice(-3).map(item => ({ date: clean(item.date, 16), headline: clean(item.headline, 80), phase: clean(item.phase, 30) })) : [],
    products: Array.isArray(products) ? products.slice(0, 6).map(product => ({ name: clean(product.name, 80), composition: clean(product.composition, 180), directions: clean(product.directions, 220), safety: clean(product.safety, 220), cadence: clean(product.cadence, 40) })) : []
  };
}

const systemSafety = 'You are Man Matters Companion: calm, friendly, optimistic and realistic. Address the user directly as “you.” Personalize from their day, intended routine, last application, notes, selected products and recent history only when helpful. Give a practical next step for today; never invent product facts or tell them to change a prescribed dose. Never promise regrowth, diagnose, claim visible microscopic hairs, or override product packaging or prescribers. You may say consistent routines often take months. Escalate chest pain, fainting, rapid heartbeat, severe swelling or allergy to urgent care. For persistent irritation or sudden, patchy, or unexplained hair loss, advise clinician contact. Use selected product directions and safety exactly. Do not provide hidden reasoning.';
function aiClient() { if (!process.env.GEMINI_API_KEY) throw new Error('Server setup needed: GEMINI_API_KEY is not configured.'); return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); }

async function checkIn(body) {
  if (!/^[A-Za-z0-9+/=]+$/.test(body.imageBase64 || '') || body.imageBase64.length > 1_450_000) throw new Error('Please upload one valid compressed image.');
  const journey = compactJourney(body.journey, body.products);
  const response = await aiClient().models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: `USER JOURNEY=${JSON.stringify(journey)}\nGive one concise, caring check-in from this photo. Use the user's exact selected products and intended routine to make the three steps useful today. Refer to their day or recent trend only if it clarifies the advice. State a photo limitation rather than guessing.` }, { inlineData: { mimeType: 'image/jpeg', data: body.imageBase64 } }] }],
    config: { systemInstruction: `${systemSafety} Use concise language and populate every response field.`, responseMimeType: 'application/json', responseSchema: checkInResponseSchema, thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 1024 }
  });
  return parseModelJson(response);
}

async function chat(body) {
  const journey = compactJourney(body.journey, body.products);
  const message = clean(body.message, 500);
  if (!message) throw new Error('Write a question for your companion.');
  const history = Array.isArray(body.history) ? body.history.slice(-6).map(item => `${item.role === 'assistant' ? 'COMPANION' : 'USER'}: ${clean(item.text, 360)}`).join('\n') : '';
  const response = await aiClient().models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: `USER JOURNEY=${JSON.stringify(journey)}\nRECENT CONVERSATION:\n${history}\nUSER: ${message}\nReply in under 90 words as a continuation of this user's journey. Be kind, practical and specific to their selected products, routine and day when relevant. Do not repeat their full regimen. If safety escalation applies, lead with it.` }] }],
    config: { systemInstruction: systemSafety, thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 512 }
  });
  const reply = clean(response.text, 1100);
  if (!reply) {
    const finishReason = response?.candidates?.[0]?.finishReason || 'unknown';
    console.error('[Gemini empty chat response]', { finishReason, usage: response?.usageMetadata });
    throw new Error(`Gemini did not return a follow-up answer (finish reason: ${finishReason}). Please try again.`);
  }
  return { reply };
}

async function staticFile(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const localPath = normalize(join(DIST, requestPath === '/' ? 'index.html' : requestPath));
  const safePath = localPath.startsWith(DIST) && existsSync(localPath) ? localPath : join(DIST, 'index.html');
  if (!existsSync(safePath)) return sendJson(res, 404, { error: 'App has not been built yet. Run npm run build.' });
  res.writeHead(200, { 'Content-Type': `${CONTENT_TYPES[extname(safePath)] || 'application/octet-stream'}; charset=utf-8` });
  createReadStream(safePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') return sendJson(res, 200, { status: 'ok', model: GEMINI_MODEL, keyConfigured: Boolean(process.env.GEMINI_API_KEY) });
    if (req.method === 'POST' && req.url === '/api/checkin') return sendJson(res, 200, await checkIn(await readJson(req)));
    if (req.method === 'POST' && req.url === '/api/chat') return sendJson(res, 200, await chat(await readJson(req)));
    if (req.method === 'GET') return staticFile(req, res);
    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('[Gemini request failed]', error?.cause?.message || error?.message || error);
    const status = Number.isInteger(error?.status) ? error.status : error?.message === 'fetch failed' ? 502 : 400;
    return sendJson(res, status, { error: error?.message || 'Request failed.', model: GEMINI_MODEL });
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use by another process.`);
    console.error('If it is an older Man Matters Companion server, stop it with: npm.cmd run server:stop');
    console.error(`Then start this server again with: npm.cmd run server\n`);
  } else {
    console.error('Server failed to start:', error);
  }
  process.exitCode = 1;
});

server.listen(PORT, () => console.log(`Man Matters Companion running at http://localhost:${PORT}`));
