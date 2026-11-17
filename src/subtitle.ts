// HTML altyazı katmanı. Sayfa arka planı şeffaf kalmalı (TVWindow BEHIND ile arkada); yalnızca metnin
// kendi kutusu boyanır. Opak kutu, oyunun İngilizce altyazısını TV'de kapatır — OCR Remote Play
// görüntüsünden okuduğu için bundan etkilenmez.
export type SubtitleBg = "none" | "semi" | "solid";
export const BG_OPTIONS: SubtitleBg[] = ["none", "semi", "solid"];
export const BG_LABEL: Record<SubtitleBg, string> = { none: "yok (gölgeli yazı)", semi: "yarı saydam kutu", solid: "opak kutu" };

export interface SubtitleState { visible: boolean; fontPx: number; bottomPct: number; bg: SubtitleBg }

const KEY = "gamesubs.subtitle";
const DEFAULT: SubtitleState = { visible: true, fontPx: 56, bottomPct: 8, bg: "solid" };

export class Subtitle {
  state: SubtitleState = { ...DEFAULT };
  private text = "";
  private timer: number | undefined;
  private box: HTMLSpanElement;
  /** Ayar her değiştiğinde çağrılır (Mac paneline bildirmek için). */
  onChange: (s: SubtitleState) => void = () => {};

  constructor(private el: HTMLElement) {
    // Kutu metne sığsın diye satır içi bir <span> kullanılır (tam genişlikte şerit değil).
    this.box = document.createElement("span");
    this.box.className = "subbox";
    el.appendChild(this.box);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.state = { ...DEFAULT, ...JSON.parse(raw) };
      if (BG_OPTIONS.indexOf(this.state.bg) < 0) this.state.bg = DEFAULT.bg;
    } catch { /* localStorage yoksa varsayılan */ }
    this.apply();
  }

  set(text: string, ttlMs?: number): void {
    this.text = text;
    window.clearTimeout(this.timer);
    if (ttlMs && ttlMs > 0) this.timer = window.setTimeout(() => this.set(""), ttlMs);
    this.apply();
  }

  patch(p: Partial<SubtitleState>): void {
    this.state = { ...this.state, ...p };
    this.state.fontPx = Math.min(140, Math.max(24, this.state.fontPx));
    this.state.bottomPct = Math.min(90, Math.max(0, this.state.bottomPct));
    if (BG_OPTIONS.indexOf(this.state.bg) < 0) this.state.bg = DEFAULT.bg;
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* yoksay */ }
    this.apply();
    this.onChange(this.state);
  }

  /** Arka plan seçeneğini ileri/geri döndürür. */
  cycleBg(dir: 1 | -1): void {
    const i = BG_OPTIONS.indexOf(this.state.bg);
    this.patch({ bg: BG_OPTIONS[(i + dir + BG_OPTIONS.length) % BG_OPTIONS.length] });
  }

  private apply(): void {
    this.box.textContent = this.text;
    this.box.className = "subbox bg-" + this.state.bg;
    this.el.style.fontSize = this.state.fontPx + "px";
    this.el.style.bottom = this.state.bottomPct + "%";
    this.el.style.display = this.state.visible && this.text ? "block" : "none";
  }
}
