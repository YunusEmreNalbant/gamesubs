// Mac kontrol paneli sunucusu: panel sayfasını ve canlı WebSocket kanalını yalnızca bu Mac'e (127.0.0.1) açar.
import http from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";

const PAGE = new URL("./index.html", import.meta.url);
// Yalnızca yerel sayfadan gelen bağlantılar: tarayıcıda açık başka bir site localhost'a WebSocket açamasın.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function startPanel({ port, onConnect, onCommand }) {
  const server = http.createServer((req, res) => {
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    if (host !== "localhost" && host !== "127.0.0.1") { res.writeHead(403); return res.end(); }   // DNS rebinding'e karşı
    if (req.url === "/" || req.url.startsWith("/?")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(readFileSync(PAGE));
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    if (!LOCAL_ORIGIN.test(req.headers.origin || "")) { ws.close(1008, "origin"); return; }
    onConnect(ws);
    ws.on("message", (m) => {
      let c; try { c = JSON.parse(String(m)); } catch { return; }
      if (c && typeof c.cmd === "string") onCommand(c);
    });
  });
  server.on("error", (e) => console.error(`Panel açılamadı (:${port}): ${e.message}`));
  server.listen(port, "127.0.0.1", () => console.log(`Panel: http://localhost:${port}`));
  return {
    broadcast(o) { const s = JSON.stringify(o); wss.clients.forEach((c) => c.readyState === 1 && c.send(s)); },
  };
}
