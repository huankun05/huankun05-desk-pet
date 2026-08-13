"""
GPT-SoVITS HTTP Server Launcher
================================

轻量级启动器，按优先级自动发现 GPT-SoVITS 项目并启动 api_v2.py:

  1. desk-pet/server/gpt_sovits/          ← 项目内置副本（优先）
  2. GPT_SOVITS_ROOT 环境变量
  3. desk-pet/../../TTS/GPT-SoVITS/GPT-SoVITS/  (约定路径)
  4. 当前目录下的 GPT-SoVITS/

启动: python server/gpt_sovits_server.py --port 9880
"""
import argparse
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("gpt-sovits-launcher")

# 发现 GPT-SoVITS 根目录
G = None  # 缓存


def find_gpt_sovits_root() -> Path:
    global G
    if G:
        return G

    script_dir = Path(__file__).resolve().parent  # desk-pet/server/
    pet_root = script_dir.parent  # desk-pet/

    # 0. 项目内置本地副本 (desk-pet/server/gpt_sovits/) — 最高优先级
    local_root = script_dir / "gpt_sovits"
    if local_root.joinpath("api_v2.py").exists():
        log.info("使用本地 GPT-SoVITS 副本: %s", local_root)
        G = local_root
        return local_root

    # 1. 环境变量
    env_root = os.environ.get("GPT_SOVITS_ROOT")
    if env_root:
        p = Path(env_root).resolve()
        if p.joinpath("api_v2.py").exists():
            log.info("使用 GPT_SOVITS_ROOT 环境变量: %s", p)
            G = p
            return p

    # 2. 约定路径: desk-pet/../../TTS/GPT-SoVITS/GPT-SoVITS/
    candidate = pet_root.parent.parent / "TTS" / "GPT-SoVITS" / "GPT-SoVITS"
    if candidate.joinpath("api_v2.py").exists():
        log.info("发现 GPT-SoVITS (约定路径): %s", candidate)
        G = candidate
        return candidate

    # 3. 当前目录下的 GPT-SoVITS/
    for d in ["GPT-SoVITS/GPT-SoVITS", "GPT-SoVITS", "../GPT-SoVITS/GPT-SoVITS"]:
        p = pet_root.joinpath(d)
        if p.joinpath("api_v2.py").exists():
            log.info("发现 GPT-SoVITS (当前目录): %s", p)
            G = p
            return p

    raise FileNotFoundError(
        "找不到 GPT-SoVITS api_v2.py。请设置环境变量 GPT_SOVITS_ROOT 指向包含 api_v2.py 的目录，"
        "或保证项目结构为: TTS/GPT-SoVITS/GPT-SoVITS/api_v2.py (与 desk_pet/ 同级)"
    )


def main():
    parser = argparse.ArgumentParser(description="GPT-SoVITS HTTP Server Launcher")
    parser.add_argument("--host", default="127.0.0.1", help="绑定地址")
    parser.add_argument("--port", type=int, default=9880, help="绑定端口")
    parser.add_argument("-a", "--api-host", default=None, help="api_v2.py 的 -a 参数 (默认同 --host)")
    parser.add_argument("-p", "--api-port", type=int, default=None, help="api_v2.py 的 -p 参数 (默认同 --port)")
    parser.add_argument("-c", "--config", default=None, help="api_v2.py 的 -c 配置文件路径")
    args, extra = parser.parse_known_args()

    gs_root = find_gpt_sovits_root()
    log.info("GPT-SoVITS 根目录: %s", gs_root)

    api_host = args.api_host or args.host
    api_port = args.api_port or args.port

    # Python 发现优先级：
    #   1. GPT-SoVITS 自带 venv（仅开发时存在）
    #   2. 共享项目级 venv (desk-pet/venv/)
    #   3. 当前进程的 Python
    pet_root = gs_root.parent.parent  # desk-pet/  (gs_root=server/gpt_sovits → parent=server → parent.parent=desk-pet)
    shared_venv = pet_root / "venv" / "Scripts" / "python.exe"
    local_venv = gs_root / "venv" / "Scripts" / "python.exe"

    if local_venv.exists():
        python = str(local_venv)
        log.info("使用本地 venv Python: %s", python)
    elif shared_venv.exists():
        python = str(shared_venv)
        log.info("使用共享 venv Python: %s", python)
    else:
        python = sys.executable or "python"
        log.info("使用系统 Python: %s", python)

    # 使用本地副本时，默认用 nahida 配置文件（v2Pro + CUDA + nahida 权重）
    if args.config is None:
        nahida_config = gs_root / "GPT_SoVITS" / "configs" / "tts_infer_nahida.yaml"
        if nahida_config.exists():
            args.config = str(nahida_config)
            log.info("使用 nahida 配置文件: %s", nahida_config)

    # 构建 api_v2.py 的启动参数
    cmd = [
        python,
        str(gs_root / "api_v2.py"),
        "-a", api_host,
        "-p", str(api_port),
    ]
    if args.config:
        cmd.extend(["-c", args.config])

    # 将额外的参数也传过去
    cmd.extend(extra)

    log.info("启动命令: %s", " ".join(cmd))
    log.info("工作目录: %s", gs_root)
    log.info("API 监听: http://%s:%s", api_host, api_port)

    import subprocess
    os.chdir(str(gs_root))
    proc = subprocess.run(cmd)
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
