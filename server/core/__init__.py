"""
core — 向后兼容层

真实实现已迁入 hermes_core/。
子模块兼容文件各自转发。
"""
import sys
from pathlib import Path

# 确保 hermes_core 可导入（当 core 被作为包导入时）
_server_dir = Path(__file__).resolve().parent
if str(_server_dir) not in sys.path:
    sys.path.insert(0, str(_server_dir))
