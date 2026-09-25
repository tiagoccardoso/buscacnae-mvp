import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

/**
 * JSON do mapa com gzip quando o navegador aceita (somente servidor).
 *
 * Com 10.000 empresas o JSON passa de 7 MB; comprimido fica em torno de 10%. A Vercel
 * comprime na borda, mas o `next start`/Docker (output standalone) não comprime Route
 * Handlers — por isso a compressão é feita aqui, só acima de 32 KB.
 */
const MIN_COMPRESS_BYTES = 32 * 1024;

export async function mapJsonResponse(request: Request, body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Accept-Encoding",
    ...init.headers
  };
  const accepts = /\bgzip\b/i.test(request.headers.get("accept-encoding") ?? "");
  const bytes = Buffer.byteLength(json);
  if (accepts && bytes >= MIN_COMPRESS_BYTES) {
    // Assíncrono: não bloqueia o event loop do servidor em respostas grandes.
    const compressed = await gzipAsync(json, { level: 6 });
    return new Response(new Uint8Array(compressed), {
      status: init.status ?? 200,
      headers: { ...headers, "Content-Encoding": "gzip", "Content-Length": String(compressed.byteLength) }
    });
  }
  return new Response(json, { status: init.status ?? 200, headers });
}
