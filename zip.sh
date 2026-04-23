#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")"

echo "EvidenceShot をパッケージングします..."
echo ""

rm -f ./evidence-shot.zip

if [ -f scripts/generate-icons.js ]; then
  echo "アイコンを生成しています..."
  npm install --silent
  node scripts/generate-icons.js
fi

if ! command -v zip &> /dev/null; then
  echo "zip コマンドが見つかりません"
  echo "  Linux: sudo apt install zip"
  echo "  macOS: brew install zip"
  exit 1
fi

zip -r ./evidence-shot.zip \
  manifest.json \
  _locales/ \
  icons/ \
  src/ \
  -x "*.DS_Store" "*.swp" "*~"

echo "ZIP を作成しました: evidence-shot.zip"
ls -lh ./evidence-shot.zip
