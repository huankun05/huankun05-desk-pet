"""
LLM 对话模块
封装大语言模型的对话能力，支持 API 调用和本地推理。

核心功能：
- 支持 DeepSeek / OpenAI / 智谱 等 API
- 流式输出（token by token）
- 多轮对话上下文管理
- 纳西妲人设注入
"""

import os
import json
import time
from typing import Any, Generator
from loguru import logger

# 尝试导入 openai（API 模式需要）
try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

# 尝试导入 transformers（本地模式需要）
try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    HAS_TRANSFORMERS = True
except ImportError:
    HAS_TRANSFORMERS = False


# ==================== API 配置映射 ====================

API_CONFIGS = {
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "zhipu": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-4-flash",
    },
}


class LLMChat:
    """LLM 对话管理器"""

    def __init__(self, config: dict = None):
        """
        初始化 LLM 模块。

        Args:
            config: LLM 配置字典
        """
        cfg = config or {}
        self.mode = cfg.get("mode", "api")
        self.api_provider = cfg.get("api_provider", "deepseek")
        self.model = cfg.get("model", "")
        self.max_tokens = cfg.get("max_tokens", 512)
        self.temperature = cfg.get("temperature", 0.7)
        self.top_p = cfg.get("top_p", 0.9)
        self.stream = cfg.get("stream", True)

        # 客户端
        self._client = None
        self._local_model = None
        self._tokenizer = None

        # 初始化
        if self.mode == "api":
            self._init_api(cfg)
        elif self.mode == "local":
            self._init_local(cfg)

        logger.info(f"LLM 初始化: mode={self.mode}, provider={self.api_provider}")

    def _init_api(self, config: dict):
        """初始化 API 客户端"""
        if not HAS_OPENAI:
            logger.error("openai 库未安装，请运行: pip install openai")
            return

        # 获取 API 配置（优先从 config，其次从环境变量）
        api_key = config.get("api_key") or os.environ.get("NAHIDA_LLM_API_KEY", "")
        base_url = config.get("api_base_url", "")
        self.model = config.get("model", "") or os.environ.get("NAHIDA_LLM_MODEL", "")

        # provider 也支持环境变量
        provider = config.get("api_provider") or os.environ.get("NAHIDA_LLM_PROVIDER", "deepseek")
        if provider != self.api_provider:
            self.api_provider = provider

        # 使用预设配置
        if self.api_provider in API_CONFIGS:
            preset = API_CONFIGS[self.api_provider]
            base_url = base_url or preset["base_url"]
            self.model = self.model or preset["model"]

        if not api_key:
            logger.warning("未配置 API Key，LLM 功能不可用")
            logger.info("请在 .env 文件中设置 NAHIDA_LLM_API_KEY")
            return

        self._client = OpenAI(
            api_key=api_key,
            base_url=base_url,
        )
        logger.info(f"API 客户端初始化: {self.api_provider}, model={self.model}")

    def _init_local(self, config: dict):
        """初始化本地模型"""
        if not HAS_TRANSFORMERS:
            logger.error("transformers 库未安装，请运行: pip install transformers accelerate")
            return

        model_path = config.get("local_model_path", "")
        device = config.get("device", "cuda")

        if not model_path:
            logger.error("未配置本地模型路径")
            return

        try:
            logger.info(f"加载本地模型: {model_path}")
            self._tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
            self._local_model = AutoModelForCausalLM.from_pretrained(
                model_path,
                trust_remote_code=True,
                device_map=device,
                torch_dtype="auto",
            )
            logger.info(f"本地模型加载完成: {model_path}")
        except Exception as e:
            logger.error(f"加载本地模型失败: {e}")

    # ==================== 对话接口 ====================

    def chat(self, messages: list[dict], **kwargs) -> str:
        """
        同步对话（非流式）。

        Args:
            messages: [{"role": "system/user/assistant", "content": "..."}]
            **kwargs: 覆盖默认参数

        Returns:
            助手回复文本
        """
        params = {
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "temperature": kwargs.get("temperature", self.temperature),
            "top_p": kwargs.get("top_p", self.top_p),
        }

        if self.mode == "api":
            return self._chat_api(messages, stream=False, **params)
        elif self.mode == "local":
            return self._chat_local(messages, **params)
        else:
            raise ValueError(f"不支持的模式: {self.mode}")

    def chat_stream(self, messages: list[dict], tools: list[dict] | None = None, **kwargs) -> Generator[str | dict, None, None]:
        """
        流式对话（token by token 生成）。

        Args:
            messages: 消息列表
            tools: OpenAI function-calling 工具定义（可选）
            **kwargs: 覆盖默认参数

        Yields:
            文本片段（str），或在检测到工具调用时 yield 字典
            {"type": "tool_calls", "calls": [{"id", "name", "arguments"}]}
        """
        params = {
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "temperature": kwargs.get("temperature", self.temperature),
            "top_p": kwargs.get("top_p", self.top_p),
        }

        if self.mode == "api":
            yield from self._chat_api_stream(messages, tools=tools, **params)
        elif self.mode == "local":
            yield self._chat_local(messages, **params)
        else:
            raise ValueError(f"不支持的模式: {self.mode}")

    # ==================== API 模式 ====================

    def _chat_api(self, messages: list[dict], stream: bool = False, **kwargs) -> str:
        """API 同步对话"""
        if not self._client:
            return "[LLM 未初始化，请配置 API Key]"

        try:
            t0 = time.time()
            response = self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=stream,
                max_tokens=kwargs.get("max_tokens", self.max_tokens),
                temperature=kwargs.get("temperature", self.temperature),
                top_p=kwargs.get("top_p", self.top_p),
                extra_body=self._extra_body(),
            )
            logger.info("[LLM] _chat_api request sent in %.2fs", time.time() - t0)
            if stream:
                full_text = ""
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        full_text += chunk.choices[0].delta.content
                logger.info("[LLM] _chat_api stream done in %.2fs", time.time() - t0)
                return full_text
            else:
                logger.info("[LLM] _chat_api done in %.2fs", time.time() - t0)
                return response.choices[0].message.content
        except Exception as e:
            logger.error(f"API 调用失败: {e}")
            return f"[LLM 调用失败: {e}]"

    def _chat_api_stream(self, messages: list[dict], tools: list[dict] | None = None, **kwargs) -> Generator[str | dict, None, None]:
        """API 流式对话，支持把工具调用以字典块形式 yield 出去。"""
        if not self._client:
            yield "[LLM 未初始化，请配置 API Key]"
            return

        try:
            t0 = time.time()
            create_kwargs: dict = {
                "model": self.model,
                "messages": messages,
                "stream": True,
                "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                "temperature": kwargs.get("temperature", self.temperature),
                "top_p": kwargs.get("top_p", self.top_p),
                "extra_body": self._extra_body(),
            }
            if tools:
                create_kwargs["tools"] = tools
            response = self._client.chat.completions.create(**create_kwargs)
            logger.info("[LLM] _chat_api_stream request sent in %.2fs", time.time() - t0)

            # 聚合流式增量 tool_calls（OpenAI 按 index 分片返回）
            accumulated: dict[int, dict[str, str]] = {}
            for chunk in response:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if getattr(delta, "content", None):
                    yield delta.content
                tool_calls = getattr(delta, "tool_calls", None)
                if tool_calls:
                    for tc in tool_calls:
                        idx = tc.index
                        slot = accumulated.setdefault(
                            idx, {"id": "", "name": "", "arguments": ""}
                        )
                        if getattr(tc, "id", None):
                            slot["id"] = tc.id
                        fn = getattr(tc, "function", None)
                        if fn:
                            if getattr(fn, "name", None):
                                slot["name"] += fn.name
                            if getattr(fn, "arguments", None):
                                slot["arguments"] += fn.arguments

            logger.info("[LLM] _chat_api_stream done in %.2fs", time.time() - t0)
            if accumulated:
                calls = []
                for slot in accumulated.values():
                    try:
                        args = json.loads(slot["arguments"] or "{}")
                    except Exception:
                        args = {}
                    calls.append(
                        {"id": slot["id"], "name": slot["name"], "arguments": args}
                    )
                yield {"type": "tool_calls", "calls": calls}
        except Exception as e:
            logger.error(f"API 流式调用失败: {e}")
            yield f"[LLM 调用失败: {e}]"

    def _extra_body(self) -> dict[str, Any] | None:
        """Provider-specific extra parameters.

        StepFun: reduce reasoning effort so responses are faster, matching Hermes behavior.
        """
        provider = (getattr(self, "api_provider", "") or "").strip().lower()
        model = (getattr(self, "model", "") or "").strip().lower()
        if provider == "stepfun" or model.startswith("step-"):
            return {"reasoning_effort": "low"}
        return None

    # ==================== 本地模式 ====================

    def _chat_local(self, messages: list[dict], **kwargs) -> str:
        """本地模型对话"""
        if not self._local_model or not self._tokenizer:
            return "[本地模型未加载]"

        try:
            # 构建 prompt
            text = self._tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
            inputs = self._tokenizer(text, return_tensors="pt").to(self._local_model.device)

            # 生成
            outputs = self._local_model.generate(
                **inputs,
                max_new_tokens=kwargs.get("max_tokens", self.max_tokens),
                temperature=kwargs.get("temperature", self.temperature),
                top_p=kwargs.get("top_p", self.top_p),
                do_sample=True,
            )
            # 只取新生成的部分
            new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
            return self._tokenizer.decode(new_tokens, skip_special_tokens=True)
        except Exception as e:
            logger.error(f"本地模型推理失败: {e}")
            return f"[推理失败: {e}]"

    # ==================== 工具方法 ====================

    def is_available(self) -> bool:
        """检查 LLM 是否可用"""
        if self.mode == "api":
            return self._client is not None
        elif self.mode == "local":
            return self._local_model is not None
        return False

    def close(self):
        """释放资源"""
        self._client = None
        self._local_model = None
        self._tokenizer = None
        logger.info("LLM 已关闭")

    def __repr__(self):
        status = "可用" if self.is_available() else "不可用"
        return f"LLMChat(mode={self.mode}, provider={self.api_provider}, {status})"
