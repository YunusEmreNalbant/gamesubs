// TVWindow API için Promise sarmalayıcıları. Her çağrı çalışma anında desteği kontrol eder.
import { describeError } from "./log";

function api(): TizenTVWindow {
  const tw = window.tizen && window.tizen.tvwindow;
  if (!tw) throw new Error("tizen.tvwindow yok (Tizen TV dışında mısınız, ya da tv.window izni/destek eksik)");
  return tw;
}

export function isTVWindowAvailable(): boolean {
  return !!(window.tizen && window.tizen.tvwindow);
}

function wrap<T>(fn: (ok: (v: T) => void, fail: (e: WebAPIErrorLike) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      fn(resolve, (e) => reject(new Error(describeError(e))));
    } catch (e) {
      reject(new Error(describeError(e))); // WebAPIException (SecurityError vb.) senkron fırlayabilir
    }
  });
}

export const getAvailableWindows = () =>
  wrap<TVWindowType[]>((ok, fail) => api().getAvailableWindows(ok, fail));

export const setSource = (src: VideoSourceInfo) =>
  wrap<VideoSourceInfo>((ok, fail) => api().setSource(src, (s) => ok(s), fail, "MAIN"));

export const getSource = (): VideoSourceInfo => api().getSource("MAIN");

/** Belge örneği: show(ok, fail, ['0px','0px','1920px','1080px'], 'MAIN', 'BEHIND') */
export const showWindow = (rect: string[] = ["0px", "0px", "1920px", "1080px"], z: TVWindowZPosition = "BEHIND") =>
  wrap<string[]>((ok, fail) => api().show((r) => ok(r), fail, rect, "MAIN", z));

export const hideWindow = () => wrap<void>((ok, fail) => api().hide(() => ok(), fail, "MAIN"));

export const getRect = (unit: "px" | "%" = "px") =>
  wrap<string[]>((ok, fail) => api().getRect((r) => ok(r), fail, unit, "MAIN"));

export function getVideoResolution(): unknown {
  const tw = api();
  if (!tw.getVideoResolution) throw new Error("getVideoResolution bu cihazda tanımlı değil");
  return tw.getVideoResolution("MAIN");
}
