import * as L from "./log";
import * as TW from "./tvwindow";
import { listVideoSources, isHdmi, label } from "./sources";
import { Subtitle, BG_LABEL, SubtitleState } from "./subtitle";
import { SubtitleSocket, SocketStatus } from "./socket";
import { collectReport, FpsMeter, PATTERNS, renderPattern, Pattern } from "./diagnostics";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const subtitle = new Subtitle($("subtitle"));
const fps = new FpsMeter();
let sources: VideoSourceInfo[] = [];
let srcIdx = 0;
let tvShown = false;
let pattern: Pattern = "none";
let wsStatus: SocketStatus = "idle";
let panelHidden = false;
let diagLines: string[] = [];
let logVisible = false;
let toastTimer: number | undefined;
const lastToast: { [msg: string]: number } = {};

/** Kısa süre görünüp kaybolan bildirim (WebSocket durumu, hatalar). */
function toast(msg: string, kind: "ok" | "warn" | "error", ms = 3500): void {
  const now = Date.now();
  if (lastToast[msg] && now - lastToast[msg] < 15000) return;   // aynı mesajı arka arkaya gösterme
  lastToast[msg] = now;
  const el = $("toast");
  el.textContent = msg;
  el.className = "show " + kind;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = ""; }, ms);
}
let cursor = 0;

interface Item { text: () => string; enter?: () => void | Promise<void>; left?: () => void; right?: () => void }

const run = (name: string, fn: () => Promise<unknown>) => async () => {
  try { L.info(name + " ..."); const r = await fn(); L.info(name + " OK " + JSON.stringify(r ?? "")); }
  catch (e) { L.error(name + " BAŞARISIZ", e); }
  render();
};

async function scan(): Promise<void> {
  const list = await listVideoSources();
  sources = list.connected;
  // PS5 genelde HDMI'dadır; HDMI olanları öne al ama diğer kaynakları da göster.
  sources.sort((a, b) => Number(isHdmi(b)) - Number(isHdmi(a)));
  srcIdx = 0;
  if (!sources.length) L.warn("Bağlı video kaynağı bulunamadı");
}

const items: Item[] = [
  { text: () => `Kaynak: ${sources[srcIdx] ? label(sources[srcIdx]) : "(yok)"}  [◄ ►]`,
    left: () => { if (sources.length) srcIdx = (srcIdx + sources.length - 1) % sources.length; },
    right: () => { if (sources.length) srcIdx = (srcIdx + 1) % sources.length; } },
  { text: () => "Kaynaklari yeniden tara", enter: run("Tara", async () => { await scan(); return sources.map(label); }) },
  { text: () => "Kaynağı uygula + TV penceresini göster (BEHIND)",
    enter: run("setSource+show", async () => {
      const s = sources[srcIdx];
      if (!s) throw new Error("Seçili kaynak yok");
      const applied = await TW.setSource(s);
      const rect = await TW.showWindow(["0px", "0px", "1920px", "1080px"], "BEHIND");
      tvShown = true;
      return { applied, rect };
    }) },
  { text: () => `TV penceresini gizle (${tvShown ? "gösteriliyor" : "gizli"})`,
    enter: run("hide", async () => { await TW.hideWindow(); tvShown = false; }) },
  { text: () => `Altyazı görünür: ${subtitle.state.visible ? "EVET" : "HAYIR"}`,
    enter: () => subtitle.patch({ visible: !subtitle.state.visible }) },
  { text: () => `Altyazı boyutu: ${subtitle.state.fontPx}px  [◄ ►]`,
    left: () => subtitle.patch({ fontPx: subtitle.state.fontPx - 4 }),
    right: () => subtitle.patch({ fontPx: subtitle.state.fontPx + 4 }) },
  { text: () => `Altyazı arka planı: ${BG_LABEL[subtitle.state.bg]}  [◄ ►]`,
    enter: () => subtitle.cycleBg(1), left: () => subtitle.cycleBg(-1), right: () => subtitle.cycleBg(1) },
  { text: () => `Altyazı alttan konum: %${subtitle.state.bottomPct}  [◄ ►]`,
    left: () => subtitle.patch({ bottomPct: subtitle.state.bottomPct - 1 }),
    right: () => subtitle.patch({ bottomPct: subtitle.state.bottomPct + 1 }) },
  { text: () => "Örnek altyazı: Ğ ü ş ı ö ç İ - test", enter: () => subtitle.set("Ğüşıöç İ — örnek Türkçe altyazı: konumu ve kutuyu ayarla", 10000) },
  { text: () => `Test deseni: ${pattern}  [◄ ► / Enter]`,
    enter: () => { pattern = PATTERNS[(PATTERNS.indexOf(pattern) + 1) % PATTERNS.length]; renderPattern($("pattern"), pattern); },
    left: () => { pattern = PATTERNS[(PATTERNS.indexOf(pattern) + PATTERNS.length - 1) % PATTERNS.length]; renderPattern($("pattern"), pattern); },
    right: () => { pattern = PATTERNS[(PATTERNS.indexOf(pattern) + 1) % PATTERNS.length]; renderPattern($("pattern"), pattern); } },
  { text: () => "Tanılama raporunu yenile", enter: run("Tanılama", async () => { diagLines = await collectReport(wsStatus); }) },
  { text: () => `Log paneli: ${logVisible ? "AÇIK" : "kapalı"}`, enter: () => { logVisible = !logVisible; } },
  { text: () => "Paneli gizle (herhangi tuş geri getirir)", enter: () => { panelHidden = true; } },
];

/** Panel gizliyken hiçbir şey çizilmez: oyun sırasında TV işlemcisi yalnızca altyazıyla uğraşır. */
function render(): void {
  $("panel").style.display = panelHidden ? "none" : "block";
  $("log").style.display = logVisible ? "block" : "none";
  if (panelHidden) { fps.stop(); }
  else {
    fps.start();
    $("menu").innerHTML = items
      .map((it, i) => `<div class="item${i === cursor ? " sel" : ""}">${it.text()}</div>`)
      .join("");
    $("diag").textContent = diagLines.join("\n") + `\noverlay fps: ${fps.fps} | WS: ${wsStatus}`;
  }
  if (logVisible) {
    $("log").innerHTML = L.recent(8)
      .map((e) => `<div class="${e.level}">${e.t} ${e.msg.replace(/</g, "&lt;")}</div>`).join("");
  }
}

/** Saniyelik güncelleme yalnızca panel açıkken (fps/WS satırı için). */
function tick(): void { if (!panelHidden || logVisible) render(); }

document.addEventListener("keydown", (ev) => {
  if (panelHidden) { panelHidden = false; render(); return; }
  const it = items[cursor];
  switch (ev.keyCode) {
    case 38: cursor = (cursor + items.length - 1) % items.length; break;
    case 40: cursor = (cursor + 1) % items.length; break;
    case 37: it.left && it.left(); break;
    case 39: it.right && it.right(); break;
    case 13: it.enter && void it.enter(); break;
    default: return; // 10009 (Back) bilerek elle yönetilmiyor: varsayılan davranış uygulamadan çıkar
  }
  ev.preventDefault();
  render();
});

async function init(): Promise<void> {
  L.installGlobalHandlers();
  L.onLog((e) => {
    if (e.level === "error") toast(e.msg.slice(0, 120), "error", 6000);
    else if (e.level === "warn" && (e.msg.startsWith("WebSocket") || e.msg.startsWith("Sunucu yok"))) toast(e.msg.replace(/: ws:.*$/, ""), "warn");
    else if (e.msg.startsWith("WebSocket bağlandı")) toast("WebSocket bağlandı", "ok", 2500);
    tick();
  });
  window.setInterval(tick, 1000);

  if (!TW.isTVWindowAvailable()) {
    L.error("tizen.tvwindow YOK: tarayıcıdasınız veya cihaz/izin desteklemiyor. Yalnızca overlay/WS test edilebilir.");
  }
  try { await scan(); } catch (e) { L.error("Kaynak taraması başarısız", e); }
  try { diagLines = await collectReport(wsStatus); } catch (e) { L.error("Tanılama başarısız", e); }

  // Mac paneli altyazı ayarlarını değiştirebilir; TV de kendi ayarlarını panele geri bildirir.
  const socket = new SubtitleSocket(
    (m) => subtitle.set(m.text, m.ttlMs),
    (s) => { wsStatus = s; render(); },
    (c) => {
      const p = c.subtitle;
      if (!p) return;
      const clean: Partial<SubtitleState> = {};
      if (typeof p.visible === "boolean") clean.visible = p.visible;
      if (typeof p.fontPx === "number") clean.fontPx = p.fontPx;
      if (typeof p.bottomPct === "number") clean.bottomPct = p.bottomPct;
      if (p.bg === "none" || p.bg === "semi" || p.bg === "solid") clean.bg = p.bg;
      subtitle.patch(clean);
      render();
    },
    () => socket.send({ type: "tvstate", subtitle: subtitle.state })
  );
  subtitle.onChange = (st) => socket.send({ type: "tvstate", subtitle: st });
  socket.start();
  render();
}

void init();
