// 本地音乐卡片：导入文件夹 / 导入文件 + 打开播放器。
//
// 为什么放在插件主页而不是网易云详情页里：本地音乐跟任何厂商都没关系，
// 之前「打开播放器」按钮埋在网易云详情页，等于本地音乐必须先经过网易云
// 才能用，这不合理。
import type { MusicApi } from "./types";
import { getMusicApi } from "./panel";
import { tOr } from "../i18n";

const statusLine = () => document.getElementById("local-status-line");
const tagEl = () => document.getElementById("local-tag");

interface ImportOutcome {
  imported: number;
  skipped: number;
  cancelled?: boolean;
  truncated?: boolean;
  /** 导入过程本身失败（IPC 报错 / 抛异常），与「扫了但一首都没有」不是一回事。 */
  failed?: boolean;
}

/** 导入结果 → 一句人话。截断和「一首没导入」都要说清楚，别让用户以为成功了。 */
export function describeImport(r: ImportOutcome): string {
  if (r.cancelled) return tOr("music.local.importCancelled", "已取消导入。");
  // 失败要说是失败。报成「没有找到可导入的音频文件」的话，
  // 用户会跑去翻文件夹，而不是重试。
  if (r.failed) return tOr("music.local.importFailed", "导入失败，请重试。");
  if (r.imported === 0 && r.skipped === 0) return tOr("music.local.importEmpty", "没有找到可导入的音频文件。");
  const parts = [tOr("music.local.importedPrefix", "导入 ") + r.imported + tOr("music.local.songCountUnit", " 首")];
  if (r.skipped > 0) parts.push(tOr("music.local.skippedPrefix", "跳过 ") + r.skipped + tOr("music.local.skippedSuffix", " 首（已存在）"));
  if (r.truncated) parts.push(tOr("music.local.importTruncated", "已达单次导入上限，剩余文件未处理"));
  return parts.join("，") + "。";
}

/** 缓存池里已有多少首本地音乐。 */
export function describeLibrary(count: number): { text: string; tag: string | null } {
  return count > 0
    ? { text: tOr("music.local.libraryCountPrefix", "曲库已有 ") + count + tOr("music.local.libraryCountSuffix", " 首，可直接播放。"), tag: count + tOr("music.local.songCountUnit", " 首") }
    : { text: tOr("music.local.libraryEmpty", "还没有本地音乐，导入文件夹开始使用。"), tag: null };
}

async function refresh(api: MusicApi): Promise<void> {
  try {
    const res = await api.getCachedTracks();
    const tracks = res.ok ? (res.data ?? []) : [];
    const { text, tag } = describeLibrary(tracks.length);
    const line = statusLine();
    if (line) line.textContent = text;
    const t = tagEl();
    if (t) {
      t.textContent = tag ?? "";
      t.classList.toggle("is-hidden", tag === null);
    }
  } catch {
    const line = statusLine();
    if (line) line.textContent = tOr("music.local.libraryLoadFailed", "读取曲库失败。");
  }
}

/** 绑定卡片。幂等：设置页可能被重新初始化。 */
export function initLocalMusicPanel(): void {
  const card = document.getElementById("music-platform-local");
  if (!card || card.dataset.localBound === "1") return;
  card.dataset.localBound = "1";

  const api = getMusicApi();
  if (!api?.getCachedTracks) {
    const line = statusLine();
    if (line) line.textContent = tOr("music.local.envUnsupported", "当前环境不支持本地音乐。");
    return;
  }

  card.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("button");
    if (!btn) return;
    ev.stopPropagation();

    const done = (r: ImportOutcome) => {
      const line = statusLine();
      if (line) line.textContent = describeImport(r);
      // 导入后回读曲库数量，但别把刚才那句结果立刻冲掉
      setTimeout(() => void refresh(api), 2500);
    };

    if (btn.id === "local-import-folder" && api.importLocalFolder) {
      const line = statusLine();
      if (line) line.textContent = tOr("music.local.scanningFolder", "正在扫描文件夹…");
      void api.importLocalFolder()
        .then((res) => {
          done(res.ok ? (res.data as ImportOutcome) : { imported: 0, skipped: 0, failed: true });
        })
        // 没有 catch 的话，IPC 抛异常会变成 unhandled rejection，
        // 状态行永远停在「正在扫描文件夹…」。
        .catch(() => done({ imported: 0, skipped: 0, failed: true }));
      return;
    }
    if (btn.id === "local-import-files" && api.importLocalTracks) {
      void api.importLocalTracks()
        .then((res) => {
          done(res.ok ? (res.data as ImportOutcome) : { imported: 0, skipped: 0, failed: true });
        })
        .catch(() => done({ imported: 0, skipped: 0, failed: true }));
      return;
    }
    if (btn.id === "local-open-player") {
      void api.openPlayer();
    }
  });

  void refresh(api);
}
