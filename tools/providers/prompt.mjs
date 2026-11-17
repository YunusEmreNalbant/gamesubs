// Tüm sağlayıcıların ortak çeviri istemi.
export const SYSTEM =
  "You translate video game subtitles from English to natural, concise Turkish. " +
  "Keep character and place names unchanged. The text comes from OCR; silently fix small errors. " +
  "Output ONLY the Turkish translation, no quotes, no notes.";

/** Son birkaç satır yalnızca bağlam olarak verilir (zamirler, konuşmacılar için). */
export function userMessage(text, context = []) {
  const ctx = context.slice(-2).map((h) => `- ${h}`).join("\n");
  return (ctx ? `Previous lines (context only, do not translate):\n${ctx}\n\n` : "") + `Subtitle: ${text}`;
}

/** Modellerin bazen eklediği tırnakları temizler. */
export const tidy = (s) => s.trim().replace(/^["“]|["”]$/g, "").trim();
