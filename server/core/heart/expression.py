"""
core.heart.expression — 兼容层，已迁入 hermes_core.emotion.expression

兼容两种启动方式：
- 从项目根运行：python -m server.core.api_server
- 从 server/ 运行：python -c "from core.heart.expression import ..."
"""
try:
    from server.hermes_core.emotion.expression import ExpressionEngine, ExpressionStrategy
except ImportError:
    from hermes_core.emotion.expression import ExpressionEngine, ExpressionStrategy

__all__ = [
    "ExpressionEngine",
    "ExpressionStrategy",
]
