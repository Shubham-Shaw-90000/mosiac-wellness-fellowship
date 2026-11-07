const MAX_DIMENSION = 640;
const JPEG_QUALITY = 0.68;

// Image pixels, EXIF, alpha and unused whitespace never reach Gemini.
export function compressImageForGemini(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { base64: canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] };
}

async function companionRequest(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The companion could not complete this request.');
  return data;
}

// The browser sends compact context to our server; only the server holds GEMINI_API_KEY.
export const runJourneyCheckIn = (payload) => companionRequest('/api/checkin', payload);
export const askJourneyFollowUp = (payload) => companionRequest('/api/chat', payload);
