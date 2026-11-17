// Yalnızca Samsung'un resmi belgelerinde yer alan API'lerin minimal tip tanımları.
// Kaynak: TVWindow API (Since 2.3/2.4), SystemInfo VIDEOSOURCE (Since 2.3).

interface WebAPIErrorLike {
  name: string;
  message: string;
}

interface VideoSourceInfo {
  type: string; // "TV" | "AV" | "SVIDEO" | "COMP" | "PC" | "HDMI" | "SCART" | "DVI" | "MEDIA"
  number: number; // HDMI 2 -> 2
  signal?: boolean | null; // Since 5.5; yalnızca tvwindow getSource/setSource'ta dolu olabilir
}

interface VideoSourceList {
  connected: VideoSourceInfo[];
  disconnected: VideoSourceInfo[];
}

type TVWindowType = "MAIN";
type TVWindowZPosition = "FRONT" | "BEHIND";

interface TizenTVWindow {
  getAvailableWindows(
    onSuccess: (types: TVWindowType[]) => void,
    onError?: ((e: WebAPIErrorLike) => void) | null
  ): void;
  setSource(
    source: VideoSourceInfo,
    onSuccess: (source: VideoSourceInfo, type: TVWindowType) => void,
    onError?: ((e: WebAPIErrorLike) => void) | null,
    type?: TVWindowType
  ): void;
  getSource(type?: TVWindowType): VideoSourceInfo;
  show(
    onSuccess: (rect: string[], type: TVWindowType) => void,
    onError: ((e: WebAPIErrorLike) => void) | null,
    rectangle?: string[],
    type?: TVWindowType,
    zPosition?: TVWindowZPosition
  ): void;
  hide(
    onSuccess: () => void,
    onError?: ((e: WebAPIErrorLike) => void) | null,
    type?: TVWindowType
  ): void;
  getRect(
    onSuccess: (rect: string[], type: TVWindowType) => void,
    onError?: ((e: WebAPIErrorLike) => void) | null,
    unit?: "px" | "%",
    type?: TVWindowType
  ): void;
  // Since 2.4 (belge özeti; dönüş yapısı doğrulanmadı, ham gösteriyoruz)
  getVideoResolution?(type?: TVWindowType): unknown;
}

interface TizenSystemInfo {
  getPropertyValue(
    property: string,
    onSuccess: (value: unknown) => void,
    onError?: ((e: WebAPIErrorLike) => void) | null
  ): void;
}

interface TizenGlobal {
  tvwindow?: TizenTVWindow;
  systeminfo?: TizenSystemInfo;
}

interface Window {
  tizen?: TizenGlobal;
}
