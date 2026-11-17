// Mac'te çalışan mock altyazı sunucusu: node tools/mock-server.mjs
import { WebSocketServer } from "ws";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.PORT ?? 8765);
const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });
const lines = ["Mac'ten gelen mock altyazı #", "Ğüşıöç İ — Türkçe karakterler", "Bu satır 3 sn sonra silinir"];
let n = 0;

wss.on("connection", (ws, req) => {
  console.log("TV bağlandı:", req.socket.remoteAddress);
  const t = setInterval(() => {
    n++;
    const text = lines[n % lines.length] + (n % lines.length === 0 ? n : "");
    ws.send(JSON.stringify({ type: "subtitle", text, ttlMs: 3000 }));
  }, 4000);
  ws.on("close", () => { clearInterval(t); console.log("TV ayrıldı"); });
});

const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
console.log(`Dinleniyor :${PORT}. TV için URL: ` + ips.map((ip) => `ws://${ip}:${PORT}`).join("  "));
