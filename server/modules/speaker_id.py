"""
声纹识别模块
基于 FunASR CAM++ (3D-Speaker) 的说话人识别和声纹注册。

技术选型: FunASR CAM++ (speech_campplus_sv_zh-cn_16k-common)
- 模型大小: ~38MB
- 推理设备: CPU 即可
- 嵌入维度: 192
- 语言支持: 中文原生 + 英文
- 依赖: funasr (项目已有)

核心功能：
- 提取说话人嵌入向量（speaker embedding）
- 声纹注册（录入用户声音 → 存储嵌入）
- 实时声纹匹配（识别谁在说话）
- 纳西妲声纹预计算和缓存
"""

import pickle
import os
import threading
import numpy as np
from pathlib import Path
from loguru import logger


class SpeakerIdentifier:
    """声纹识别器 — 基于 FunASR CAM++"""

    def __init__(self, config: dict = None):
        """
        初始化声纹识别器。

        Args:
            config: Speaker ID 配置字典
        """
        cfg = config or {}
        self.enabled = cfg.get("enabled", False)
        self.threshold = cfg.get("threshold", 0.75)
        self.embedding_dim = cfg.get("embedding_dim", 192)
        self.device = cfg.get("device", "cpu")
        self.model_name = cfg.get(
            "model_dir", "models/speaker/speech_campplus_sv_zh-cn_16k-common"
        )

        # 相对于项目根目录解析路径
        project_root = Path(__file__).parent.parent
        if not os.path.isabs(self.model_name):
            self.model_name = str(project_root / self.model_name)

        # CAM++ 模型
        self._model = None
        self._lock = threading.Lock()

        # 声纹数据库 {user_id: [embedding1, embedding2, ...]}
        self._database: dict[str, list[np.ndarray]] = {}

        # 纳西妲声纹嵌入（预计算缓存）
        self._nahida_embedding: np.ndarray | None = None

        logger.info(
            f"SpeakerIdentifier: enabled={self.enabled}, "
            f"threshold={self.threshold}, model={self.model_name}"
        )

    # ==================== 模型加载 ====================

    def init_model(self, config: dict = None):
        """
        加载 CAM++ 模型。

        Args:
            config: 可选的配置覆盖
        """
        if not self.enabled:
            logger.debug("Speaker ID 未启用，跳过模型加载")
            return

        cfg = config or {}
        model_name = cfg.get("model_dir", self.model_name)

        try:
            from funasr import AutoModel
        except ImportError:
            raise ImportError("请安装 funasr: pip install funasr")

        logger.info(f"正在加载 CAM++ 模型: {model_name}")

        with self._lock:
            self._model = AutoModel(
                model=model_name,
                device=self.device,
            )

        logger.info(f"CAM++ 模型加载完成 (device={self.device})")

    # ==================== 嵌入提取 ====================

    def extract_embedding(
        self, audio: np.ndarray, sample_rate: int = 16000
    ) -> np.ndarray | None:
        """
        从音频中提取说话人嵌入向量。

        Args:
            audio: 音频数据 (float32, 16kHz)
            sample_rate: 采样率

        Returns:
            嵌入向量 (shape: [192])，失败返回 None
        """
        if not self.enabled:
            return None

        if self._model is None:
            logger.warning("CAM++ 模型未加载，请先调用 init_model()")
            return None

        # 确保音频格式正确
        audio = audio.astype(np.float32)
        if audio.ndim > 1:
            audio = audio.flatten()

        try:
            with self._lock:
                result = self._model.generate(
                    input=audio,
                    batch_size=1,
                )

            if not result or not isinstance(result, list):
                logger.warning("CAM++ 返回结果为空")
                return None

            # 提取嵌入向量
            embedding = result[0].get("embedding")
            if embedding is None:
                logger.warning("CAM++ 未返回 embedding")
                return None

            # 转为 numpy 并 L2 归一化
            if hasattr(embedding, "numpy"):
                embedding = embedding.numpy()
            embedding = np.array(embedding, dtype=np.float32).flatten()

            # L2 归一化
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            return embedding

        except Exception as e:
            logger.error(f"CAM++ 嵌入提取失败: {e}")
            return None

    def extract_embedding_from_file(self, audio_path: str) -> np.ndarray | None:
        """
        从音频文件提取嵌入。

        Args:
            audio_path: 音频文件路径

        Returns:
            嵌入向量，失败返回 None
        """
        try:
            import torchaudio
            speech, sr = torchaudio.load(audio_path)
            # 重采样到 16kHz
            if sr != 16000:
                speech = torchaudio.transforms.Resample(sr, 16000)(speech)
            # 转为 numpy
            audio = speech.numpy().flatten()
            return self.extract_embedding(audio, sample_rate=16000)
        except Exception as e:
            logger.error(f"加载音频文件失败: {e}")
            return None

    # ==================== 声纹注册 ====================

    def register(
        self, user_id: str, audio: np.ndarray, sample_rate: int = 16000
    ) -> bool:
        """
        注册用户声纹。

        Args:
            user_id: 用户 ID
            audio: 注册音频（建议 3-10 秒）
            sample_rate: 采样率

        Returns:
            注册是否成功
        """
        embedding = self.extract_embedding(audio, sample_rate)
        if embedding is None:
            logger.error(f"声纹提取失败: {user_id}")
            return False

        if user_id not in self._database:
            self._database[user_id] = []

        self._database[user_id].append(embedding)
        count = len(self._database[user_id])
        logger.info(f"声纹注册成功: {user_id} (已有 {count} 个样本)")
        return True

    def register_from_file(self, user_id: str, audio_path: str) -> bool:
        """
        从音频文件注册声纹。

        Args:
            user_id: 用户 ID
            audio_path: 音频文件路径

        Returns:
            注册是否成功
        """
        embedding = self.extract_embedding_from_file(audio_path)
        if embedding is None:
            return False

        if user_id not in self._database:
            self._database[user_id] = []
        self._database[user_id].append(embedding)
        logger.info(f"声纹注册成功: {user_id} (文件: {audio_path})")
        return True

    def register_nahida(
        self, audio: np.ndarray, sample_rate: int = 16000
    ) -> bool:
        """
        注册纳西妲声纹（用于识别/排除）。

        Args:
            audio: 纳西妲参考音频
            sample_rate: 采样率

        Returns:
            注册是否成功
        """
        embedding = self.extract_embedding(audio, sample_rate)
        if embedding is None:
            return False
        self._nahida_embedding = embedding
        logger.info("纳西妲声纹已注册")
        return True

    # ==================== 声纹匹配 ====================

    def identify(
        self, audio: np.ndarray, sample_rate: int = 16000
    ) -> dict:
        """
        识别说话人。

        Args:
            audio: 音频数据
            sample_rate: 采样率

        Returns:
            {"user_id": str, "confidence": float, "is_nahida": bool}
        """
        if not self.enabled:
            return {"user_id": "unknown", "confidence": 0.0, "is_nahida": False}

        if not self._database and self._nahida_embedding is None:
            return {"user_id": "unknown", "confidence": 0.0, "is_nahida": False}

        embedding = self.extract_embedding(audio, sample_rate)
        if embedding is None:
            return {"user_id": "unknown", "confidence": 0.0, "is_nahida": False}

        # 与数据库中所有用户比较
        best_user = "unknown"
        best_score = 0.0

        for user_id, embeddings in self._database.items():
            # 计算与所有注册样本的平均相似度
            scores = [
                self._cosine_similarity(embedding, e) for e in embeddings
            ]
            avg_score = float(np.mean(scores))
            if avg_score > best_score:
                best_score = avg_score
                best_user = user_id

        # 检查是否超过阈值
        if best_score < self.threshold:
            best_user = "unknown"

        # 检查是否是纳西妲
        is_nahida = False
        if self._nahida_embedding is not None:
            nahida_score = self._cosine_similarity(
                embedding, self._nahida_embedding
            )
            is_nahida = nahida_score > self.threshold

        return {
            "user_id": best_user,
            "confidence": best_score,
            "is_nahida": is_nahida,
        }

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """计算余弦相似度（假设已 L2 归一化）"""
        # 如果已归一化，直接点积即可
        return float(np.dot(a, b))

    # ==================== 数据库管理 ====================

    def save_database(self, path: str):
        """保存声纹数据库"""
        data = {
            "database": self._database,
            "nahida_embedding": self._nahida_embedding,
            "embedding_dim": self.embedding_dim,
        }
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(data, f)
        logger.info(f"声纹数据库已保存: {path} ({len(self._database)} 个用户)")

    def load_database(self, path: str):
        """加载声纹数据库"""
        try:
            with open(path, "rb") as f:
                data = pickle.load(f)
            self._database = data.get("database", {})
            self._nahida_embedding = data.get("nahida_embedding")
            self.embedding_dim = data.get("embedding_dim", self.embedding_dim)
            logger.info(
                f"声纹数据库已加载: {path} ({len(self._database)} 个用户)"
            )
        except FileNotFoundError:
            logger.info(f"声纹数据库不存在: {path}，将创建新数据库")
        except Exception as e:
            logger.error(f"加载声纹数据库失败: {e}")

    def list_users(self) -> list[dict]:
        """列出所有已注册用户"""
        users = []
        for user_id, embeddings in self._database.items():
            users.append({
                "user_id": user_id,
                "samples": len(embeddings),
                "embedding_dim": self.embedding_dim,
            })
        return users

    def delete_user(self, user_id: str) -> bool:
        """删除用户声纹"""
        if user_id in self._database:
            del self._database[user_id]
            logger.info(f"用户声纹已删除: {user_id}")
            return True
        logger.warning(f"用户不存在: {user_id}")
        return False

    def close(self):
        """释放资源"""
        with self._lock:
            self._model = None
        logger.info("SpeakerIdentifier 已关闭")
