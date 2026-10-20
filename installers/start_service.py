"""Launch the user's desktop service; LAN sharing is explicit and authenticated."""
import argparse
import os
from pathlib import Path
import platform
import subprocess
import sys

root = Path(__file__).resolve().parent
# The shipped launcher sits beside setup_runtime.py; installed copy sits in root.
if not (root / 'asr-venv').exists():
    root = (Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local')) / 'Lingua Atelier'
            if platform.system() == 'Windows' else Path.home() / 'Library/Application Support/Lingua Atelier')
parser = argparse.ArgumentParser()
parser.add_argument('--share', action='store_true')
args = parser.parse_args()
python = root / 'asr-venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
if not python.exists():
    parser.error('Install the desktop speech service first.')
cmd = [str(python), str(root / 'qwen-asr-server.py'), '--model', str(root / 'models/qwen3-asr-1.7b'), '--port', '8183' if args.share else '8182']
if args.share:
    token = root / 'connection-token.txt'
    if not token.exists():
        parser.error('Missing connection token. Run the installer again.')
    cmd += ['--host', '0.0.0.0', '--token-file', str(token)]
    print('手机/平板连接：使用这台电脑的局域网或 VPN IP，端口 8183。', flush=True)
    print('连接密钥见本机 connection-token.txt；请在插件 SecretStorage 输入。', flush=True)
    print('此 HTTP 服务只用于可信网络或 VPN；公网请由你管理的 HTTPS 反向代理转发。', flush=True)
    print('关闭此窗口会停止共享。手机的文字翻译另用自己的 API 或已配置的文字服务。', flush=True)
env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TOKENIZERS_PARALLELISM': 'false'}
try:
    subprocess.run(cmd, env=env, check=True)
except KeyboardInterrupt:
    pass
