#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
print '请先结束录音并退出 Obsidian。此脚本仅安装 Lingua Atelier，不启用或停用其他插件。'
read 'vault?把 Obsidian 仓库文件夹拖到这里，或输入绝对路径，再按回车：'
vault=${vault#\'}; vault=${vault%\'}; vault=${vault#\"}; vault=${vault%\"}
# Finder drag may escape spaces. zsh unquotes without evaluating commands.
vault=${(Q)vault}
[[ -d "$vault/.obsidian" ]] || { print '未找到默认 .obsidian 配置目录。自定义配置目录请按说明手动安装。'; exit 1; }
target="$vault/.obsidian/plugins/lingua-atelier"
mkdir -p "$target"
stamp=$(date +%Y%m%d-%H%M%S)
for name in main.js manifest.json styles.css; do
  [[ ! -f "$target/$name" ]] || cp "$target/$name" "$target/$name.backup-$stamp"
  cp "lingua-atelier/$name" "$target/$name"
done
print '完成。重新打开 Obsidian，在第三方插件中启用 Lingua Atelier。'
print '首次使用本地识别：继续运行 desktop-service/Setup-Mac.command。'
read 'reply?按回车关闭。'
