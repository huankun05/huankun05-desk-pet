// 本地语义模型下载脚本：bge-m3（嵌入）+ bge-reranker-base（重排）
//
// 直接以流式 HTTP 下载 HF 文件并写入项目 models/ 的 canonical layout
// （与 src/main/rag/model-status.ts 的探测路径一致）：
//   models/Xenova/bge-m3/        ← embedding（tokenizer.json + config.json + onnx/model_quantized.onnx）
//   models/bge-reranker-base/    ← reranker（同上）
//
// 用法：
//   node scripts/download-local-models.mjs              # 官方源 huggingface.co
//   node scripts/download-local-models.mjs --mirror hf-mirror   # 镜像源（国内推荐）
//   node scripts/download-local-models.mjs --only bgem3 # 只下载嵌入模型

import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODELS_DIR = path.join(PROJECT_ROOT, "models");

const args = process.argv.slice(2);
const mirrorIndex = args.indexOf("--mirror");
const mirror = mirrorIndex >= 0 ? args[mirrorIndex + 1] : "official";
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

const HOST = mirror === "hf-mirror" ? "https://hf-mirror.com" : "https://huggingface.co";
if (mirror === "hf-mirror") console.log("[models] 使用镜像源 hf-mirror.com");
else console.log("[models] 使用官方源 huggingface.co");

/** 每个模型需要的文件（relative → 项目 models/ 下的落盘路径） */
const MODELS = [
  {
    key: "bgem3",
    repo: "Xenova/bge-m3",
    target: path.join("Xenova", "bge-m3"),
    files: ["config.json", "tokenizer.json", "tokenizer_config.json", path.join("onnx", "model_quantized.onnx")],
  },
  {
    key: "reranker",
    repo: "Xenova/bge-reranker-base",
    target: "bge-reranker-base",
    files: ["config.json", "tokenizer.json", "tokenizer_config.json", path.join("onnx", "model_quantized.onnx")],
  },
].filter((m) => !only || m.key === only);

async function downloadFile(repo, file, dest) {
  const tmp = dest + ".part";
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // 已存在且非 .part 残留 → 跳过
  if (fs.existsSync(dest) && !fs.existsSync(tmp)) {
    const size = fs.statSync(dest).size;
    if (size > 0) {
      console.log(`[models] 已存在 ${file} (${formatBytes(size)})，跳过`);
      return;
    }
  }

  // 断点续传：上次中断的 .part 大小作为 Range 起点
  const resumeBytes = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  const headers = resumeBytes > 0 ? { Range: `bytes=${resumeBytes}-` } : {};
  const response = await fetch(`${HOST}/${repo}/resolve/main/${file}`, { headers });
  if (!response.ok) {
    // 416 = Range 越界（文件已完整）→ 视为完成
    if (response.status === 416 && resumeBytes > 0) {
      fs.renameSync(tmp, dest);
      console.log(`[models] ${file} 已完整，跳过`);
      return;
    }
    throw new Error(`${file}: HTTP ${response.status} ${response.statusText}`);
  }

  const total = resumeBytes + (Number(response.headers.get("content-length")) || 0);
  const stream = fs.createWriteStream(tmp, { flags: resumeBytes > 0 ? "a" : "w" });
  const reader = response.body.getReader();
  let received = resumeBytes;
  let lastPct = -1;

  process.stdout.write(`\r[models] ${file} ${received > 0 ? `续传 ${formatBytes(received)} + ` : ""}0%   `);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    stream.write(Buffer.from(value));
    received += value.length;
    if (total > 0) {
      const pct = Math.min(99, Math.floor((received / total) * 100));
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`\r[models] ${file} ${formatBytes(received)} / ${formatBytes(total)} ${pct}%   `);
      }
    } else {
      process.stdout.write(`\r[models] ${file} ${formatBytes(received)}   `);
    }
  }
  await new Promise((resolve, reject) => stream.end(resolve));

  fs.renameSync(tmp, dest);
  process.stdout.write(`\r[models] ✓ ${file} (${formatBytes(received)})        \n`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

let failed = false;
for (const model of MODELS) {
  console.log(`\n[models] ==== ${model.repo} ====`);
  for (const file of model.files) {
    const dest = path.join(MODELS_DIR, model.target, file);
    try {
      await downloadFile(model.repo, file, dest);
    } catch (err) {
      console.error(`\n[models] ${file} 下载失败:`, err?.message || err);
      failed = true;
      break;
    }
  }
}

if (failed) {
  console.error("[models] 部分文件失败，可重新运行本脚本续传剩余文件");
  process.exit(1);
}
console.log("\n[models] 全部完成，重启应用后本地嵌入/Reranker 将自动启用");
