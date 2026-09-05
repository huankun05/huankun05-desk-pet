// 商汤 SenseAudio TTS 配置面板逻辑

import { ttsState } from "./state";

// ===== 商汤 TTS 配置 =====
export function initSenseAudioTts(): void {
  const apiKeyInput = document.getElementById("tts-senseaudio-key") as HTMLInputElement | null;
  const voiceSelect = document.getElementById("tts-senseaudio-voice-select") as HTMLSelectElement | null;
  const modelSelect = document.getElementById("tts-senseaudio-model") as HTMLSelectElement | null;
  const speedInput = document.getElementById("tts-senseaudio-speed") as HTMLInputElement | null;
  const testBtn = document.getElementById("tts-senseaudio-test") as HTMLButtonElement | null;
  const testStatus = document.getElementById("tts-senseaudio-test-status") as HTMLElement | null;
  const saveBtn = document.getElementById("tts-senseaudio-save") as HTMLButtonElement | null;
  const saveStatus = document.getElementById("tts-senseaudio-save-status") as HTMLElement | null;
  const listVoicesBtn = document.getElementById("tts-senseaudio-list-voices") as HTMLButtonElement | null;
  const listVoicesStatus = document.getElementById("tts-senseaudio-list-voices-status") as HTMLElement | null;

  // 当前正在播放的音频（用于连续点击时从头播放，不重叠）
  let currentAudio: HTMLAudioElement | null = null;

  // 停止当前播放的音频
  function stopCurrentAudio(): void {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  }

  // 防抖保存配置（避免频繁保存）
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function debounceSaveConfig(): void {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(async () => {
      const apiKey = apiKeyInput?.value.trim() || "";
      const voiceId = voiceSelect?.value || "female_0033_b";
      const model = modelSelect?.value || "senseaudio-tts-1.5-260319";
      const speed = speedInput ? parseFloat(speedInput.value) : 1;

      ttsState.config.ttsSenseaudioKey = apiKey;
      ttsState.config.ttsSenseaudioVoiceId = voiceId;
      ttsState.config.ttsSenseaudioModel = model;
      ttsState.config.ttsSenseaudioSpeed = speed;

      try {
        if (window.tts?.saveSettings) {
          await window.tts.saveSettings({
            ttsSenseaudioKey: apiKey,
            ttsSenseaudioVoiceId: voiceId,
            ttsSenseaudioModel: model,
            ttsSenseaudioSpeed: speed,
          });
          console.log("[SenseAudio TTS] 自动保存配置成功");
        }
      } catch (err) {
        console.warn("[SenseAudio TTS] 自动保存配置失败:", err);
      }
    }, 500);
  }

  // API Key 输入时自动保存
  apiKeyInput?.addEventListener("input", () => {
    debounceSaveConfig();
  });

  // 合成模型切换时自动保存
  modelSelect?.addEventListener("change", () => {
    debounceSaveConfig();
  });

  // 语速调整时自动保存
  speedInput?.addEventListener("input", () => {
    debounceSaveConfig();
  });

  // 音色选择下拉框：切换音色后清空测试状态和缓存
  voiceSelect?.addEventListener("change", async () => {
    console.log("[SenseAudio TTS] 音色选择变化:", { selectedValue: voiceSelect.value });
    // 停止当前播放的音频
    stopCurrentAudio();
    // 切换音色后清空测试状态
    if (testStatus) {
      testStatus.textContent = "";
    }
    // 切换音色时清空缓存（确保缓存和音色匹配）
    try {
      if (window.tts?.clearSenseAudioCache) {
        const result = await window.tts.clearSenseAudioCache();
        console.log("[SenseAudio TTS] 切换音色后已清空缓存:", result);
      }
    } catch (err) {
      console.warn("[SenseAudio TTS] 切换音色后清空缓存失败:", err);
    }
    // 切换音色时自动保存配置
    const apiKey = apiKeyInput?.value.trim() || "";
    const voiceId = voiceSelect?.value || "female_0033_b";
    const model = modelSelect?.value || "senseaudio-tts-1.5-260319";
    const speed = speedInput ? parseFloat(speedInput.value) : 1;
    ttsState.config.ttsSenseaudioKey = apiKey;
    ttsState.config.ttsSenseaudioVoiceId = voiceId;
    ttsState.config.ttsSenseaudioModel = model;
    ttsState.config.ttsSenseaudioSpeed = speed;
    try {
      if (window.tts?.saveSettings) {
        await window.tts.saveSettings({
          ttsSenseaudioKey: apiKey,
          ttsSenseaudioVoiceId: voiceId,
          ttsSenseaudioModel: model,
          ttsSenseaudioSpeed: speed,
        });
        console.log("[SenseAudio TTS] 切换音色后已自动保存配置");
      }
    } catch (err) {
      console.warn("[SenseAudio TTS] 切换音色后自动保存配置失败:", err);
    }
  });

  // 加载已保存的配置（直接从 window.tts.loadSettings() 加载，确保持久化）
  loadSavedConfig();

  async function loadSavedConfig(): Promise<void> {
    try {
      let config: Record<string, unknown> = {};
      if (window.tts?.loadSettings) {
        config = (await window.tts.loadSettings()) as Record<string, unknown>;
        ttsState.config = config;
      } else {
        config = ttsState.config || {};
      }
      console.log("[SenseAudio TTS] 加载配置:", {
        apiKey: config.ttsSenseaudioKey ? "***" : "(空)",
        voiceId: config.ttsSenseaudioVoiceId,
        model: config.ttsSenseaudioModel,
        speed: config.ttsSenseaudioSpeed,
      });
      if (apiKeyInput && config.ttsSenseaudioKey) {
        apiKeyInput.value = String(config.ttsSenseaudioKey);
      }
      if (voiceSelect && config.ttsSenseaudioVoiceId) {
        voiceSelect.value = String(config.ttsSenseaudioVoiceId);
      }
      if (modelSelect && config.ttsSenseaudioModel) {
        modelSelect.value = String(config.ttsSenseaudioModel);
      }
      if (speedInput && config.ttsSenseaudioSpeed) {
        speedInput.value = String(config.ttsSenseaudioSpeed);
      }
    } catch (err) {
      console.warn("[SenseAudio TTS] 加载配置失败:", err);
    }
  }

  // 测试合成
  testBtn?.addEventListener("click", async () => {
    if (!apiKeyInput?.value.trim()) {
      if (testStatus) {
        testStatus.textContent = "❌ 请先填写 API Key";
        testStatus.style.color = "#ef4444";
      }
      return;
    }

    if (testStatus) {
      testStatus.textContent = "⏳ 正在合成...";
      testStatus.style.color = "#6b7280";
    }
    testBtn.disabled = true;

    try {
      const voiceId = voiceSelect?.value || "female_0033_b";
      const model = modelSelect?.value || "senseaudio-tts-1.5-260319";
      const speed = speedInput ? parseFloat(speedInput.value) : 1;
      const text = "你好，这是商汤 SenseAudio 语音合成测试。";
      
      console.log("[SenseAudio TTS] 开始合成:", { voiceId, model, speed, text });
      
      const result = await window.tts?.synthesizeSenseAudio?.({
        apiKey: apiKeyInput.value.trim(),
        voiceId,
        model,
        speed,
        text,
      });

      console.log("[SenseAudio TTS] 合成结果:", {
        hasBase64: !!result?.base64,
        base64Length: result?.base64?.length,
        format: result?.format,
        cached: result?.cached,
      });

      if (result && result.base64) {
        // 播放音频（主进程返回的是 base64 编码的数据）
        try {
          // 清理 base64 数据：移除 data URI 前缀、换行符和空白字符
          let cleanBase64 = result.base64;
          if (cleanBase64.startsWith("data:")) {
            cleanBase64 = cleanBase64.split(",")[1] || cleanBase64;
          }
          cleanBase64 = cleanBase64.replace(/\s/g, "");
          
          console.log("[SenseAudio TTS] base64 数据:", {
            originalLength: result.base64.length,
            cleanLength: cleanBase64.length,
            first50Chars: cleanBase64.substring(0, 50),
          });
          
          const bytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
          const mime = result.format === "wav" ? "audio/wav" : "audio/mpeg";
          
          // 把前10个字节转换成十六进制字符串，用于判断音频格式
          const firstBytesHex = Array.from(bytes.slice(0, 10)).map(b => b.toString(16).padStart(2, "0")).join(" ");
          const firstBytesAscii = Array.from(bytes.slice(0, 4)).map(b => String.fromCharCode(b)).join("");
          
          console.log("[SenseAudio TTS] 音频解码:", {
            bytesLength: bytes.length,
            mime,
            firstBytesHex,
            firstBytesAscii,
          });
          
          const blob = new Blob([bytes], { type: mime });
          const audioUrl = URL.createObjectURL(blob);
          
          // 停止当前播放的音频（连续点击时从头播放，不重叠）
          stopCurrentAudio();
          
          const audio = new Audio();
          audio.src = audioUrl;
          currentAudio = audio;
          
          audio.play().then(() => {
            console.log("[SenseAudio TTS] 音频开始播放");
          }).catch((playErr) => {
            console.warn("[SenseAudio TTS] 播放失败:", playErr);
            // 尝试用 audio/wav 格式
            console.log("[SenseAudio TTS] 尝试用 audio/wav 格式播放...");
            const blobWav = new Blob([bytes], { type: "audio/wav" });
            const audioUrlWav = URL.createObjectURL(blobWav);
            stopCurrentAudio();
            const audioWav = new Audio(audioUrlWav);
            currentAudio = audioWav;
            audioWav.play().then(() => {
              console.log("[SenseAudio TTS] 使用 audio/wav 格式播放成功");
            }).catch((wavErr) => {
              console.warn("[SenseAudio TTS] 使用 audio/wav 格式也失败:", wavErr);
              if (testStatus) {
                testStatus.textContent = `⚠️ 合成成功但播放失败: ${playErr.message}`;
                testStatus.style.color = "#f59e0b";
              }
            });
          });
          audio.onended = () => {
            console.log("[SenseAudio TTS] 音频播放结束");
            URL.revokeObjectURL(audioUrl);
            if (currentAudio === audio) {
              currentAudio = null;
            }
          };
          audio.onerror = (err) => {
            console.error("[SenseAudio TTS] 音频加载错误:", err);
            if (currentAudio === audio) {
              currentAudio = null;
            }
          };

          if (testStatus) {
            testStatus.textContent = "✅ 合成成功，正在播放";
            testStatus.style.color = "#22c55e";
          }
        } catch (decodeErr) {
          console.warn("[SenseAudio TTS] 音频解码失败:", decodeErr);
          throw new Error(`音频解码失败: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`);
        }
      } else {
        throw new Error("未返回音频数据");
      }
    } catch (err) {
      console.error("[SenseAudio TTS] 测试合成失败:", err);
      if (testStatus) {
        testStatus.textContent = `❌ 合成失败: ${err instanceof Error ? err.message : String(err)}`;
        testStatus.style.color = "#ef4444";
      }
    } finally {
      testBtn.disabled = false;
    }
  });

  // 保存配置
  saveBtn?.addEventListener("click", async () => {
    const apiKey = apiKeyInput?.value.trim() || "";
    const voiceId = voiceSelect?.value || "female_0033_b";
    const model = modelSelect?.value || "senseaudio-tts-1.5-260319";
    const speed = speedInput ? parseFloat(speedInput.value) : 1;

    console.log("[SenseAudio TTS] 保存配置:", {
      apiKey: apiKey ? "***" : "(空)",
      voiceId,
      model,
      speed,
    });

    // 更新 ttsState.config
    ttsState.config.ttsSenseaudioKey = apiKey;
    ttsState.config.ttsSenseaudioVoiceId = voiceId;
    ttsState.config.ttsSenseaudioModel = model;
    ttsState.config.ttsSenseaudioSpeed = speed;

    try {
      if (window.tts?.saveSettings) {
        await window.tts.saveSettings({
          ttsSenseaudioKey: apiKey,
          ttsSenseaudioVoiceId: voiceId,
          ttsSenseaudioModel: model,
          ttsSenseaudioSpeed: speed,
        });
        console.log("[SenseAudio TTS] 配置已保存到持久化存储");
      }
      if (saveStatus) {
        saveStatus.textContent = "✅ 配置已保存";
        saveStatus.style.color = "#22c55e";
      }
      setTimeout(() => {
        if (saveStatus) saveStatus.textContent = "";
      }, 3000);
    } catch (err) {
      console.error("[SenseAudio TTS] 保存配置失败:", err);
      if (saveStatus) {
        saveStatus.textContent = `❌ 保存失败: ${err instanceof Error ? err.message : String(err)}`;
        saveStatus.style.color = "#ef4444";
      }
    }
  });

  // 获取音色列表
  listVoicesBtn?.addEventListener("click", async () => {
    if (!apiKeyInput?.value.trim()) {
      if (listVoicesStatus) {
        listVoicesStatus.textContent = "❌ 请先填写 API Key";
        listVoicesStatus.style.color = "#ef4444";
      }
      return;
    }

    if (listVoicesStatus) {
      listVoicesStatus.textContent = "⏳ 正在获取音色列表...";
      listVoicesStatus.style.color = "#6b7280";
    }
    listVoicesBtn.disabled = true;

    try {
      const result = await window.tts?.listSenseAudioVoices?.({
        apiKey: apiKeyInput.value.trim(),
        voiceType: "all",
      });

      console.log("[SenseAudio TTS] 获取音色列表结果:", result);

      // 收集所有音色
      const allVoices: Array<{ voice_id: string; voice_name?: string; description?: string[]; type: string }> = [];
      if (result?.system_voice) {
        result.system_voice.forEach((v) => allVoices.push({ ...v, type: "系统音色" }));
      }
      if (result?.voice_cloning) {
        result.voice_cloning.forEach((v) => allVoices.push({ ...v, type: "克隆音色" }));
      }
      if (result?.voice_generation) {
        result.voice_generation.forEach((v) => allVoices.push({ ...v, type: "文生音色" }));
      }

      console.log("[SenseAudio TTS] 收集到的音色数量:", allVoices.length);
      console.log("[SenseAudio TTS] 前5个音色:", allVoices.slice(0, 5));

      if (allVoices.length > 0 && voiceSelect) {
        // 清空现有选项，保留第一个占位选项
        while (voiceSelect.options.length > 1) {
          voiceSelect.remove(1);
        }

        // 按类型分组添加
        const types = [...new Set(allVoices.map((v) => v.type))];
        types.forEach((type) => {
          const group = document.createElement("optgroup");
          group.label = type;
          allVoices.filter((v) => v.type === type).forEach((voice) => {
            const option = document.createElement("option");
            option.value = voice.voice_id;
            // 显示中文名（voice_name）+ 音色 ID
            const displayName = voice.voice_name ? `${voice.voice_name} (${voice.voice_id})` : voice.voice_id;
            option.textContent = displayName;
            option.title = voice.description ? voice.description.join(", ") : "";
            group.appendChild(option);
          });
          voiceSelect.appendChild(group);
        });

        if (listVoicesStatus) {
          listVoicesStatus.textContent = `✅ 已获取 ${allVoices.length} 个音色，请在下拉框中选择`;
          listVoicesStatus.style.color = "#22c55e";
        }
      } else {
        if (listVoicesStatus) {
          listVoicesStatus.textContent = "⚠️ 未获取到可用音色";
          listVoicesStatus.style.color = "#f59e0b";
        }
      }
    } catch (err) {
      console.error("[SenseAudio TTS] 获取音色列表失败:", err);
      if (listVoicesStatus) {
        listVoicesStatus.textContent = `❌ 获取失败: ${err instanceof Error ? err.message : String(err)}`;
        listVoicesStatus.style.color = "#ef4444";
      }
    } finally {
      listVoicesBtn.disabled = false;
    }
  });
}

// 初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initSenseAudioTts();
  });
} else {
  initSenseAudioTts();
}
