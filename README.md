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

## Reproduzir áudio de TXT estruturado

`POST /api/audio-from-txt` recebe `{ "url": "https://uploads-tiflux.s3.amazonaws.com/.../audio.txt?..." }`.
A função busca o TXT no servidor (evitando o CORS do navegador), valida o formato
`TIFLUX_AUDIO_V1` ou `TIFLUX_AUDIO_V2`, decodifica o campo `BASE64` e responde com os bytes do áudio e
o MIME informado no arquivo. O player do frontend usa essa rota para mostrar o
áudio no chat. Por segurança, só aceita HTTPS nos hosts `uploads-tiflux.s3.amazonaws.com`
e `uploads-tiflux.s3.sa-east-1.amazonaws.com`, não segue redirecionamentos e limita
o áudio a 4 MB. `ALLOWED_ORIGIN` também se
aplica a esta rota.

O widget inclui o áudio em um arquivo `.txt` na fila nativa de anexos. No formato
V2, o campo `TRANSCRIPT_BASE64` contém a transcrição em UTF-8 codificada em Base64.
O widget reproduz somente o áudio; a extensão exibe também a transcrição no Tiflux.
Para obter a transcrição, envie `format: "metadata"` junto da URL: a resposta será
`{ "mime": "audio/webm", "filename": "gravacao.webm", "transcript": "..." }`.
Publique a versão atualizada desta função junto com o frontend e recarregue a extensão.
