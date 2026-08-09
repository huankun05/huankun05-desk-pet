/**
 * 模型资源缓存（跨「隐藏 / 显示」周期）
 *
 * 隐藏角色时 Live2D 引擎会被彻底销毁：WebGL 上下文释放、纹理删除、2D 从桌面移除。
 * 重新显示时需要重建。本模块缓存两类「与 GL 上下文无关」的 CPU 侧数据，
 * 让重新显示跳过最耗时的两步：
 *   1) 磁盘读取（Tauri 资源协议 fetch）—— 缓存原始字节 ArrayBuffer；
 *   2) PNG 解码 —— 缓存已 decode 的 ImageBitmap，重建时仅 texImage2D 上传。
 *
 * 不缓存 CubismMoc / WebGLTexture 等 GPU 对象：它们随 GL 上下文销毁而失效，
 * 且重建成本极低（moc3 从内存字节重新解析、纹理从位图重新上传）。
 * 这样「重新显示」既接近瞬时，又保证隐藏时 2D 真正不在桌面、不占 GPU 显存。
 */

const bufferCache = new Map<string, ArrayBuffer>();
const textureCache = new Map<string, CachedTexture>();
const inflight = new Map<string, Promise<ArrayBuffer>>();

interface CachedTexture {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/** 带内存缓存的 fetch：同一 url 只真正读取一次，之后直接返回已缓存的字节。 */
export function fetchCached(url: string): Promise<ArrayBuffer> {
  const hit = bufferCache.get(url);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;

  const p = fetch(url)
    .then((r) => {
      if (!r.ok) {
        console.warn(`[modelCache] fetch failed (${r.status}): ${url}`);
        return new ArrayBuffer(0);
      }
      return r.arrayBuffer();
    })
    .then((ab) => {
      bufferCache.set(url, ab);
      inflight.delete(url);
      return ab;
    })
    .catch((err) => {
      inflight.delete(url);
      console.error('[modelCache] fetchCached error:', url, err);
      return new ArrayBuffer(0);
    });

  inflight.set(url, p);
  return p;
}

/** 返回（并缓存）解码后的纹理位图。同一 fileName 只解码一次，可跨 GL 上下文复用。 */
export async function decodeTextureCached(
  fileName: string,
): Promise<CachedTexture | null> {
  const hit = textureCache.get(fileName);
  if (hit) return hit;
  try {
    const buf = await fetchCached(fileName);
    if (!buf || buf.byteLength === 0) return null;
    const blob = new Blob([buf]);
    const bitmap = await createImageBitmap(blob);
    const entry: CachedTexture = { bitmap, width: bitmap.width, height: bitmap.height };
    textureCache.set(fileName, entry);
    return entry;
  } catch (e) {
    console.error('[modelCache] decodeTextureCached failed:', fileName, e);
    return null;
  }
}

/** 主动预热一组文件（切换模型前调用可让首次显示也接近零等待）。 */
export function warmFiles(urls: string[]): void {
  for (const u of urls) {
    if (!bufferCache.has(u)) void fetchCached(u);
  }
}

/** 释放全部缓存（位图会关闭以回收内存）。需要彻底省内存时调用。 */
export function clearModelCache(): void {
  bufferCache.clear();
  for (const { bitmap } of textureCache.values()) {
    try {
      bitmap.close();
    } catch {
      /* noop */
    }
  }
  textureCache.clear();
  inflight.clear();
}
