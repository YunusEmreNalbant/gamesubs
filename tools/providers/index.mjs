// Çeviri sağlayıcısı seçimi. Yeni bir OpenAI uyumlu servis eklemek için PRESETS'e bir satır yeterli.
import { createOllama, ollamaReachable } from "./ollama.mjs";
import { createOpenAICompat } from "./openai-compat.mjs";
import { createAnthropic } from "./anthropic.mjs";

// model: varsayılan model (yalnızca hesapta doğrulanmış olanlar); yoksa --model zorunlu.
export const PRESETS = {
  ollama:     { kind: "ollama", model: "gemma3:4b", note: "yerel, anahtarsız" },
  openai:     { kind: "openai", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
  anthropic:  { kind: "anthropic", keyEnv: "ANTHROPIC_API_KEY", model: "claude-opus-5-5" },
  gemini:     { kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY" },
  openrouter: { kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" },
  groq:       { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  deepseek:   { kind: "openai", baseUrl: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY" },
  mistral:    { kind: "openai", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY" },
  lmstudio:   { kind: "openai", baseUrl: "http://localhost:1234/v1", note: "yerel, anahtarsız" },
  custom:     { kind: "openai", baseUrl: null, keyEnv: "GAMESUBS_API_KEY", note: "--base-url ile herhangi bir OpenAI uyumlu sunucu" },
};

/** Sağlayıcı verilmemişse ortamdaki anahtara göre seç (varsayılan modeli olanlar), yoksa yerel Ollama. */
export function autoProvider(env = process.env) {
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return "ollama";
}

export function createTranslator({ provider, model, baseUrl, extra }, env = process.env) {
  const p = PRESETS[provider];
  if (!p) throw new Error(`Bilinmeyen sağlayıcı '${provider}'. Seçenekler: ${Object.keys(PRESETS).join(", ")}`);
  const m = model || p.model;
  if (!m) throw new Error(`'${provider}' için --model gerekli (kimlikler için: --provider ${provider} --list-models)`);
  if (p.kind === "ollama") return createOllama({ model: m });
  if (p.kind === "anthropic") return createAnthropic({ model: m });
  const url = baseUrl || (provider === "custom" ? env.GAMESUBS_BASE_URL : p.baseUrl);
  if (!url) throw new Error("'custom' için --base-url (ya da GAMESUBS_BASE_URL) gerekli");
  const key = p.keyEnv ? env[p.keyEnv] : undefined;
  if (p.keyEnv && !key && provider !== "custom") throw new Error(`${p.keyEnv} ortam değişkeni yok`);
  return createOpenAICompat({ name: provider, baseUrl: url, apiKey: key, model: m, extra });
}

export { ollamaReachable };
