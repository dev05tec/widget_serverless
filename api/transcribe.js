import Busboy from "busboy";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"];
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (!allowedOrigin) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin === allowedOrigin) res.setHeader("Access-Control-Allow-Origin", origin);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseAudio(req) {
  return new Promise((resolve, reject) => {
    let audio;
    let tooLarge = false;
    let invalid = false;
    let filename = "gravacao.webm";
    let mimeType = "audio/webm";
    let fileSeen = false;
    let settled = false;

    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_AUDIO_BYTES } });
    } catch {
      reject(new Error("Envie o áudio como multipart/form-data."));
      return;
    }

    parser.on("file", (fieldName, stream, info) => {
      if (fieldName !== "file" || fileSeen) {
        invalid = true;
        stream.resume();
        return;
      }
      fileSeen = true;
      filename = String(info.filename || filename).replace(/[\\/\r\n]/g, "_").slice(0, 120);
      mimeType = String(info.mimeType || mimeType).split(";", 1)[0].trim().toLowerCase();
      if (!/\.[a-z0-9]+$/i.test(filename)) {
        const extension = {
          "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3",
          "audio/mp4": "m4a", "audio/wav": "wav", "audio/flac": "flac",
        }[mimeType] || "webm";
        filename += `.${extension}`;
      }
      const chunks = [];
      let size = 0;
      stream.on("limit", () => { tooLarge = true; });
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size <= MAX_AUDIO_BYTES) chunks.push(chunk);
      });
      stream.on("end", () => { audio = Buffer.concat(chunks); });
    });

    parser.on("filesLimit", () => { invalid = true; });
    parser.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    parser.on("close", () => {
      if (settled) return;
      settled = true;
      if (tooLarge) return reject(Object.assign(new Error("O áudio excede o limite de 4 MB."), { status: 413 }));
      if (invalid || !fileSeen || !audio?.length) {
        return reject(new Error("Arquivo de áudio ausente, vazio ou inválido."));
      }
      resolve({ audio, filename, mimeType });
    });

    req.pipe(parser);
  });
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  setCors(req, res);
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && req.headers.origin && req.headers.origin !== allowedOrigin) {
    return sendJson(res, 403, { ok: false, error: "Origem não autorizada." });
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method === "GET") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, { ok: false, error: "Método não permitido." });
  }
  if (!process.env.GROQ_API_KEY) {
    return sendJson(res, 503, { ok: false, error: "A API de transcrição não está configurada." });
  }

  let uploaded;
  try {
    uploaded = await parseAudio(req);
  } catch (error) {
    const status = error.status || 400;
    const message = status === 413
      ? "O áudio excede o limite de 4 MB. Escolha um arquivo menor."
      : "Não foi possível ler o arquivo de áudio. Verifique o arquivo e tente novamente.";
    return sendJson(res, status, { ok: false, error: message });
  }

  let lastStatus = 502;
  for (const model of MODELS) {
    const form = new FormData();
    form.append("model", model);
    form.append("language", "pt");
    form.append("response_format", "json");
    form.append("temperature", "0");
    form.append("file", new Blob([uploaded.audio], { type: uploaded.mimeType }), uploaded.filename);

    let response;
    try {
      response = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      console.error("Groq transcription request failed:", error?.name || "UnknownError");
      continue;
    }

    if (response.ok) {
      const result = await response.json();
      const text = String(result.text || "").trim();
      if (!text) return sendJson(res, 502, { ok: false, error: "A API não retornou uma transcrição." });
      return sendJson(res, 200, { ok: true, text });
    }
    lastStatus = response.status;
    const providerError = await response.text().catch(() => "");
    console.error("Groq transcription failed:", {
      model,
      status: response.status,
      error: providerError.slice(0, 1000),
    });
    if (response.status !== 429) break;
  }

  return sendJson(res, lastStatus, { ok: false, error: "Não foi possível transcrever agora. Tente novamente." });
}
