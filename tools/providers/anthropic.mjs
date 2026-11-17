// Anthropic (Claude) — resmî @anthropic-ai/sdk ile, akışlı.
// Kimlik bilgisi SDK'nın kendi sırasıyla çözülür: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN ya da `ant auth login` profili.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, userMessage, tidy } from "./prompt.mjs";

// Sunucu tarafı reddetme yedeği ("fallbacks") yalnızca bu modellerde var; Haiku 5.5'te yok.
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
// output_config.effort'u destekleyen güncel modeller (eski Sonnet/Haiku 4.5'te hata verir).
const EFFORT_MODELS = /^claude-(fable-5|mythos-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|haiku-5-5)/;

export function createAnthropic({ model }) {
  const client = new Anthropic();
  const useFallbacks = FALLBACK_MODELS.has(model);
  return {
    name: `anthropic:${model}`,
    async listModels() {
      const ids = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    },
    async translate({ text, context, signal, onPartial }) {
      const body = {
        model,
        max_tokens: 16000,   // düşünme de bu sınıra sayılır; çeviri kısa olsa da düşük tutup kesilme riskine girme
        system: SYSTEM,
        messages: [{ role: "user", content: userMessage(text, context) }],
        // Altyazı kısa ve gecikmeye duyarlı: en düşük düşünme düzeyi.
        ...(EFFORT_MODELS.test(model) ? { output_config: { effort: "low" } } : {}),
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      };
      const stream = client.beta.messages.stream(body, { signal });
      stream.on("text", (_delta, snapshot) => onPartial(snapshot));
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new Error(`anthropic: istek reddedildi (${msg.stop_details?.category ?? "kategori yok"})`);
      return tidy(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    },
  };
}
