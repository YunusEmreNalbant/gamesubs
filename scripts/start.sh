#!/usr/bin/env bash
# GameSubs Mac tarafını tek komutla başlatır: OCR + çeviri + WebSocket köprüsü.
# Kullanım:  scripts/start.sh [köprü seçenekleri]   (örn. --provider groq --model <kimlik>, --strict)
#   Sağlayıcı verilmezse: OPENAI_API_KEY → openai, ANTHROPIC_API_KEY → anthropic, yoksa yerel Ollama.
#   Tüm seçenekler: tools/bridge.mjs başlığı ve docs/MAC-CEVIRI.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Zaten çalışan köprü varsa dokunma (iki OCR süreci yakalamayı kilitler).
if [ -f build/bridge.pid ] && kill -0 "$(cat build/bridge.pid)" 2>/dev/null; then
  echo "Köprü zaten çalışıyor (pid $(cat build/bridge.pid)). Önce o terminalde Ctrl+C yap." >&2; exit 2
fi
# 2) Köprüsüz kalmış sahipsiz OCR süreçlerini temizle.
pkill -f "build/gl-ocr" 2>/dev/null || true

# 3) OCR aracı yoksa derle.
if [ ! -x build/gl-ocr ]; then
  echo "gl-ocr derleniyor..."; mkdir -p build
  swiftc -O mac/ocr/main.swift -o build/gl-ocr 2>&1 | grep -E " error" || true
fi

# 4) Sağlayıcı seçimini köprü yapar (--provider/--model ya da ortamdaki anahtara göre otomatik).
exec node tools/bridge.mjs "$@"
