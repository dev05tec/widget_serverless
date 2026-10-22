const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = Math.ceil((MAX_AUDIO_BYTES + MAX_TRANSCRIPT_BYTES) * 4 / 3) + 4096;
const ALLOWED_HOSTS = new Set([
  "uploads-tiflux.s3.amazonaws.com",
  "uploads-tiflux.s3.sa-east-1.amazonaws.com",
]);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function parseAudioText(text) {
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    throw Object.assign(new Error("Arquivo muito grande."), { status: 413 });
  }
  const match = text.match(/^TIFLUX_AUDIO_V(1|2)\r?\nMIME: ([^\r\n]+)\r?\nFILENAME: ([^\r\n]+)\r?\n(?:TRANSCRIPT_BASE64: ([^\r\n]*)\r?\n)?BASE64: ([\s\S]*)$/);
  if (!match) throw Object.assign(new Error("Formato de áudio inválido."), { status: 422 });
  if ((match[1] === "2") !== (match[4] !== undefined)) {
    throw Object.assign(new Error("Transcrição ausente ou formato inválido."), { status: 422 });
  }

  const mime = match[2].trim().toLowerCase();
  if (!/^audio\/[a-z0-9.+-]+$/.test(mime)) {
    throw Object.assign(new Error("Tipo de áudio inválido."), { status: 422 });
  }
  const filename = match[3].trim().replace(/[\\/\r\n";]/g, "_").slice(0, 120) || "audio.webm";
  const base64 = match[5].replace(/\s/g, "");
  if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw Object.assign(new Error("Base64 inválido."), { status: 422 });
  }
  const audio = Buffer.from(base64, "base64");
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) {
    throw Object.assign(new Error("Áudio vazio ou acima de 4 MB."), { status: 413 });
  }
  const transcript64 = match[4] || "";
  if (transcript64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(transcript64)) {
    throw Object.assign(new Error("Transcrição inválida."), { status: 422 });
  }
  const transcriptBytes = Buffer.from(transcript64, "base64");
  if (transcriptBytes.length > MAX_TRANSCRIPT_BYTES) {
    throw Object.assign(new Error("Transcrição muito grande."), { status: 413 });
  }
  const transcript = transcriptBytes.toString("utf8");
  return { audio, mime, filename, transcript };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) {
    res.setHeader("Vary", "Origin");
    if (origin && origin !== allowedOrigin) return json(res, 403, { ok: false, error: "Origem não autorizada." });
    if (origin === allowedOrigin) res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return json(res, 405, { ok: false, error: "Método não permitido." });
  }

  let url;
  try {
    url = new URL(req.body?.url);
  } catch {
    return json(res, 400, { ok: false, error: "URL do arquivo inválida." });
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.port || !url.pathname.toLowerCase().endsWith(".txt")) {
    return json(res, 400, { ok: false, error: "URL do arquivo não autorizada." });
  }

  try {
    const upstream = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(25_000) });
    if (!upstream.ok) return json(res, upstream.status === 404 ? 404 : 502, { ok: false, error: "Não foi possível obter o arquivo de áudio." });
    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > MAX_TEXT_BYTES) return json(res, 413, { ok: false, error: "Arquivo de áudio acima do limite permitido." });
    const text = await upstream.text();
    const { audio, mime, filename, transcript } = parseAudioText(text);
    if (req.body?.format === "metadata") {
      return json(res, 200, { mime, filename, transcript });
    }
    // Mantém a resposta JSON abaixo do limite da Vercel; áudios maiores seguem em bytes.
    if (req.body?.format === "base64" && audio.length <= 3 * 1024 * 1024) {
      return json(res, 200, { mime, filename, transcript, base64: audio.toString("base64") });
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(audio.length));
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.end(audio);
  } catch (error) {
    if (error.status) return json(res, error.status, { ok: false, error: error.message });
    return json(res, 502, { ok: false, error: "Não foi possível obter o arquivo de áudio." });
  }
}
