#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
print 'Lingua Atelier：此安装器会联网下载独立 Python 环境和 Qwen 模型。'
print '不会读取你的笔记或上传录音。首次下载需要数 GB 空间。'
read 'reply?输入 y 继续 / Continue? [y/N] '
[[ "$reply" == y || "$reply" == Y ]] || exit 0
work=$(mktemp -d "${TMPDIR:-/tmp}/lingua-setup.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
arch=$(uname -m)
if [[ "$arch" == arm64 ]]; then
  url=https://files.pythonhosted.org/packages/ee/a6/abad398b7b051685ac952e97f00b5b96080644559d554246e9011f7f262f/uv-0.13.3-py3-none-macosx_11_0_arm64.whl
  checksum=6f679430085523fd98fe795ff6545e2bf62fc48478746f6ca1c4dff5cae3daa0
else
  url=https://files.pythonhosted.org/packages/4c/9c/c62c4b48b31955dbeaa497ef0594925ef7ca61534b00c3495970c081d47a/uv-0.13.3-py3-none-macosx_10_12_x86_64.whl
  checksum=4e5bd40e3e95b4dc3832639bf0c05244a37c4b1e0b4342a379347f4d9231a8df
fi
curl --proto '=https' --tlsv1.2 -fL --retry 2 "$url" -o "$work/uv.zip"
actual=$(shasum -a 256 "$work/uv.zip")
[[ "${actual%% *}" == "$checksum" ]] || { print '下载校验失败。'; exit 1; }
unzip -q "$work/uv.zip" -d "$work/uv-package"
uvbin="$work/uv-package/uv-0.13.3.data/scripts/uv"
chmod +x "$uvbin"
"$uvbin" run --python 3.12 --no-project --no-config --with huggingface-hub==0.36.0 setup_runtime.py --uv "$uvbin" --yes
read 'reply?安装完成。按回车关闭。'
