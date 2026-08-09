// @ts-nocheck
/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { csmVector, iterator } from '@framework/type/csmvector';

import { gl } from './lappglmanager';
import { decodeTextureCached } from './modelCache';

/**
 * テクスチャ管理クラス
 * 画像読み込み、管理を行うクラス。
 */
export class LAppTextureManager {
  /**
   * コンストラクタ
   */
  constructor() {
    this._textures = new csmVector<TextureInfo>();
  }

  /**
   * 解放する。
   */
  public release(): void {
    for (
      let ite: iterator<TextureInfo> = this._textures.begin();
      ite.notEqual(this._textures.end());
      ite.preIncrement()
    ) {
      gl.deleteTexture(ite.ptr().id);
    }
    this._textures = null;
  }

  /**
   * 画像読み込み
   *
   * @param fileName 読み込む画像ファイルパス名
   * @param usePremultiply Premult処理を有効にするか
   * @return 画像情報、読み込み失敗時はnullを返す
   */
  public createTextureFromPngFile(
    fileName: string,
    usePremultiply: boolean,
    callback: (textureInfo: TextureInfo) => void
  ): void {
    // search loaded texture already
    for (
      let ite: iterator<TextureInfo> = this._textures.begin();
      ite.notEqual(this._textures.end());
      ite.preIncrement()
    ) {
      if (
        ite.ptr().fileName == fileName &&
        ite.ptr().usePremultply == usePremultiply
      ) {
        // 2回目以降はキャッシュが使用される(待ち時間なし)
        // WebKitでは同じImageのonloadを再度呼ぶには再インスタンスが必要
        // 詳細：https://stackoverflow.com/a/5024181
        ite.ptr().img = new Image();
        ite
          .ptr()
          .img.addEventListener('load', (): void => callback(ite.ptr()), {
            passive: true
          });
        ite.ptr().img.src = fileName;
        return;
      }
    }

    // 跨「隐藏/显示」周期的已解码位图缓存：跳过 PNG 解码，仅重新上传到新 GL 上下文。
    // 隐藏角色时整个 GL 上下文被销毁、纹理删除，但解码后的 ImageBitmap 仍留在内存中，
    // 重新显示时直接 texImage2D 上传即可（GPU 上传成本远低于解码）。
    decodeTextureCached(fileName)
      .then((cached): void => {
        if (cached) {
          const tex: WebGLTexture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MIN_FILTER,
            gl.LINEAR_MIPMAP_LINEAR
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          if (usePremultiply) {
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
          }
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            cached.bitmap
          );
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.bindTexture(gl.TEXTURE_2D, null);

          const textureInfo: TextureInfo = new TextureInfo();
          if (textureInfo != null) {
            textureInfo.fileName = fileName;
            textureInfo.width = cached.width;
            textureInfo.height = cached.height;
            textureInfo.id = tex;
            textureInfo.img = new Image();
            textureInfo.usePremultply = usePremultiply;
            this._textures.pushBack(textureInfo);
          }
          callback(textureInfo);
          return;
        }

        // fallback：原始的 HTMLImageElement 解码路径（首次加载或缓存缺失时）
        const img = new Image();
        img.addEventListener(
          'load',
          (): void => {
            const tex: WebGLTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(
              gl.TEXTURE_2D,
              gl.TEXTURE_MIN_FILTER,
              gl.LINEAR_MIPMAP_LINEAR
            );
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            if (usePremultiply) {
              gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
            }
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              img
            );
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.bindTexture(gl.TEXTURE_2D, null);

            const textureInfo: TextureInfo = new TextureInfo();
            if (textureInfo != null) {
              textureInfo.fileName = fileName;
              textureInfo.width = img.width;
              textureInfo.height = img.height;
              textureInfo.id = tex;
              textureInfo.img = img;
              textureInfo.usePremultply = usePremultiply;
              this._textures.pushBack(textureInfo);
            }
            callback(textureInfo);
          },
          { passive: true }
        );
        img.addEventListener(
          'error',
          (): void => {
            console.error('[TextureManager] Failed to load texture:', fileName);
            callback(null);
          },
          { passive: true }
        );
        img.src = fileName;
      })
      .catch((err): void => {
        console.error('[TextureManager] decode cache failed:', fileName, err);
        callback(null);
      });
  }

  /**
   * 画像の解放
   *
   * 配列に存在する画像全てを解放する。
   */
  public releaseTextures(): void {
    for (let i = 0; i < this._textures.getSize(); i++) {
      this._textures.set(i, null);
    }

    this._textures.clear();
  }

  /**
   * 画像の解放
   *
   * 指定したテクスチャの画像を解放する。
   * @param texture 解放するテクスチャ
   */
  public releaseTextureByTexture(texture: WebGLTexture): void {
    for (let i = 0; i < this._textures.getSize(); i++) {
      if (this._textures.at(i).id != texture) {
        continue;
      }

      this._textures.set(i, null);
      this._textures.remove(i);
      break;
    }
  }

  /**
   * 画像の解放
   *
   * 指定した名前の画像を解放する。
   * @param fileName 解放する画像ファイルパス名
   */
  public releaseTextureByFilePath(fileName: string): void {
    for (let i = 0; i < this._textures.getSize(); i++) {
      if (this._textures.at(i).fileName == fileName) {
        this._textures.set(i, null);
        this._textures.remove(i);
        break;
      }
    }
  }

  _textures: csmVector<TextureInfo>;
}

/**
 * 画像情報構造体
 */
export class TextureInfo {
  img: HTMLImageElement; // 画像
  id: WebGLTexture = null; // テクスチャ
  width = 0; // 横幅
  height = 0; // 高さ
  usePremultply: boolean; // Premult処理を有効にするか
  fileName: string; // ファイル名
}
