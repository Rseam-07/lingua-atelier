#!/bin/zsh
set -euo pipefail
root="$HOME/Library/Application Support/Lingua Atelier"
if [[ ! -x "$root/asr-venv/bin/python" ]]; then
  print '请先运行 Setup-Mac.command。'
  exit 1
fi
"$root/asr-venv/bin/python" "$root/start_service.py" --share
