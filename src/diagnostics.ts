// Gerçek TV'de çalıştırılacak tanılama: ölçülebilenleri ölçer, ölçülemeyenleri açıkça belirtir.
import * as TW from "./tvwindow";
import { listVideoSources } from "./sources";
import { describeError } from "./log";

export type Pattern = "none" | "ramp" | "bars" | "flash";
export const PATTERNS: Pattern[] = ["none", "ramp", "bars", "flash"];

export async function collectReport(wsStatus: string): Promise<string[]> {
  const out: string[] = [];
  const add = (k: string, v: string) => out.push(`${k}: ${v}`);
  const safe = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try { add(name, JSON.stringify(await fn())); } catch (e) { add(name, "HATA " + describeError(e)); }
  };
  add("UA", navigator.userAgent);
  add("screen", `${screen.width}x${screen.height} | inner ${innerWidth}x${innerHeight} | dpr ${devicePixelRatio}`);
  add("tizen", String(!!window.tizen));
  add("tizen.tvwindow", String(TW.isTVWindowAvailable()));
  add("WebSocket", wsStatus);
  add("HDR/oyun modu/VRR", "Web uygulamasından ÖLÇÜLEMEZ - TV menüsünden elle doğrulanır");
  if (window.tizen) {
    await safe("DISPLAY", () => new Promise((res, rej) =>
      window.tizen!.systeminfo!.getPropertyValue("DISPLAY", res, (e) => rej(e))));
    await safe("VIDEOSOURCE", listVideoSources);
  }
  if (TW.isTVWindowAvailable()) {
    await safe("getAvailableWindows", TW.getAvailableWindows);
    await safe("getSource", TW.getSource);
    await safe("getRect(px)", () => TW.getRect("px"));
    await safe("getVideoResolution (belge özeti, ham)", TW.getVideoResolution);
  }
  return out;
}

/** requestAnimationFrame aralıklarından overlay çizim hızını ölçer (HDMI gecikmesini DEĞİL).
 *  Her karede çalıştığı için yalnızca tanılama paneli açıkken çalıştırılır. */
export class FpsMeter {
  fps = 0;
  private frames = 0;
  private last = 0;
  private running = false;
  start(): void {
    if (this.running) return;
    this.running = true; this.frames = 0; this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.frames++;
      if (t - this.last >= 1000) { this.fps = this.frames; this.frames = 0; this.last = t; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop(): void { this.running = false; this.fps = 0; }
}

export function renderPattern(el: HTMLElement, p: Pattern): void {
  el.style.display = p === "none" ? "none" : "block";
  el.className = "pattern " + p;
  el.innerHTML = "";
  if (p === "flash") {
    // Saniyede bir yanıp sönen kare: telefon slow-mo kamerasıyla gecikme karşılaştırması için.
    const box = document.createElement("div");
    box.className = "flashbox";
    el.appendChild(box);
    let on = false;
    const id = window.setInterval(() => {
      if (!el.contains(box)) return window.clearInterval(id);
      on = !on;
      box.style.background = on ? "#fff" : "#000";
    }, 500);
  }
}
