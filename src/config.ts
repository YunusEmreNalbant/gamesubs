// Derleme zamanında GAMESUBS_WS_URL ile değiştirilebilir (scripts/build.mjs).
declare const __WS_URL__: string;

export const WS_URL: string = typeof __WS_URL__ === "string" ? __WS_URL__ : "ws://192.168.1.100:8765";

export const WS_FAILS_BEFORE_MOCK = 3;
export const WS_RETRY_MS = 5000;
export const MOCK_INTERVAL_MS = 4000;

export const MOCK_SUBTITLES: string[] = [
  "Dikkatli ol, arkanda biri var!",
  "Buradan çıkmamız lazım, hemen şimdi.",
  "Ğ ü ş ı ö ç İ — Türkçe karakter testi",
  "Bu yolculuğun sonuna geldik gibi görünüyor.",
  "Bana güven, bir planım var.",
];
