"""Explicit desktop companion installer; never run by the Obsidian plugin."""
import argparse
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess
import sys

MODELS = {
    'mlx': ('mlx-community/Qwen3-ASR-1.7B-8bit', 'a8379a2e2f9e313c9292cdf1af4055ab56d50d55'),
    'transformers': ('Qwen/Qwen3-ASR-1.7B', '7278e1e70fe206f11671096ffdd38061171dd6e5'),
}


def runtime_root(system=None, home=None, local=None):
    system, home = system or platform.system(), Path(home or Path.home())
    return Path(local or os.environ.get('LOCALAPPDATA', home / 'AppData/Local')) / 'Lingua Atelier' if system == 'Windows' else home / 'Library/Application Support/Lingua Atelier'


def plan(root=None):
    backend = 'mlx' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else 'transformers'
    directory = Path(root) if root else runtime_root()
    repo, revision = MODELS[backend]
    return {'root': str(directory), 'backend': backend, 'model': repo, 'revision': revision,
            'python': str(directory / 'asr-venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'))}


def main():
    parser = argparse.ArgumentParser(description='Install the optional local Qwen desktop service')
    parser.add_argument('--uv', default='uv')
    parser.add_argument('--root', type=Path)
    parser.add_argument('--yes', action='store_true')
    parser.add_argument('--plan', action='store_true')
    args = parser.parse_args()
    spec = plan(args.root)
    if args.plan:
        print(json.dumps(spec, ensure_ascii=False, indent=2))
        return
    if platform.system() not in ['Darwin', 'Windows']:
        parser.error('This installer targets macOS and Windows. Other systems may connect to an existing service.')
    if spec['backend'] == 'mlx' and int(platform.mac_ver()[0].split('.')[0]) < 14:
        parser.error('Apple Silicon MLX runtime requires macOS 14 or later.')
    print('Lingua Atelier 桌面识别组件 / Desktop speech service')
    print('下载 Python、开源依赖与 Qwen 模型到独立目录：' + spec['root'])
    print('模型下载：约 2.5 GB（Apple Silicon）或约 4.7 GB（Windows/Intel）。另需 Python 依赖空间。')
    print('Windows/Intel 是实验后端；无 NVIDIA GPU 时会使用 CPU，不保证实时速度。')
    print('此步骤不会读取笔记、不会上传录音，也不会修改 Obsidian 或其他插件配置。')
    if not args.yes and input('继续安装？输入 y / Continue? [y/N] ').lower().strip() != 'y':
        return
    source = Path(__file__).resolve().parent
    root = Path(spec['root']).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    python = Path(spec['python'])
    if not python.exists():
        subprocess.run([args.uv, 'venv', '--python', '3.12', '--seed', str(root / 'asr-venv')], check=True)
    requirements = source / ('requirements-mac.txt' if spec['backend'] == 'mlx' else 'requirements-windows.txt')
    cmd = [args.uv, 'pip', 'install', '--python', str(python), '-r', str(requirements)]
    if spec['backend'] == 'transformers':
        cmd += ['--torch-backend', 'auto']
    subprocess.run(cmd, check=True)
    model_dir = root / 'models/qwen3-asr-1.7b'
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=spec['model'], revision=spec['revision'], local_dir=str(model_dir),
                      allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model', '*.jinja', 'LICENSE', 'README.md'])
    config = json.loads((model_dir / 'config.json').read_text())
    if config.get('model_type') != 'qwen3_asr':
        raise RuntimeError('Unexpected model type; refusing to enable the service')
    for name in ['qwen-asr-server.py', 'qwen_dual.py', 'qwen_transformers.py']:
        shutil.copy2(source / name, root / name)
    helper = source / 'system-audio'
    if platform.system() == 'Darwin' and helper.exists():
        shutil.copy2(helper, root / helper.name)
        (root / helper.name).chmod(0o755)
    # Generated per installation; never part of a shared download or repository.
    token = root / 'connection-token.txt'
    if not token.exists():
        descriptor = os.open(token, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            output.write(secrets.token_urlsafe(32))
    server = root / 'qwen-asr-server.py'
    launcher = source / ('start_service.py')
    shutil.copy2(launcher, root / 'start_service.py')
    print('\n识别组件安装完成。回到插件设置，点击“启动服务”。')
    print('手机连接时，在电脑运行下载包中的 Share-to-phone 启动器；连接密钥仅保存在本机：')
    print(token)
    print('翻译与整理：另行安装 Ollama 并运行 ollama pull qwen2.5:3b，或在插件中填写自己的文字 API。')


if __name__ == '__main__':
    main()
