// @ts-nocheck
/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { csmVector } from '@framework/type/csmvector';

import * as LAppDefine from './lappdefine';
import { canvas } from './lappglmanager';
import { LAppModel } from './lappmodel';
import { LAppPal } from './lapppal';

export let s_instance: LAppLive2DManager = null;

/**
 * サンプルアプリケーションにおいてCubismModelを管理するクラス
 * モデル生成と破棄、タップイベントの処理、モデル切り替えを行う。
 */
export class LAppLive2DManager {
  /**
   * クラスのインスタンス（シングルトン）を返す。
   * インスタンスが生成されていない場合は内部でインスタンスを生成する。
   *
   * @return クラスのインスタンス
   */
  public static getInstance(): LAppLive2DManager {
    if (s_instance == null) {
      s_instance = new LAppLive2DManager();
    }

    return s_instance;
  }

  /**
   * クラスのインスタンス（シングルトン）を解放する。
   */
  public static releaseInstance(): void {
    if (s_instance != null) {
      s_instance = void 0;
    }

    s_instance = null;
  }

  /**
   * 現在のシーンで保持しているモデルを返す。
   *
   * @param no モデルリストのインデックス値
   * @return モデルのインスタンスを返す。インデックス値が範囲外の場合はNULLを返す。
   */
  public getModel(no: number): LAppModel {
    if (no < this._models.getSize()) {
      return this._models.at(no);
    }

    return null;
  }

  /**
   * 現在のシーンで保持しているすべてのモデルを解放する
   */
  public releaseAllModel(): void {
    for (let i = 0; i < this._models.getSize(); i++) {
      this._models.at(i).release();
      this._models.set(i, null);
    }

    this._models.clear();
  }

  /**
   * 画面をドラッグした時の処理
   *
   * @param x 画面のX座標
   * @param y 画面のY座標
   */
  public onDrag(x: number, y: number): void {
    for (let i = 0; i < this._models.getSize(); i++) {
      const model: LAppModel = this.getModel(i);

      if (model) {
        model.setDragging(x, y);
      }
    }
  }

  /**
   * 画面をタップした時の処理
   *
   * @param x 画面のX座標
   * @param y 画面のY座標
   */
  public onTap(x: number, y: number): void {
    if (LAppDefine.DebugLogEnable) {
      LAppPal.printMessage(
        `[APP]tap point: {x: ${x.toFixed(2)} y: ${y.toFixed(2)}}`
      );
    }

    for (let i = 0; i < this._models.getSize(); i++) {
      // 点击画布后播放随机动作
      this._models
        .at(i)
        .startRandomMotion(
          LAppDefine.MotionGroupTapBody,
          LAppDefine.PriorityNormal,
          this._finishedMotion
        );
    }
  }

  /**
   * 画面を更新するときの処理
   * モデルの更新処理及び描画処理を行う
   */
  public onUpdate(): void {
    const { width, height } = canvas;

    const modelCount: number = this._models.getSize();

    for (let i = 0; i < modelCount; ++i) {
      const projection: CubismMatrix44 = new CubismMatrix44();
      const model: LAppModel = this.getModel(i);

      if (model.getModel()) {
        // 参考 airi fit-model.ts 的等比缩放算法
        // airi: scale = min(canvasH/modelH * 2, canvasW/modelW * 2)
        // 在 Cubism SDK 中通过投影矩阵实现等价效果

        const viewportAspect = width / height; // 宽/高
        const size = model.getCorrectCanvasSize();
        const modelCanvasW = size.w;
        const modelCanvasH = size.h;
        const modelAspect = modelCanvasW / modelCanvasH; // 宽/高（与 viewportAspect 一致）

        // 安全系数：给动画/呼吸/头部运动留余量，防止边缘裁切
        const SAFE = 0.98;

        // 步骤1：修正投影矩阵，使世界坐标 X/Y 像素密度一致（保持宽高比）
        // 默认：1 X单位 = width/2 像素，1 Y单位 = height/2 像素
        // 修正后：X 和 Y 单位长度相同，模型不会变形
        let modelWidth: number;
        if (modelAspect > viewportAspect) {
          // 模型比视口"宽" → 以宽度为基准，Y 方向补偿
          projection.scaleRelative(1.0, viewportAspect);
          modelWidth = 2.0 * SAFE;
        } else {
          // 模型比视口"高" → 以高度为基准，X 方向补偿
          projection.scaleRelative(1.0 / viewportAspect, 1.0);
          modelWidth = 2.0 * modelAspect * SAFE;
        }

        // 步骤2：设置模型宽度（ModelMatrix）
        model.getModelMatrix().setWidth(modelWidth);

        // 步骤3：应用用户缩放（等比缩放，X/Y 相同）
        projection.scaleRelative(model._scale, model._scale);
        projection.scaleRelative(this.zoomFactor, this.zoomFactor);

        // 横向拉伸（独立于等比缩放，用户可调）
        projection.scaleRelative(this.modelWidthRatio || 1.0, 1.0);

        // 步骤4：垂直定位 — 底部对齐 + feetOffset
        // 投影矩阵 = Scale * Translate，所以 NDC_Y = (world_Y + ty) * sy
        // 模型底部在世界坐标 Y = -modelHeight/2
        // 要让底部对齐 NDC Y=-1：(-modelHeight/2 + ty) * sy = -1
        // 解得：ty = -1/sy + modelHeight/2
        const sy = projection.getScaleY();
        const sx = projection.getScaleX();
        const modelHeightWorld = modelWidth * (modelCanvasH / modelCanvasW);

        // feetOffset：模型坐标系的底部留白，正值 = 向上偏移
        const feetOffsetWorld = (this.feetOffset / modelCanvasH) * modelHeightWorld;
        const ty = -1.0 / sy + modelHeightWorld / 2 + feetOffsetWorld;
        projection.translateRelative(0, ty);

        projection.translateRelative(model._translateX, model._translateY);

        // 必要があればここで乗算
        if (this._viewMatrix != null) {
          projection.multiplyByMatrix(this._viewMatrix);
        }
      }

      model.update();
      model.draw(projection); // 参照渡しなのでprojectionは変質する。
    }
  }

  /**
   * 次のシーンに切りかえる
   * サンプルアプリケーションではモデルセットの切り替えを行う。
   */
  public nextScene(): void {
    const no: number = (this._sceneIndex + 1) % LAppDefine.ModelDirSize;
    this.changeScene(no);
  }

  /**
   * シーンを切り替える
   * サンプルアプリケーションではモデルセットの切り替えを行う。
   */
  public changeScene(index: number): void {
    this._sceneIndex = index;
    if (LAppDefine.DebugLogEnable) {
      LAppPal.printMessage(`[APP]model index: ${this._sceneIndex}`);
    }

    // ModelDir[]に保持したディレクトリ名から
    // model3.jsonのパスを決定する。
    // ディレクトリ名とmodel3.jsonの名前を一致させておくこと。
    const model: string = LAppDefine.ModelDir[index];
    const modelPath: string = LAppDefine.ResourcesPath + model + '/';
    let modelJsonName: string = LAppDefine.ModelDir[index];
    modelJsonName += '.model3.json';

    this.releaseAllModel();
    this._models.pushBack(new LAppModel());
    this._models.at(0).loadAssets(modelPath, modelJsonName);
  }

  public setViewMatrix(m: CubismMatrix44) {
    for (let i = 0; i < 16; i++) {
      this._viewMatrix.getArray()[i] = m.getArray()[i];
    }
  }

  /**
   * コンストラクタ
   */
  constructor() {
    this._viewMatrix = new CubismMatrix44();
    this._models = new csmVector<LAppModel>();
    this._sceneIndex = 0;
    // this.changeScene(this._sceneIndex);
  }

  _viewMatrix: CubismMatrix44; // モデル描画に用いるview行列
  _models: csmVector<LAppModel>; // モデルインスタンスのコンテナ
  _sceneIndex: number; // 表示するシーンのインデックス値
  zoomFactor: number = 1.0; // 窗口触底时的追加缩放
  feetOffset: number = 0; // 脚部偏移（模型坐标系单位，与 getCanvasWidth 同单位）
  modelWidthRatio: number = 1.0; // 横向拉伸比例（>1 变宽，<1 变窄）
  baseViewportAspect: number = 0; // petScale=1.0 时的 viewport 宽高比（用于缩放补偿）
  _cachedModelW: number = 0; // 缓存的模型 canvas 宽度（首次有效值后锁定）
  _cachedModelH: number = 0; // 缓存的模型 canvas 高度
  _externalModelW: number = 0; // 外部传入的模型宽度（从 model3.json）
  _externalModelH: number = 0; // 外部传入的模型高度
  
  // モーション再生終了のコールバック関数
  // 模型加载回调
  onModelReady: (() => void) | null = null;
  onModelError: ((err: string) => void) | null = null;

  /** 设置模型加载回调 */
  public setModelLoadCallbacks(
    onReady: (() => void) | null,
    onError: ((err: string) => void) | null,
  ): void {
    this.onModelReady = onReady;
    this.onModelError = onError;
  }

  _finishedMotion = (_self: ACubismMotion): void => {
    /* 动画结束回调（静默） */
  };

  /**
   * 加载模型
   * @param modelDir 模型目录
   */
  public loadModel(modelDir: string) {
    // 拼接模型路径和模型名称
    const modelName = modelDir.substring(
      modelDir.lastIndexOf('/', modelDir.lastIndexOf('/') - 1) + 1,
      modelDir.length - 1
    );
    const modelJsonName: string = modelName + '.model3.json';
    // 释放全部模型
    this.releaseAllModel();
    // 数组添加新的模型
    this._models.pushBack(new LAppModel());
    const model = this._models.at(0);
    model._onReadyCallback = this.onModelReady;
    model._onErrorCallback = this.onModelError;
    model.loadAssets(modelDir, modelJsonName);
  }

  /**
   * 完整な model3.json パスからモデルを読み込む。
   * 例: "/models/nahida/Nahida_1080.model3.json"
   * @param model3JsonPath model3.json のフルパス
   */
  public loadModelFromJson(model3JsonPath: string): void {
    // パスからディレクトリとファイル名を解析
    const lastSlash = model3JsonPath.lastIndexOf('/');
    const modelDir = model3JsonPath.substring(0, lastSlash + 1);
    const modelJsonName = model3JsonPath.substring(lastSlash + 1);

    this.releaseAllModel();
    this._models.pushBack(new LAppModel());
    const model = this._models.at(0);
    model._onReadyCallback = this.onModelReady;
    model._onErrorCallback = this.onModelError;
    model.loadAssets(modelDir, modelJsonName);
  }

  /**
   * 获取模型的 canvas 尺寸（模型坐标系单位）。
   * 优先使用 getCorrectCanvasSize() 绕过 SDK bug。
   */
  public getModelCanvasSize(): { width: number; height: number } | null {
    const model = this.getModel(0);
    if (!model?.getModel()) return null;
    const size = model.getCorrectCanvasSize();
    return { width: size.w, height: size.h };
  }

  /**
   * 随机表情
   */
  public randomExpression() {
    for (let i = 0; i < this._models.getSize(); i++) {
      this._models.at(i).setRandomExpression();
    }
  }
}
