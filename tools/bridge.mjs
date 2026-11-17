// GameSubs köprüsü: gl-ocr (OCR) → çeviri sağlayıcısı (akışlı) → WebSocket (TV).
// Kullanım: node tools/bridge.mjs [--provider <ad>] [--model <kimlik>] [--base-url <url>] [--list-models]
//                                 [--app RemotePlay] [--region 0.65,1.0] [--port 8765] [--hold 600] [--strict | --all]
//                                 [--panel-port 8766 | --no-panel]
//   Mac paneli: http://localhost:8766 (yalnızca bu Mac'ten erişilir) — altyazı aç/kapat, duraklat, görünüm, filtre,
//   sağlayıcı değiştirme ve canlı altyazı geçmişi.
//   Sağlayıcılar: ollama (yerel), openai, anthropic, gemini, openrouter, groq, deepseek, mistral, lmstudio, custom
//   Sağlayıcı verilmezse: OPENAI_API_KEY → openai, ANTHROPIC_API_KEY → anthropic, yoksa yerel ollama.
//   Ortam değişkeni karşılıkları: GAMESUBS_PROVIDER, GAMESUBS_MODEL, GAMESUBS_BASE_URL.
//   Ek istek alanı (OpenAI uyumlular): --extra '{"temperature":0.2}'
// Anahtarlar yalnızca ortam değişkenlerinden okunur; günlüğe yazılmaz.
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { PRESETS, autoProvider, createTranslator, ollamaReachable } from "./providers/index.mjs";
import { startPanel } from "./panel/server.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const APP = opt("--app", "RemotePlay"), REGION = opt("--region", "0.65,1.0");
const PORT = Number(opt("--port", "8765"));
const HOLD_MS = Number(opt("--hold", "600"));      // cümle sonu işareti yoksa devam parçası için bekleme
let ALL = args.includes("--all");                  // tüm metni çevir (yalnızca düğme filtresi kalır) — panelden değişebilir
let STRICT = args.includes("--strict");            // yalnızca "Ad: metin" biçimli satırları çevir — panelden değişebilir
const PANEL_PORT = Number(opt("--panel-port", "8766"));

// --- Çeviri sağlayıcısı ---
let EXTRA = {}; try { EXTRA = JSON.parse(opt("--extra", "{}")); } catch { console.error("--extra geçerli JSON değil"); process.exit(1); }
const PROVIDER = opt("--provider", process.env.GAMESUBS_PROVIDER || autoProvider());
let primary;
try {
  primary = createTranslator({ provider: PROVIDER, model: opt("--model", process.env.GAMESUBS_MODEL), baseUrl: opt("--base-url", undefined), extra: EXTRA });
} catch (e) {
  console.error("Sağlayıcı ayarlanamadı: " + e.message + "\nSağlayıcılar: " + Object.entries(PRESETS).map(([k, v]) => k + (v.model ? ` (varsayılan ${v.model})` : "")).join(", "));
  process.exit(1);
}
if (args.includes("--list-models")) {
  try { console.log((await primary.listModels()).join("\n")); process.exit(0); }
  catch (e) { console.error("Model listesi alınamadı: " + e.message); process.exit(1); }
}
// Uzak sağlayıcı hata verirse yerel modele düş (Ollama çalışıyorsa).
let local = PROVIDER === "ollama" ? null : (await ollamaReachable()) ? createTranslator({ provider: "ollama" }) : null;
if (PROVIDER === "ollama" && !(await ollamaReachable())) { console.error("Ollama çalışmıyor (localhost:11434). 'ollama serve' başlat ya da bir bulut sağlayıcısı seç."); process.exit(1); }
console.log(`Çeviri: ${primary.name}` + (local ? `  (hata olursa yedek: ${local.name})` : PROVIDER === "ollama" ? "" : "  (yerel yedek yok: Ollama çalışmıyor)"));

let primaryFailures = 0;
async function translate(text, signal, onPartial, t0) {
  let firstMs = null;
  const partial = (p) => { if (firstMs === null) firstMs = Date.now() - t0; onPartial(p.trim().replace(/^["“]/, "")); };
  const req = { text, context: history, signal, onPartial: throttle(partial) };
  if (primaryFailures < 3 || !local) {
    try { const out = await primary.translate(req); primaryFailures = 0; return { text: out, firstMs, by: primary.name }; }
    catch (e) {
      if (e.name === "AbortError" || signal.aborted) throw e;
      primaryFailures++;
      if (!local) throw e;
      console.error(`${e.message}\n  → yerel modele düşülüyor (${primaryFailures}/3)`);
    }
  }
  return { text: await local.translate(req), firstMs, by: local.name };
}
/** Kısmi metni TV'ye en fazla ~10 kez/sn gönder. */
function throttle(fn, ms = 100) { let last = 0; return (v) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(v); } }; }

// Tek örnek kilidi: iki köprü/OCR aynı pencereyi yakalamaya çalışırsa yakalama kilitlenir.
const LOCK = new URL("../build/bridge.pid", import.meta.url).pathname;
if (existsSync(LOCK)) {
  const old = Number(readFileSync(LOCK, "utf8"));
  let alive = false; try { process.kill(old, 0); alive = true; } catch { /* süreç yok: eski kilit */ }
  if (alive) { console.error(`Köprü zaten çalışıyor (pid ${old}). Önce onu durdur.`); process.exit(2); }
}
writeFileSync(LOCK, String(process.pid));

const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });
let last = null;
/** TV'ye gönder. Altyazı mesajları yeni bağlanan TV için de saklanır. */
const send = (o) => { if (o.type === "subtitle" || o.type === "clear") last = o; const s = JSON.stringify(o); wss.clients.forEach((c) => c.readyState === 1 && c.send(s)); };
wss.on("connection", (ws, req) => {
  console.log("TV bağlandı:", req.socket.remoteAddress);
  if (last?.type === "subtitle") ws.send(JSON.stringify(last));
  ws.on("message", (m) => {
    let o; try { o = JSON.parse(String(m)); } catch { return; }
    if (o?.type === "tvstate" && o.subtitle) { tvStyle = o.subtitle; pushState(); }   // TV'nin güncel altyazı ayarları
  });
  ws.on("close", () => { if (wss.clients.size === 0) tvStyle = null; pushState(); });
  pushState();
});
const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
console.log(`WS dinleniyor :${PORT} → ` + ips.map((ip) => `ws://${ip}:${PORT}`).join("  "));

// --- Mac paneli: durum, altyazı geçmişi, komutlar ---
let paused = false, tvStyle = null, ocrStatus = "başlıyor", lastError = null, entryId = 0;
const LOG_MAX = 300, log = [];
/** Geçmişe kayıt: {en, tr?, by?, ms?, firstMs?, cached?, skipped?, error?} */
function addEntry(e) {
  Object.assign(e, { id: ++entryId, t: Date.now() });
  log.push(e); if (log.length > LOG_MAX) log.shift();
  panel?.broadcast({ type: "entry", item: e });
}
const stateObj = () => ({
  tvClients: wss.clients.size, tvStyle, ocr: ocrStatus, paused, lastError,
  filter: ALL ? "all" : STRICT ? "strict" : "normal",
  provider: primary.name, fallback: local?.name ?? null, providers: Object.keys(PRESETS),
});
function pushState() { panel?.broadcast({ type: "state", state: stateObj() }); }

const STYLE_KEYS = { visible: "boolean", fontPx: "number", bottomPct: "number", bg: "string" };
async function onPanelCommand(c) {
  switch (c.cmd) {
    case "tvVisible": send({ type: "config", subtitle: { visible: !!c.value } }); break;
    case "style": {
      const sub = {};
      for (const [k, t] of Object.entries(STYLE_KEYS)) if (typeof c.value?.[k] === t) sub[k] = c.value[k];
      send({ type: "config", subtitle: sub });
      break;
    }
    case "pause":
      paused = !!c.value;
      if (paused) { seq++; abort?.abort(); if (pending) { clearTimeout(pending.timer); pending = null; } send({ type: "clear" }); }
      console.log(paused ? "Çeviri duraklatıldı (panel)" : "Çeviri devam ediyor (panel)");
      break;
    case "filter": ALL = c.value === "all"; STRICT = c.value === "strict"; break;
    case "provider":
      try {
        primary = createTranslator({ provider: c.provider, model: c.model || undefined, baseUrl: c.baseUrl || undefined, extra: EXTRA });
        primaryFailures = 0; lastError = null;
        local = c.provider === "ollama" ? null : (await ollamaReachable()) ? createTranslator({ provider: "ollama" }) : null;
        console.log(`Çeviri sağlayıcısı değişti (panel): ${primary.name}`);
      } catch (e) { lastError = "Sağlayıcı değiştirilemedi: " + e.message; }
      break;
    case "test": send({ type: "subtitle", text: String(c.text || "GameSubs test altyazısı").slice(0, 300), ttlMs: 5000 }); break;
    case "clearHistory": log.length = 0; panel?.broadcast({ type: "history", items: [] }); break;
  }
  pushState();
}
const panel = args.includes("--no-panel") ? null : startPanel({
  port: PANEL_PORT,
  onConnect: (ws) => { ws.send(JSON.stringify({ type: "state", state: stateObj() })); ws.send(JSON.stringify({ type: "history", items: log })); },
  onCommand: (c) => { onPanelCommand(c).catch((e) => { lastError = e.message; pushState(); }); },
});

const cache = new Map(), history = [];
const CACHE_MAX = 500, HISTORY_MAX = 10;
function remember(src, tr) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);   // en eskiyi at (Map ekleme sırasını korur)
  cache.set(src, tr);
  history.push(src); if (history.length > HISTORY_MAX) history.shift();
}
// Okuma süresi: kısa satır en az 2,5 sn, uzun satır en çok 7 sn ekranda kalır.
const showMs = (t) => Math.min(7000, Math.max(2500, 1500 + t.length * 55));
let seq = 0, abort = null, pending = null;

async function handle(text, ev) {
  const my = ++seq, t0 = Date.now();
  abort?.abort(); abort = new AbortController();
  try {
    if (cache.has(text)) {
      send({ type: "subtitle", text: cache.get(text), ttlMs: showMs(cache.get(text)) });
      addEntry({ en: text, tr: cache.get(text), cached: true });
      return console.log(`EN: ${text}\nTR: ${cache.get(text)}  (önbellek)`);
    }
    const { text: tr, firstMs, by } = await translate(text, abort.signal, (p) => { if (my === seq) send({ type: "subtitle", text: p, ttlMs: 10000, partial: true }); }, t0);
    if (my !== seq) return;
    remember(text, tr);
    send({ type: "subtitle", text: tr, ttlMs: showMs(tr) });
    addEntry({ en: text, tr, by, firstMs, ms: Date.now() - t0 });
    if (lastError) { lastError = null; pushState(); }
    console.log(`EN: ${text}\nTR: ${tr}\n    ocr ${ev.ocrMs}ms · ilk kelime ${firstMs}ms · tamamı ${Date.now() - t0}ms`);
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error("Çeviri hatası:", e.message);
    lastError = "Çeviri hatası: " + e.message.slice(0, 200); addEntry({ en: text, error: lastError }); pushState();
  }
}

// OCR aracı çıkarsa (pencere kapandı/yeniden açıldı, ekran yakalama takıldı) otomatik yeniden başlat.
// Yeni süreç Remote Play penceresini yeniden arar. Bekleme 3 sn'den başlar, art arda çöküşte 30 sn'ye kadar uzar.
const OCR_BIN = new URL("../build/gl-ocr", import.meta.url).pathname;
let child = null, stopping = false, restartDelay = 3000;
function startOcr() {
  child = spawn(OCR_BIN, ["--app", APP, "--region", REGION, "--json"], { stdio: ["ignore", "pipe", "inherit"] });
  createInterface({ input: child.stdout }).on("line", onOcrLine);
  child.on("exit", (code) => {
    if (stopping) return;
    ocrStatus = "yeniden başlatılıyor"; pushState();
    console.error(`OCR aracı durdu (kod ${code}). ${restartDelay / 1000} sn sonra yeniden başlatılıyor…` +
      (code === 3 ? "\n  İpucu: Remote Play penceresi açık ve görünür mü? Sorun sürerse macOS ekran yakalama servisi takılmış olabilir." : ""));
    setTimeout(startOcr, restartDelay);
    restartDelay = Math.min(30000, restartDelay * 2);
  });
}
const shutdown = () => { stopping = true; try { child?.kill(); } catch {} try { unlinkSync(LOCK); } catch {} };
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { shutdown(); process.exit(0); });
process.on("exit", shutdown);

// Düğme ipuçları ("Jump, then hold R2 Swing") asla çevrilmez.
const BUTTON_HINT = /\b([LR][123]|Triangle|Circle|Square|Cross|D-?pad|Touchpad|Options|Create)\b/i;
// Diyalog: "Peter: ..." gibi konuşmacı etiketiyle başlar (OCR bazen öne simge ekler: "› MJ: ...").
// Konuşmacı etiketi: "Ad" + (OCR'ın bozduğu simge gürültüsü) + ":". Küçük harf içermeyen gürültüye izin verilir.
const SPEAKER = /^\W{0,6}([A-Z][\w'.-]*(?: [A-Z][\w'.-]*){0,2})[^a-z\n]{0,12}:\s*\S/;
const letters = (t) => t.toLowerCase().replace(/[^a-z]/g, "");
const knownSpeakers = new Map();                   // harf-ad → görünen ad (":" bozulduğunda yedek)
function isDialogue(t) {
  if (BUTTON_HINT.test(t)) return false;
  if (ALL) return true;
  const m = SPEAKER.exec(t);
  if (m) { knownSpeakers.set(letters(m[1]), m[1]); return true; }
  const head = letters(t);
  for (const n of knownSpeakers.keys()) if (n.length >= 3 && head.includes(n)) return true;   // ad satır sonunda/ortada kalmış olabilir
  return !STRICT && looksLikeSentence(t);
}

/** Etiketsiz satır ("Hello John!") gerçek bir cümleye benziyor mu? İpuçları genelde tek kelime ("Dodge"),
 *  noktalamasız ("Hold Swing", "PRESENT DAY") ya da kumanda simgesiyle başlar ("• Dodge", "› Jump…"). */
function looksLikeSentence(t) {
  const s = t.trim();
  if (/^[•›©*÷+>◦·○●■□▶︎→]/.test(s)) return false;                  // OCR'ın simge olarak okuduğu kumanda ikonu
  if (/[\/|]/.test(s)) return false;                                // menü yolları: "Ayarlar / Gizlilik"
  if (!/[a-z]/.test(s) || !/[.!?…]["”')\]]?$/.test(s)) return false;
  return s.replace(/[^A-Za-z]/g, "").length >= 2;                   // "Okay.", "No!", "Wait..." da diyalogdur
}

// OCR'ın bozduğu "Ad ( •):" / "Ad C •" gürültüsünü "Ad: metin" biçimine çevirir (modele temiz metin gider).
function cleanSpeaker(t) {
  const m = SPEAKER.exec(t);
  if (m) return `${m[1].replace(/\s+[A-Z0-9]$/, "")}: ${t.slice(m[0].length - 1).replace(/^[^A-Za-z0-9\u00c0-\u024f"'(]+/, "").trim()}`;
  for (const name of knownSpeakers.values()) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]?");
    const r = new RegExp("^\\W{0,6}" + esc + "(?:\\s+[A-Z0-9])?\\s*[•()*›©:.\\[\\]]*\\s*(?=\\S)", "i").exec(t);
    if (r) return `${name}: ${t.slice(r[0].length).replace(/^[^A-Za-z0-9"'(]+/, "").trim()}`;
  }
  return t;
}

/** cleanSpeaker sonrası "Ad: metin" biçimindeki konuşmacı adı (yoksa null). */
const speakerOf = (t) => { const m = /^([A-Z][\w'.-]*(?: [A-Z][\w'.-]*){0,2}): /.exec(t); return m ? m[1] : null; };

const endsSentence = (t) => /[.!?…"”)\]]$/.test(t.trim());

function onOcrLine(line) {
  let ev; try { ev = JSON.parse(line); } catch { return console.log("OCR:", line); }
  if (ev.type === "status") {
    if (ev.text === "hazir") restartDelay = 3000;
    ocrStatus = ev.text === "hazir" ? "hazır" : ev.text === "isiniyor" ? "ısınıyor" : ev.text; pushState();
    return console.log("OCR durum:", ev.text, ev.warmupMs ?? "");
  }
  if (ev.type === "error") { lastError = "OCR: " + ev.text; pushState(); return console.error("OCR hata:", ev.text); }
  if (ev.type === "clear") return;                  // orijinal altyazı kayboldu: çeviriyi iptal ETME, süresi dolunca TV kendisi siler
  if (ev.type !== "subtitle") return;
  if (paused) return;                              // panelden duraklatıldı: OCR çalışır ama çeviri yapılmaz

  const isHint = BUTTON_HINT.test(ev.text);
  let text = cleanSpeaker(ev.text);
  let merged = false;
  if (pending && !isHint) {
    clearTimeout(pending.timer);
    const a = speakerOf(pending.text), b = speakerOf(text);
    const rest = b ? text.slice(b.length + 1).trim() : text;
    // Devam satırı: aynı konuşmacı (ya da etiketsiz) VE küçük harfle başlıyor ("let you go.", "and don't…").
    if ((!b || a === b) && /^[a-zçğıöşü]/.test(rest)) { text = pending.text + " " + rest; merged = true; }
    else { console.log("(atlandı: yarım kalan satır) " + pending.text.slice(0, 60)); addEntry({ en: pending.text, skipped: "yarım kalan satır" }); }
    pending = null;
  }
  if (!merged && !isDialogue(ev.text)) {           // ipucu/arayüz metni: çevirme; ekrandaki Türkçe altyazıya dokunma
    addEntry({ en: ev.text, skipped: "diyalog değil" });
    return console.log("(atlandı: diyalog değil) " + ev.text.slice(0, 60));
  }
  if (!endsSentence(text)) {                       // devamı gelebilir: kısa bekle
    pending = { text, timer: setTimeout(() => { const t = pending.text; pending = null; handle(t, ev); }, HOLD_MS) };
    return;
  }
  handle(text, ev);
}

startOcr();
