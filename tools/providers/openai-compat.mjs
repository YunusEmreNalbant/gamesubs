// OpenAI uyumlu "chat/completions" API'si sunan tüm servisler (OpenAI, Gemini, OpenRouter, Groq, DeepSeek,
// Mistral, LM Studio, kendi sunucun…). Akışlı (SSE). Ham fetch: ek paket gerekmez.
import { SYSTEM, userMessage, tidy } from "./prompt.mjs";

export function createOpenAICompat({ name, baseUrl, apiKey, model, extra = {} }) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) };
  return {
    name: `${name}:${model}`,
    async listModels() {
      const r = await fetch(`${base}/models`, { headers });
      if (!r.ok) throw new Error(`${name} HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return ((await r.json()).data ?? []).map((m) => m.id).sort();
    },
    async translate({ text, context, signal, onPartial }) {
      const body = { model, stream: true, ...extra, messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMessage(text, context) },
      ] };
      const r = await fetch(`${base}/chat/completions`, { method: "POST", signal, headers, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${name} HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
      let acc = "", buf = "";
      const dec = new TextDecoder();
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          const j = JSON.parse(data);
          if (j.error) throw new Error(`${name}: ${j.error.message ?? JSON.stringify(j.error)}`);
          const d = j.choices?.[0]?.delta?.content;
          if (d) { acc += d; onPartial(acc); }
        }
      }
      return tidy(acc);
    },
  };
}
