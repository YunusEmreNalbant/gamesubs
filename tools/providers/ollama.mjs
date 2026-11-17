// Yerel Ollama (yerel API, /api/generate). İnternet ve anahtar gerekmez.
import { SYSTEM, userMessage, tidy } from "./prompt.mjs";

export const OLLAMA_URL = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, "")}` : "http://localhost:11434";

export async function ollamaReachable() {
  try { return (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

export function createOllama({ model }) {
  return {
    name: `ollama:${model}`,
    async listModels() {
      const r = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!r.ok) throw new Error("Ollama HTTP " + r.status);
      return (await r.json()).models.map((m) => m.name);
    },
    async translate({ text, context, signal, onPartial }) {
      const r = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST", signal,
        body: JSON.stringify({ model, system: SYSTEM, prompt: userMessage(text, context), stream: true, keep_alive: "60m", options: { temperature: 0.2, num_predict: 160 } }),
      });
      if (!r.ok) throw new Error(`Ollama HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      let acc = "", buf = "";
      const dec = new TextDecoder();
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error("Ollama: " + j.error);
          if (j.response) { acc += j.response; onPartial(acc); }
        }
      }
      return tidy(acc);
    },
  };
}
