# API serverless na Vercel

Esta pasta é a raiz do projeto para a Vercel. A função `api/transcribe.js`
recebe o campo `file` como `multipart/form-data`, chama a API de transcrição da
Groq e responde com `{ "ok": true, "text": "..." }`. A chave fica no ambiente
da Vercel.

## Publicar

1. Crie um projeto Vercel apontando o **Root Directory** para `serverless`.
2. Em **Settings → Environment Variables**, adicione `GROQ_API_KEY` com a chave
   da Groq. Opcionalmente, defina `ALLOWED_ORIGIN` com a origem do frontend.
3. Publique o projeto.
4. Configure `window.SECULLUM_IA_API_BASE_URL` no início de
   `frontend/index.html` com a URL base publicada. A página acrescenta
   `/api/transcribe` automaticamente.

A função oferece `GET /api/transcribe` para verificação e `POST /api/transcribe`
para enviar o áudio. O limite foi ajustado para 4 MB porque o corpo de uma
requisição de Vercel Function tem limite de 4,5 MB, incluindo o multipart.
Consulte [os limites das Functions](https://vercel.com/docs/functions/limitations).
