import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/main.ts"], bundle: true, outfile: "dist/main.js",
  target: "es2017", format: "iife", sourcemap: true, logLevel: "info",
  define: { __WS_URL__: JSON.stringify(process.env.GAMESUBS_WS_URL ?? "ws://192.168.1.100:8765") },
});
cpSync("static", "dist", { recursive: true });

// Minimal 117x117 düz renkli PNG ikon (harici bağımlılık yok).
const N = 117, raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; for (let x = 0; x < N; x++) raw.set([26, 115, 232, 255], y * (N * 4 + 1) + 1 + x * 4); }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync("dist/icon.png", Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log("dist/ hazır (Tizen Studio'da bu klasörü import edin)");
