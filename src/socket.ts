// Mac'teki köprüye bağlanan WebSocket istemcisi: altyazı ve ayar alır, TV'nin altyazı ayarlarını geri bildirir.
// Sunucu yoksa örnek metinlere düşer.
import { WS_URL, WS_FAILS_BEFORE_MOCK, WS_RETRY_MS, MOCK_INTERVAL_MS, MOCK_SUBTITLES } from "./config";
import * as L from "./log";

export type SocketStatus = "idle" | "connecting" | "connected" | "mock";
export interface SubtitleMessage { text: string; ttlMs?: number }
/** Köprüden (Mac paneli) gelen altyazı ayarları; yalnızca gönderilen alanlar değişir. */
export interface ConfigMessage { subtitle?: { visible?: boolean; fontPx?: number; bottomPct?: number; bg?: string } }

/** Beklenen mesaj: {"type":"subtitle","text":"...","ttlMs":3000} | {"type":"clear"} | düz metin */
export function parseMessage(data: string): SubtitleMessage | null {
  try {
    const m = JSON.parse(data);
    if (m && m.type === "clear") return { text: "" };
    if (m && m.type === "subtitle" && typeof m.text === "string") {
      return { text: m.text, ttlMs: typeof m.ttlMs === "number" ? m.ttlMs : undefined };
    }
    L.warn("Bilinmeyen mesaj biçimi: " + data.slice(0, 80));
    return null;
  } catch {
    return data ? { text: data } : null; // JSON değilse düz metin kabul et
  }
}

export class SubtitleSocket {
  status: SocketStatus = "idle";
  private ws: WebSocket | null = null;
  private fails = 0;
  private mockTimer: number | undefined;
  private mockIdx = 0;

  constructor(
    private onMessage: (m: SubtitleMessage) => void,
    private onStatus: (s: SocketStatus) => void,
    private onConfig: (c: ConfigMessage) => void = () => {},
    private onOpen: () => void = () => {}
  ) {}

  /** Köprüye JSON gönder (bağlı değilse sessizce atla). */
  send(o: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  start(): void { this.connect(); }

  private set(s: SocketStatus): void { this.status = s; this.onStatus(s); }

  private connect(): void {
    this.set(this.mockTimer ? "mock" : "connecting");
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (e) {
      L.error("WebSocket oluşturulamadı: " + WS_URL, e);
      this.failed();
      return;
    }
    this.ws.onopen = () => {
      L.info("WebSocket bağlandı: " + WS_URL);
      this.fails = 0;
      this.stopMock();
      this.set("connected");
      this.onOpen();
    };
    this.ws.onmessage = (ev) => {
      const data = String(ev.data);
      try {
        const o = JSON.parse(data);
        if (o && o.type === "config") { this.onConfig(o as ConfigMessage); return; }
      } catch { /* JSON değil: düz metin altyazı */ }
      const m = parseMessage(data);
      if (m) this.onMessage(m);
    };
    this.ws.onerror = () => { if (this.fails === 0) L.warn("WebSocket bağlantısı yok: " + WS_URL); };
    this.ws.onclose = () => { if (this.status === "connected") L.warn("WebSocket koptu"); this.failed(); };
  }

  private failed(): void {
    this.fails++;
    if (this.fails >= WS_FAILS_BEFORE_MOCK) this.startMock();
    window.setTimeout(() => this.connect(), WS_RETRY_MS);
  }

  private startMock(): void {
    if (this.mockTimer) return;
    L.warn("Sunucu yok, örnek altyazı moduna geçildi");
    this.set("mock");
    const tick = () => this.onMessage({ text: MOCK_SUBTITLES[this.mockIdx++ % MOCK_SUBTITLES.length] });
    tick();
    this.mockTimer = window.setInterval(tick, MOCK_INTERVAL_MS);
  }

  private stopMock(): void {
    if (this.mockTimer) { window.clearInterval(this.mockTimer); this.mockTimer = undefined; }
  }
}
