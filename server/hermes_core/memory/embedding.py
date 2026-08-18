"""Embedding 多方案实现。

当前提供轻量级 `local_hash` 方案：
- 384 维
- 零成本、确定性、无需外部模型
- 适合 P0 阶段的 Librarian 基础检索

后续可扩展：
- nomic_embed_text（Ollama）
- openai（OpenAI API）
- ollama_generic（任意 Ollama 模型）
"""
from __future__ import annotations

import hashlib
import math
import re
from abc import ABC, abstractmethod
from typing import Callable


class Embedder(ABC):
    """Embedding 抽象基类。"""

    @property
    @abstractmethod
    def dim(self) -> int:
        """向量维度。"""
        ...

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """将文本编码为稠密向量。"""
        ...


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """计算两个等长向量的余弦相似度。"""
    if len(a) != len(b) or not a:
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return max(-1.0, min(1.0, dot / (norm_a * norm_b)))


def resize_vector(vec: list[float], target_dim: int) -> list[float]:
    """将向量缩放至目标维度（截断或循环填充）。"""
    if not vec:
        return [0.0] * target_dim
    if len(vec) >= target_dim:
        return vec[:target_dim]
    # 循环填充
    return [vec[i % len(vec)] for i in range(target_dim)]


class LocalHashEmbedder(Embedder):
    """本地哈希 Embedding。

    使用特征哈希（feature hashing）将文本映射到固定维度向量：
    1. 分词（字符 + 2-gram）
    2. 每个 token 用 MD5 哈希，取多个位置更新向量
    3. L2 归一化

    特点：
    - 完全离线，无模型依赖
    - 对相同文本输出相同向量
    - 适合关键词/短句的近似匹配
    """

    dim: int = 384

    def __init__(self, dim: int = 384):
        self.dim = dim

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        """将文本拆分为字符与 2-gram。"""
        text = text.lower().strip()
        # 移除多余空白与标点，保留中文、英文、数字
        text = re.sub(r"[^\w\u4e00-\u9fff]+", " ", text)
        chars = list(text.replace(" ", ""))
        bigrams = [text[i : i + 2] for i in range(len(text) - 1)]
        return chars + bigrams

    def embed(self, text: str) -> list[float]:
        """编码文本为 384 维向量。"""
        vec = [0.0] * self.dim
        tokens = self._tokenize(text)
        if not tokens:
            return vec

        for token in tokens:
            digest = hashlib.md5(token.encode("utf-8")).digest()
            # 每 2 字节映射到一个维度，最多更新 16 个位置
            updates = min(len(digest) // 2, 16)
            for i in range(updates):
                idx = int.from_bytes(digest[i * 2 : i * 2 + 2], "little") % self.dim
                # 用第 31 字节决定正负，增加区分度
                sign = -1 if digest[i] & 0x80 else 1
                vec[idx] += sign * 1.0

        # L2 归一化
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec


def get_embedder(provider: str = "local_hash", **kwargs) -> Embedder:
    """工厂函数：按名称获取 Embedding 实现。

    Args:
        provider: 方案名称，当前仅支持 'local_hash'
        **kwargs: 额外参数

    Returns:
        Embedder 实例
    """
    if provider == "local_hash":
        return LocalHashEmbedder(**kwargs)
    raise ValueError(f"Unknown embedding provider: {provider}")


# 默认 embedder 单例
_default_embedder: Embedder | None = None


def get_default_embedder() -> Embedder:
    """获取默认 embedder（懒加载）。"""
    global _default_embedder
    if _default_embedder is None:
        _default_embedder = LocalHashEmbedder()
    return _default_embedder
