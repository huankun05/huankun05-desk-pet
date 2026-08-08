// @ts-nocheck
/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismDefaultParameterId } from '@framework/cubismdefaultparameterid';
import { CubismModelSettingJson } from '@framework/cubismmodelsettingjson';
import {
  BreathParameterData,
  CubismBreath
} from '@framework/effect/cubismbreath';
import { CubismEyeBlink } from '@framework/effect/cubismeyeblink';
import { ICubismModelSetting } from '@framework/icubismmodelsetting';
import { CubismIdHandle } from '@framework/id/cubismid';
import { CubismFramework } from '@framework/live2dcubismframework';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismUserModel } from '@framework/model/cubismusermodel';
import {
  ACubismMotion,
  FinishedMotionCallback
} from '@framework/motion/acubismmotion';
import { CubismMotion } from '@framework/motion/cubismmotion';
import {
  CubismMotionQueueEntryHandle,
  InvalidMotionQueueEntryHandleValue
} from '@framework/motion/cubismmotionqueuemanager';
import { csmMap } from '@framework/type/csmmap';
import { csmRect } from '@framework/type/csmrectf';
import { csmString } from '@framework/type/csmstring';
import { csmVector } from '@framework/type/csmvector';
import {
  CSM_ASSERT,
  CubismLogError,
  CubismLogInfo
} from '@framework/utils/cubismdebug';

import * as LAppDefine from './lappdefine';
import { frameBuffer, LAppDelegate } from './lappdelegate';
import { canvas, gl } from './lappglmanager';
import { LAppPal } from './lapppal';
import { TextureInfo } from './lapptexturemanager';
import {
  createBlinkState,
  updateBlink,
  createSaccadeState,
  updateSaccade,
  createLipSyncState,
  updateLipSync,
  createSpringState,
  updateSpring,
  HEAD_SPRING_CONFIG,
  BODY_SPRING_CONFIG,
  createBeatSyncController,
  applyBeatSyncToSprings,
  type BeatSyncController,
  createIdleSwayState,
  updateIdleSway,
  type IdleSwayState,
} from './animation';
import { LAppWavFileHandler } from './lappwavfilehandler';
import { CubismMoc } from '@framework/model/cubismmoc';

enum LoadStep {
  LoadAssets,
  LoadModel,
  WaitLoadModel,
  LoadExpression,
  WaitLoadExpression,
  LoadPhysics,
  WaitLoadPhysics,
  LoadPose,
  WaitLoadPose,
  SetupEyeBlink,
  SetupBreath,
  LoadUserData,
  WaitLoadUserData,
  SetupEyeBlinkIds,
  SetupLipSyncIds,
  SetupLayout,
  LoadMotion,
  WaitLoadMotion,
  CompleteInitialize,
  CompleteSetupModel,
  LoadTexture,
  WaitLoadTexture,
  CompleteSetup
}

/**
 * ユーザーが実際に使用するモデルの実装クラス<br>
 * モデル生成、機能コンポーネント生成、更新処理とレンダリングの呼び出しを行う。
 */
export class LAppModel extends CubismUserModel {
  /**
   * @param fileName
   */
  public loadAssets(dir: string, fileName: string): void {
    this._modelHomeDir = dir;

    // 并行加载所有独立资源，消除串行瀑布流
    const tasks: Promise<void>[] = [];

    // 1. model3.json 必须最先完成，因为它初始化 _modelSetting
    const model3Promise = fetch(`${this._modelHomeDir}${fileName}`)
      .then((r) => {
        if (r.ok) return r.arrayBuffer();
        if (r.status >= 400) {
          CubismLogError(`Failed to load file ${this._modelHomeDir}${fileName}`);
          this._onErrorCallback?.(`无法加载模型描述文件: ${fileName} (HTTP ${r.status})`);
          return new ArrayBuffer(0);
        }
        return r.arrayBuffer();
      })
      .then((arrayBuffer) => {
        // 保存 model3.json 原始对象，绕过 CubismJson 对「对象数组」(FileReferences.Expressions)
        // 解析失败导致 getExpressionCount() 恒为 0 的缺陷（详见表情加载回退逻辑）。
        try {
          const text = new TextDecoder('utf-8').decode(arrayBuffer);
          this._model3Json = JSON.parse(text);
        } catch {
          this._model3Json = null;
        }
        const setting: ICubismModelSetting = new CubismModelSettingJson(
          arrayBuffer,
          arrayBuffer.byteLength
        );
        this._state = LoadStep.LoadModel;
        this._modelSetting = setting;
        this._updating = true;
        this._initialized = false;
        return setting;
      })
      .catch((err) => {
        CubismLogError(`Failed to load file ${this._modelHomeDir}${fileName}`);
        this._onErrorCallback?.(`无法加载模型描述文件: ${fileName}`);
        return null;
      });

    // 1.5 model3 解析完成后，再并行加载 MOC 与表情。
    //      关键修复：_model3Json 在 model3Promise 的 .then() 中「异步」赋值，
    //      原先表情加载代码同步执行时 _model3Json 仍为 null，导致 model3Json 回退路径
    //      永远读不到任何表情（日志表现为 source = NONE | count = 0）。
    //      现把 MOC 与表情加载都放进 model3Promise.then()，确保 _model3Json 已就绪。
    tasks.push(
      model3Promise.then((setting) => {
        if (!setting) return;

        const subTasks: Promise<void>[] = [];

        // --- MOC ---
        const modelFileName = setting.getModelFileName();
        if (modelFileName) {
          subTasks.push(
            fetch(`${this._modelHomeDir}${modelFileName}`)
              .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
              .then((mocArrayBuffer) => {
                this.loadModel(mocArrayBuffer, this._mocConsistency);
              })
              .catch((err) => console.error('[Live2D] MOC3 load failed:', modelFileName, err)),
          );
        }

        // --- Expressions ---
        // 注意：此 SDK 的 CubismJson 解析器对「对象数组」(FileReferences.Expressions)
        // 解析失败，导致 getExpressionCount() 恒为 0、表情永远不加载。
        // 因此优先用 SDK 接口，读不到时回退到 model3.json 原始对象（我们自己 JSON.parse）。
        interface ExprEntry { Name: string; File: string }
        const expressionList: ExprEntry[] = [];
        if (this._modelSetting && this._modelSetting.getExpressionCount() > 0) {
          const n = this._modelSetting.getExpressionCount();
          for (let i = 0; i < n; i++) {
            expressionList.push({
              Name: this._modelSetting.getExpressionName(i),
              File: this._modelSetting.getExpressionFileName(i),
            });
          }
        } else {
          const refs = (this._model3Json as { FileReferences?: { Expressions?: ExprEntry[] } } | null)
            ?.FileReferences?.Expressions;
          if (Array.isArray(refs)) {
            for (const e of refs) {
              if (e && e.Name && e.File) expressionList.push({ Name: e.Name, File: e.File });
            }
          }
        }

        for (const { Name: expressionName, File: expressionFileName } of expressionList) {
          subTasks.push(
            fetch(`${this._modelHomeDir}${expressionFileName}`)
              .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
              .then((arrayBuffer) => {
                const motion: ACubismMotion = this.loadExpression(
                  arrayBuffer,
                  arrayBuffer.byteLength,
                  expressionName,
                );
                const existing = this._expressions.getValue(expressionName);
                if (existing) ACubismMotion.delete(existing);
                this._expressions.setValue(expressionName, motion);
                this._expressionCount++;
              })
              .catch((err) => console.error('[Live2D] Expression load failed:', expressionFileName, err)),
          );
        }

        return Promise.allSettled(subTasks).then(() => {});
      }),
    );

    // 2. config.json
    tasks.push(
      fetch(`${this._modelHomeDir}config.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (json) {
            this._scale = json.scale ?? 1.0;
            this._translateX = json.translate?.x ?? 0;
            this._translateY = json.translate?.y ?? 0;
          }
        })
        .catch(() => { /* non-fatal */ }),
    );

    // （表情加载已合并到上方 model3Promise.then 中，见「1.5」注释，避免 _model3Json 异步未就绪）

    // 4. physics / pose / userData（并行）
    const physicsFile = this._modelSetting ? (this._modelSetting.getPhysicsFileName() as string) : '';
    const poseFile = this._modelSetting ? (this._modelSetting.getPoseFileName() as string) : '';
    const userDataFile = this._modelSetting ? (this._modelSetting.getUserDataFile() as string) : '';

    if (physicsFile) {
      tasks.push(
        fetch(`${this._modelHomeDir}${physicsFile}`)
          .then((r) => {
            if (r.ok) return r.arrayBuffer();
            if (r.status >= 400) {
              CubismLogError(`Failed to load file ${this._modelHomeDir}${physicsFile}`);
              return new ArrayBuffer(0);
            }
            return r.arrayBuffer();
          })
          .then((ab) => this.loadPhysics(ab, ab.byteLength))
          .catch((err) => console.error('[Live2D] Physics load failed:', physicsFile, err)),
      );
    }

    if (poseFile) {
      tasks.push(
        fetch(`${this._modelHomeDir}${poseFile}`)
          .then((r) => {
            if (r.ok) return r.arrayBuffer();
            if (r.status >= 400) {
              CubismLogError(`Failed to load file ${this._modelHomeDir}${poseFile}`);
              return new ArrayBuffer(0);
            }
            return r.arrayBuffer();
          })
          .then((ab) => this.loadPose(ab, ab.byteLength))
          .catch((err) => console.error('[Live2D] Pose load failed:', poseFile, err)),
      );
    }

    if (userDataFile) {
      tasks.push(
        fetch(`${this._modelHomeDir}${userDataFile}`)
          .then((r) => {
            if (r.ok) return r.arrayBuffer();
            if (r.status >= 400) {
              CubismLogError(`Failed to load file ${this._modelHomeDir}${userDataFile}`);
              return new ArrayBuffer(0);
            }
            return r.arrayBuffer();
          })
          .then((ab) => this.loadUserData(ab, ab.byteLength))
          .catch((err) => console.error('[Live2D] UserData load failed:', userDataFile, err)),
      );
    }

    // 5. 统一完成后再继续 motion / texture 阶段
    this._state = LoadStep.WaitLoadModel;
    Promise.allSettled(tasks)
      .then(() => {
        this._state = LoadStep.LoadMotion;
        if (!this._model) {
          console.error('[Live2D] Model failed to initialize after asset loading');
          if (this._onErrorCallback) {
            this._onErrorCallback('模型初始化失败，请检查模型文件是否完整');
          }
          return;
        }
        this._model.saveParameters();
        this._allMotionCount = 0;
        this._motionCount = 0;
        const group: string[] = [];
        const motionGroupCount = this._modelSetting.getMotionGroupCount();
        for (let i = 0; i < motionGroupCount; i++) {
          group[i] = this._modelSetting.getMotionGroupName(i);
          this._allMotionCount += this._modelSetting.getMotionCount(group[i]);
        }

        if (motionGroupCount === 0) {
          this._state = LoadStep.LoadTexture;
          this._motionManager.stopAllMotions();
          this._updating = false;
          this._initialized = true;
          this.createRenderer();
          this.setupTextures();
          this.getRenderer().startUp(gl);
          return;
        }

        // 并行预加载所有 motion group
        const motionTasks: Promise<void>[] = [];
        for (let i = 0; i < motionGroupCount; i++) {
          motionTasks.push(this._preLoadMotionGroupParallel(group[i]));
        }
        Promise.allSettled(motionTasks).then(() => {
          this._state = LoadStep.LoadTexture;
          this._motionManager.stopAllMotions();
          this._updating = false;
          this._initialized = true;
          this.createRenderer();
          this.setupTextures();
          this.getRenderer().startUp(gl);
        });
      })
      .catch((err) => console.error('[Live2D] Asset pipeline failed:', err));
  }

  /** 并行加载单个 motion group 内的所有 motion */
  private _preLoadMotionGroupParallel(group: string): Promise<void> {
    return new Promise((resolve) => {
      const count = this._modelSetting.getMotionCount(group);
      if (count === 0) {
        resolve();
        return;
      }

      const motionPromises: Promise<void>[] = [];
      for (let i = 0; i < count; i++) {
        const motionFileName = this._modelSetting.getMotionFileName(group, i);
        const name = `${group}_${i}`;
        motionPromises.push(
          fetch(`${this._modelHomeDir}${motionFileName}`)
            .then((r) => {
              if (r.ok) return r.arrayBuffer();
              if (r.status >= 400) {
                CubismLogError(`Failed to load file ${this._modelHomeDir}${motionFileName}`);
                return new ArrayBuffer(0);
              }
              return r.arrayBuffer();
            })
            .then((arrayBuffer) => {
              const tmpMotion: CubismMotion = this.loadMotion(
                arrayBuffer,
                arrayBuffer.byteLength,
                name
              );
              if (tmpMotion != null) {
                let fadeTime = this._modelSetting.getMotionFadeInTimeValue(group, i);
                if (fadeTime >= 0.0) tmpMotion.setFadeInTime(fadeTime);
                fadeTime = this._modelSetting.getMotionFadeOutTimeValue(group, i);
                if (fadeTime >= 0.0) tmpMotion.setFadeOutTime(fadeTime);
                tmpMotion.setEffectIds(this._eyeBlinkIds, this._lipSyncIds);
                const existing = this._motions.getValue(name);
                if (existing) ACubismMotion.delete(existing);
                this._motions.setValue(name, tmpMotion);
                this._motionCount++;
              } else {
                this._allMotionCount--;
              }
            })
            .catch((err) => console.error('[Live2D] Motion load failed:', motionFileName, err)),
        );
      }

      Promise.allSettled(motionPromises).then(() => resolve());
    });
  }

  /**
   * テクスチャユニットにテクスチャをロードする
   */
  private setupTextures(): void {
    // iPhoneでのアルファ品質向上のためTypescriptではpremultipliedAlphaを採用
    const usePremultiply = true;

    if (this._state == LoadStep.LoadTexture) {
      // テクスチャ読み込み用
      const textureCount: number = this._modelSetting.getTextureCount();

      for (
        let modelTextureNumber = 0;
        modelTextureNumber < textureCount;
        modelTextureNumber++
      ) {
        // テクスチャ名が空文字だった場合はロード・バインド処理をスキップ
        if (this._modelSetting.getTextureFileName(modelTextureNumber) == '') {
          continue;
        }

        // WebGLのテクスチャユニットにテクスチャをロードする
        let texturePath =
          this._modelSetting.getTextureFileName(modelTextureNumber);
        texturePath = this._modelHomeDir + texturePath;

        // ロード完了時に呼び出すコールバック関数
        const onLoad = (textureInfo: TextureInfo): void => {
          if (textureInfo && textureInfo.id) {
            this.getRenderer().bindTexture(modelTextureNumber, textureInfo.id);
          }

          this._textureCount++;

          if (this._textureCount >= textureCount) {
            // ロード完了
            this._state = LoadStep.CompleteSetup;
            // 通知外部模型加载完成
            this._onReadyCallback?.();
          }
        };

        // 読み込み
        LAppDelegate.getInstance()
          .getTextureManager()
          .createTextureFromPngFile(texturePath, usePremultiply, onLoad);
        this.getRenderer().setIsPremultipliedAlpha(usePremultiply);
      }

      this._state = LoadStep.WaitLoadTexture;
    }
  }

  /**
   * レンダラを再構築する
   */
  public reloadRenderer(): void {
    this.deleteRenderer();
    this.createRenderer();
    this.setupTextures();
  }

  /**
   * 更新
   */
  public update(): void {
    if (this._state != LoadStep.CompleteSetup) return;

    const deltaTimeSeconds: number = LAppPal.getDeltaTime();
    this._userTimeSeconds += deltaTimeSeconds;

    this._dragManager.update(deltaTimeSeconds);
    this._dragX = this._dragManager.getX();
    this._dragY = this._dragManager.getY();

    // モーションによるパラメータ更新の有無
    let motionUpdated = false;

    //--------------------------------------------------------------------------
    this._model.loadParameters(); // 前回セーブされた状態をロード
    if (this._motionManager.isFinished()) {
      // モーションの再生がない場合、待機モーションの中からランダムで再生する
      this.startRandomMotion(
        LAppDefine.MotionGroupIdle,
        LAppDefine.PriorityIdle
      );
    } else {
      motionUpdated = this._motionManager.updateMotion(
        this._model,
        deltaTimeSeconds
      ); // モーションを更新
    }
    this._model.saveParameters(); // 状態を保存
    //--------------------------------------------------------------------------

    // まばたき
    if (this._useCustomBlink) {
      // 自定义三阶段眨眼状态机（借鉴 AIRI）
      const dtMs = deltaTimeSeconds * 1000;
      const baseEyeL = this._model.getParameterValueById(CubismDefaultParameterId.ParamEyeLOpen) ?? 1;
      const baseEyeR = this._model.getParameterValueById(CubismDefaultParameterId.ParamEyeROpen) ?? 1;
      // 表情已闭眼时抑制眨眼
      const suppress = baseEyeL <= 0.15 && baseEyeR <= 0.15;
      const eyeL = updateBlink(this._blinkState, dtMs, baseEyeL, suppress);
      const eyeR = updateBlink(this._blinkState, dtMs, baseEyeR, suppress);
      this._model.setParameterValueById(CubismDefaultParameterId.ParamEyeLOpen, eyeL);
      this._model.setParameterValueById(CubismDefaultParameterId.ParamEyeROpen, eyeR);
    } else if (!motionUpdated) {
      if (this._eyeBlink != null) {
        this._eyeBlink.updateParameters(this._model, deltaTimeSeconds);
      }
    }

    if (this._expressionManager != null) {
      this._expressionManager.updateMotion(this._model, deltaTimeSeconds); // 表情でパラメータ更新（相対変化）
    }

    // === idle 平滑过渡 ===
    // _idleBlend: 0=鼠标追踪, 1=完全 idle，约 1 秒过渡
    const targetBlend = this._isIdle ? 1.0 : 0.0;
    const blendSpeed = 1.0; // 每秒变化 1.0，约 1 秒完成
    this._idleBlend += (targetBlend - this._idleBlend) * Math.min(1, deltaTimeSeconds * blendSpeed);
    if (this._idleBlend < 0.001) this._idleBlend = 0;
    if (this._idleBlend > 0.999) this._idleBlend = 1;

    const nowMs = performance.now();
    const blend = this._idleBlend;
    const invBlend = 1 - blend;

    // === 眼球：鼠标追踪 ↔ 眼跳，平滑混合 ===
    let saccadeX = 0;
    let saccadeY = 0;
    if (this._useSaccade && blend > 0.01) {
      const saccade = updateSaccade(this._saccadeState, nowMs);
      saccadeX = saccade.x;
      saccadeY = saccade.y;
    }
    // 眼球眼神始终跟随光标（外部焦点 _dragX/_dragY），idle 眼跳仅作叠加的自然微动。
    // 注意：原先写成 _dragX * invBlend，idle 时 invBlend→0 会把外部焦点乘没，
    // 表现为"鼠标/摄像头跟随消失"。这里改为始终生效，避免该问题。
    // 乘以用户灵敏度 sens，使「鼠标追踪灵敏度」对眼神/头部/身体三者等比生效，整体协调。
    const sens = this._mouseSensitivity;
    const EYE_BASE = 0.5; // 默认灵敏度(sens=1)下眼球基准幅度（参数单位）；sens 调高时眼神随之放大至满偏
    const eyeX = this._dragX * EYE_BASE * sens + saccadeX * blend;
    // 注意：光标 Y 向下为正（屏幕坐标），但 Live2D 的 ParamEyeBallY 向上为正，
    // 与 ParamAngleY（向下为正）符号相反。这里对 Y 取负，使光标向下时眼球也向下看。
    const eyeLookY = this._dragY * EYE_BASE * sens; // 屏幕坐标，向下为正
    // ParamEyeBallY 向上为正 → 取负；向上看(dragY<0)时放大增益(1.8x)，
    // 补偿模型抬头响应弱 + 窗口偏屏幕下方导致上方光标范围小，使"向上看"更明显。
    const eyeY = -(this._dragY < 0 ? eyeLookY * 1.4 : eyeLookY) - saccadeY * blend;
    this._model.setParameterValueById(this._idParamEyeBallX, eyeX);
    this._model.setParameterValueById(this._idParamEyeBallY, eyeY);

    this._beatSync.updateTargets(nowMs);

    // === 头部角度：鼠标驱动 ↔ idle 微动，平滑混合 ===
    let idleSway = { angleX: 0, angleY: 0, angleZ: 0, bodyAngleX: 0, bodyAngleY: 0 };
    if (this._useIdleSway && blend > 0.01) {
      idleSway = updateIdleSway(this._idleSwayState, nowMs, blend);
    }

    // 鼠标驱动的头部角度（乘以用户可调的灵敏度）
    // 外部焦点始终驱动头部：idle 时仍保留 0.5 权重（followWeight），
    // 使模型持续看向光标，不会因 idle 把头部锁死。
    // （sens 已在上方眼球部分统一定义，对眼神/头部/身体三者一致生效）
    const followWeight = 0.5 + 0.5 * invBlend;

    // 头部上下（鼠标在上下方时正常抬头/低头看），不再做"下蹲/弯腿"动作。
    // 注意：光标 Y 向下为正（屏幕坐标），但 Live2D 的 ParamAngleY 向上为正，
    // 与 ParamEyeBallY 一致，故对 Y 取负，使光标向下时头部也向下低头看。
    const mouseAngleX = this._dragX * 18 * sens;
    const headYRaw = -this._dragY * 18 * sens; // 取负：光标向下→低头（ParamAngleY 向上为正）
    const mouseAngleY = this._dragY < 0 ? headYRaw * 1.4 : headYRaw; // 向上看放大增益，使抬头更明显
    const mouseAngleZ = this._dragX * this._dragY * -8 * sens;

    let angleX = mouseAngleX * followWeight + idleSway.angleX * blend;
    let angleY = mouseAngleY * followWeight + idleSway.angleY * blend;
    let angleZ = mouseAngleZ * followWeight + idleSway.angleZ * blend;

    if (this._beatSync.isActive()) {
      // beat-sync 模式：Y/Z 由节拍驱动（AIRI 风格的弹簧物理）
      const beat = applyBeatSyncToSprings(
        this._beatSync,
        this._springHeadX,
        this._springBeatY,
        this._springBeatZ,
        deltaTimeSeconds,
        HEAD_SPRING_CONFIG,
      );
      angleY = beat.angleY;
      angleZ = beat.angleZ;
    }

    this._model.addParameterValueById(this._idParamAngleX, angleX);
    this._model.addParameterValueById(this._idParamAngleY, angleY);
    this._model.addParameterValueById(this._idParamAngleZ, angleZ);

    // === 身体：弹簧物理跟随头部 + idle 混合 ===
    // 幅度相对头部略小（自然感），但足够明显：X 最大约 0.8*6≈4.8°、Y 约 0.7*4≈2.8°
    // 同样用 verticalAttenuation 限制"下蹲"只在角色水平范围内下方触发。
    const bodyTargetX = this._dragX * 0.8 * sens * invBlend + idleSway.bodyAngleX / 6 * blend;
    const bodyTargetY = idleSway.bodyAngleY / 4 * blend;
    const smoothBodyX = updateSpring(this._springBodyX, bodyTargetX, deltaTimeSeconds, BODY_SPRING_CONFIG);
    const smoothBodyY = updateSpring(this._springBodyY, bodyTargetY, deltaTimeSeconds, BODY_SPRING_CONFIG);
    this._model.addParameterValueById(this._idParamBodyAngleX, smoothBodyX * 6 + idleSway.bodyAngleX * blend);
    this._model.addParameterValueById(this._idParamBodyAngleY, smoothBodyY * 4 + idleSway.bodyAngleY * blend);

    // 呼吸など
    if (this._breath != null) {
      this._breath.updateParameters(this._model, deltaTimeSeconds);
    }

    // 物理演算の設定
    if (this._physics != null) {
      this._physics.evaluate(this._model, deltaTimeSeconds);
    }

    // リップシンクの設定（通过平滑器处理，借鉴 AIRI）
    if (this._lipsync) {
      const dtMs = deltaTimeSeconds * 1000;
      // 外部值：有振幅输入时 >= 0，无输入时为 -1
      const externalValue = this._externalMouthValue;
      this._externalMouthValue = -1; // 消费后立即重置

      // 读取 motion 给的口型值（释放结束后回退用）
      const motionMouth = this._lipSyncIds.getSize() > 0
        ? (this._model.getParameterValueById(this._lipSyncIds.at(0)) ?? 0)
        : 0;

      const finalValue = updateLipSync(this._lipSyncState, dtMs, externalValue, motionMouth);

      for (let i = 0; i < this._lipSyncIds.getSize(); ++i) {
        this._model.setParameterValueById(this._lipSyncIds.at(i), finalValue);
      }
    }

    // ポーズの設定
    if (this._pose != null) {
      this._pose.updateParameters(this._model, deltaTimeSeconds);
    }

    // 瞬态参数覆盖（由 BehaviorDecorateStage 通过 eventBus 注入）
    if (this._transientParams.size > 0) {
      const now = Date.now();
      for (const [key, entry] of this._transientParams) {
        if (now >= entry.expiresAt) {
          this._transientParams.delete(key);
          continue;
        }
        this._model.setParameterValueById(key, entry.value);
      }
    }

    this._model.update();
  }

  /**
   * 引数で指定したモーションの再生を開始する
   * @param group モーショングループ名
   * @param no グループ内の番号
   * @param priority 優先度
   * @param onFinishedMotionHandler モーション再生終了時に呼び出されるコールバック関数
   * @return 開始したモーションの識別番号を返す。個別のモーションが終了したか否かを判定するisFinished()の引数で使用する。開始できない時は[-1]
   */
  public startMotion(
    group: string,
    no: number,
    priority: number,
    onFinishedMotionHandler?: FinishedMotionCallback
  ): CubismMotionQueueEntryHandle {
    if (!this._modelSetting) {
      return InvalidMotionQueueEntryHandleValue;
    }
    if (priority == LAppDefine.PriorityForce) {
      this._motionManager.setReservePriority(priority);
    } else if (!this._motionManager.reserveMotion(priority)) {
      if (this._debugMode) {
        LAppPal.printMessage("[APP]can't start motion.");
      }
      return InvalidMotionQueueEntryHandleValue;
    }

    const motionFileName = this._modelSetting.getMotionFileName(group, no);

    // ex) idle_0
    const name = `${group}_${no}`;
    let motion: CubismMotion = this._motions.getValue(name) as CubismMotion;
    let autoDelete = false;

    if (motion == null) {
      fetch(`${this._modelHomeDir}${motionFileName}`)
        .then(response => {
          if (response.ok) {
            return response.arrayBuffer();
          } else if (response.status >= 400) {
            CubismLogError(
              `Failed to load file ${this._modelHomeDir}${motionFileName}`
            );
            return new ArrayBuffer(0);
          }
        })
        .then(arrayBuffer => {
          motion = this.loadMotion(
            arrayBuffer,
            arrayBuffer.byteLength,
            null,
            onFinishedMotionHandler
          );

          if (motion == null) {
            return;
          }

          let fadeTime: number = this._modelSetting.getMotionFadeInTimeValue(
            group,
            no
          );

          if (fadeTime >= 0.0) {
            motion.setFadeInTime(fadeTime);
          }

          fadeTime = this._modelSetting.getMotionFadeOutTimeValue(group, no);
          if (fadeTime >= 0.0) {
            motion.setFadeOutTime(fadeTime);
          }

          motion.setEffectIds(this._eyeBlinkIds, this._lipSyncIds);
          autoDelete = true; // 終了時にメモリから削除
        })
        .catch(err => console.error('[Live2D] Motion load failed:', motionFileName, err));
    } else {
      motion.setFinishedMotionHandler(onFinishedMotionHandler);
    }

    //voice
    const voice = this._modelSetting.getMotionSoundFileName(group, no);
    if (voice.localeCompare('') != 0) {
      let path = voice;
      path = this._modelHomeDir + path;
      this._wavFileHandler.start(path);
    }

    if (this._debugMode) {
      LAppPal.printMessage(`[APP]start motion: [${group}_${no}`);
    }
    return this._motionManager.startMotionPriority(
      motion,
      autoDelete,
      priority
    );
  }

  /**
   * ランダムに選ばれたモーションの再生を開始する。
   * @param group モーショングループ名
   * @param priority 優先度
   * @param onFinishedMotionHandler モーション再生終了時に呼び出されるコールバック関数
   * @return 開始したモーションの識別番号を返す。個別のモーションが終了したか否かを判定するisFinished()の引数で使用する。開始できない時は[-1]
   */
  public startRandomMotion(
    group: string,
    priority: number,
    onFinishedMotionHandler?: FinishedMotionCallback
  ): CubismMotionQueueEntryHandle {
    if (!this._modelSetting || this._modelSetting.getMotionCount(group) == 0) {
      return InvalidMotionQueueEntryHandleValue;
    }

    const no: number = Math.floor(
      Math.random() * this._modelSetting.getMotionCount(group)
    );

    return this.startMotion(group, no, priority, onFinishedMotionHandler);
  }

  /**
   * 引数で指定した表情モーションをセットする
   *
   * @param expressionId 表情モーションのID
   */
  public setExpression(expressionId: string): void {
    const motion: ACubismMotion = this._expressions.getValue(expressionId);

    if (this._debugMode) {
      LAppPal.printMessage(`[APP]expression: [${expressionId}]`);
    }

    if (motion != null) {
      motion.setFadeInTime(0.25);
      motion.setFadeOutTime(0.25);
      this._expressionManager.startMotionPriority(
        motion,
        false,
        LAppDefine.PriorityForce
      );
    } else {
      if (this._debugMode) {
        LAppPal.printMessage(`[APP]expression[${expressionId}] is null`);
      }
    }
  }

  /**
   * ランダムに選ばれた表情モーションをセットする
   */
  public setRandomExpression(): void {
    if (this._expressions.getSize() == 0) {
      return;
    }

    const no: number = Math.floor(Math.random() * this._expressions.getSize());

    for (let i = 0; i < this._expressions.getSize(); i++) {
      if (i == no) {
        const name: string = this._expressions._keyValues[i].first;
        this.setExpression(name);
        return;
      }
    }
  }

  /**
   * イベントの発火を受け取る
   */
  public motionEventFired(eventValue: csmString): void {
    CubismLogInfo('{0} is fired on LAppModel!!', eventValue.s);
  }

  /**
   * 当たり判定テスト
   * 指定ＩＤの頂点リストから矩形を計算し、座標をが矩形範囲内か判定する。
   *
   * @param hitArenaName  当たり判定をテストする対象のID
   * @param x             判定を行うX座標
   * @param y             判定を行うY座標
   */
  public hitTest(hitArenaName: string, x: number, y: number): boolean {
    // 透明時は当たり判定無し。
    if (this._opacity < 1) {
      return false;
    }

    const count: number = this._modelSetting.getHitAreasCount();

    for (let i = 0; i < count; i++) {
      if (this._modelSetting.getHitAreaName(i) == hitArenaName) {
        const drawId: CubismIdHandle = this._modelSetting.getHitAreaId(i);
        return this.isHit(drawId, x, y);
      }
    }

    return false;
  }

  /**
   * モーションデータをグループ名から一括でロードする。
   * モーションデータの名前は内部でModelSettingから取得する。
   *
   * @param group モーションデータのグループ名
   */
  public preLoadMotionGroup(group: string): void {
    for (let i = 0; i < this._modelSetting.getMotionCount(group); i++) {
      const motionFileName = this._modelSetting.getMotionFileName(group, i);

      // ex) idle_0
      const name = `${group}_${i}`;
      if (this._debugMode) {
        LAppPal.printMessage(
          `[APP]load motion: ${motionFileName} => [${name}]`
        );
      }

      fetch(`${this._modelHomeDir}${motionFileName}`)
        .then(response => {
          if (response.ok) {
            return response.arrayBuffer();
          } else if (response.status >= 400) {
            CubismLogError(
              `Failed to load file ${this._modelHomeDir}${motionFileName}`
            );
            return new ArrayBuffer(0);
          }
        })
        .then(arrayBuffer => {
          const tmpMotion: CubismMotion = this.loadMotion(
            arrayBuffer,
            arrayBuffer.byteLength,
            name
          );

          if (tmpMotion != null) {
            let fadeTime = this._modelSetting.getMotionFadeInTimeValue(
              group,
              i
            );
            if (fadeTime >= 0.0) {
              tmpMotion.setFadeInTime(fadeTime);
            }

            fadeTime = this._modelSetting.getMotionFadeOutTimeValue(group, i);
            if (fadeTime >= 0.0) {
              tmpMotion.setFadeOutTime(fadeTime);
            }
            tmpMotion.setEffectIds(this._eyeBlinkIds, this._lipSyncIds);

            if (this._motions.getValue(name) != null) {
              ACubismMotion.delete(this._motions.getValue(name));
            }

            this._motions.setValue(name, tmpMotion);

            this._motionCount++;
            if (this._motionCount >= this._allMotionCount) {
              this._state = LoadStep.LoadTexture;

              // 全てのモーションを停止する
              this._motionManager.stopAllMotions();

              this._updating = false;
              this._initialized = true;

              this.createRenderer();
              this.setupTextures();
              this.getRenderer().startUp(gl);
            }
          } else {
            // loadMotionできなかった場合はモーションの総数がずれるので1つ減らす
            this._allMotionCount--;
          }
        })
        .catch(err => console.error('[Live2D] Motion load failed:', motionFileName, err));
    }
  }

  /**
   * すべてのモーションデータを解放する。
   */
  public releaseMotions(): void {
    this._motions.clear();
  }

  /**
   * 全ての表情データを解放する。
   */
  public releaseExpressions(): void {
    this._expressions.clear();
  }

  /**
   * モデルを描画する処理。モデルを描画する空間のView-Projection行列を渡す。
   */
  public doDraw(): void {
    if (this._model == null) return;

    // キャンバスサイズを渡す
    const viewport: number[] = [0, 0, canvas.width, canvas.height];

    this.getRenderer().setRenderState(frameBuffer, viewport);
    this.getRenderer().drawModel();
  }

  /**
   * モデルを描画する処理。モデルを描画する空間のView-Projection行列を渡す。
   */
  public draw(matrix: CubismMatrix44): void {
    if (this._model == null) {
      return;
    }

    // 各読み込み終了後
    if (this._state == LoadStep.CompleteSetup) {
      matrix.multiplyByMatrix(this._modelMatrix);

      this.getRenderer().setMvpMatrix(matrix);

      this.doDraw();
    }
  }

  public async hasMocConsistencyFromFile() {
    CSM_ASSERT(this._modelSetting.getModelFileName().localeCompare(``));

    // CubismModel
    if (this._modelSetting.getModelFileName() != '') {
      const modelFileName = this._modelSetting.getModelFileName();

      const response = await fetch(`${this._modelHomeDir}${modelFileName}`);
      const arrayBuffer = await response.arrayBuffer();

      this._consistency = CubismMoc.hasMocConsistency(arrayBuffer);

      if (!this._consistency) {
        CubismLogInfo('Inconsistent MOC3.');
      } else {
        CubismLogInfo('Consistent MOC3.');
      }

      return this._consistency;
    } else {
      LAppPal.printMessage('Model data does not exist.');
    }
  }

  /**
   * コンストラクタ
   */
  public constructor() {
    super();

    this._modelSetting = null;
    this._model3Json = null;
    this._modelHomeDir = null;
    this._userTimeSeconds = 0.0;

    this._eyeBlinkIds = new csmVector<CubismIdHandle>();
    this._lipSyncIds = new csmVector<CubismIdHandle>();

    this._motions = new csmMap<string, ACubismMotion>();
    this._expressions = new csmMap<string, ACubismMotion>();

    this._hitArea = new csmVector<csmRect>();
    this._userArea = new csmVector<csmRect>();

    this._idParamAngleX = CubismFramework.getIdManager().getId(
      CubismDefaultParameterId.ParamAngleX
    );
    this._idParamAngleY = CubismFramework.getIdManager().getId(
      CubismDefaultParameterId.ParamAngleY
    );
    this._idParamAngleZ = CubismFramework.getIdManager().getId(
      CubismDefaultParameterId.ParamAngleZ
    );
    this._idParamEyeBallX = CubismFramework.getIdManager().getId(
      CubismDefaultParameterId.ParamEyeBallX
    );
    this._idParamEyeBallY = CubismFramework.getIdManager().getId(
      CubismDefaultParameterId.ParamEyeBallY
    );
    this._idParamBodyAngleX = CubismFramework.getIdManager().getId(
      CubismDefaultParameterId.ParamBodyAngleX
    );
    this._idParamBodyAngleY = CubismFramework.getIdManager().getId(
      CubismDefaultParameterId.ParamBodyAngleY
    );

    if (LAppDefine.MOCConsistencyValidationEnable) {
      this._mocConsistency = true;
    }

    this._state = LoadStep.LoadAssets;
    this._expressionCount = 0;
    this._textureCount = 0;
    this._motionCount = 0;
    this._allMotionCount = 0;
    this._wavFileHandler = new LAppWavFileHandler();
    this._consistency = false;
  }

  _modelSetting: ICubismModelSetting; // モデルセッティング情報
  _model3Json: unknown = null; // model3.json 原始对象（绕过 CubismJson 对对象数组的解析缺陷）
  _modelHomeDir: string; // モデルセッティングが置かれたディレクトリ
  _userTimeSeconds: number; // デルタ時間の積算値[秒]

  _eyeBlinkIds: csmVector<CubismIdHandle>; // モデルに設定された瞬き機能用パラメータID
  _lipSyncIds: csmVector<CubismIdHandle>; // モデルに設定されたリップシンク機能用パラメータID
  _externalMouthValue: number = -1; // 外部リップシンク値（-1 = オーバーライドなし、0~1 = 口の開放度）

  // === 自定义动画状态（借鉴 AIRI） ===
  _blinkState = createBlinkState();
  _saccadeState = createSaccadeState();
  _lipSyncState = createLipSyncState();
  _idleSwayState: IdleSwayState = createIdleSwayState();
  _useCustomBlink: boolean = true;
  _useSaccade: boolean = true;
  _useIdleSway: boolean = true;
  _isIdle: boolean = false;
  _idleBlend: number = 0; // 0=鼠标追踪, 1=完全idle，平滑过渡

  _motions: csmMap<string, ACubismMotion>; // 読み込まれているモーションのリスト
  _expressions: csmMap<string, ACubismMotion>; // 読み込まれている表情のリスト

  _hitArea: csmVector<csmRect>;
  _userArea: csmVector<csmRect>;

  _idParamAngleX: CubismIdHandle; // パラメータID: ParamAngleX
  _idParamAngleY: CubismIdHandle; // パラメータID: ParamAngleY
  _idParamAngleZ: CubismIdHandle; // パラメータID: ParamAngleZ
  _idParamEyeBallX: CubismIdHandle; // パラメータID: ParamEyeBallX
  _idParamEyeBallY: CubismIdHandle; // パラメータID: ParamEyeBAllY
  _idParamBodyAngleX: CubismIdHandle; // パラメータID: ParamBodyAngleX
  _idParamBodyAngleY: CubismIdHandle; // パラメータID: ParamBodyAngleY

  _state: LoadStep; // 現在のステータス管理用
  _expressionCount: number; // 表情データカウント
  _textureCount: number; // テクスチャカウント
  _motionCount: number; // モーションデータカウント
  _allMotionCount: number; // モーション総数
  _wavFileHandler: LAppWavFileHandler; //wavファイルハンドラ
  _consistency: boolean; // MOC3一貫性チェック管理用

  // 模型加载回调（由 LAppLive2DManager 注入）
  _onReadyCallback: (() => void) | null = null;
  _onErrorCallback: ((err: string) => void) | null = null;

  _scale: number; // 模型比例
  _translateX: number; // x轴偏移量
  _translateY: number; // y轴偏移量
  _mouseSensitivity: number = 1.0; // 鼠标跟随灵敏度（用户可调）

  // 瞬态参数覆盖：由 BehaviorDecorateStage 通过 eventBus 注入
  // 每帧 update() 末尾应用，到期后自动移除
  _transientParams: Map<string, { value: number; expiresAt: number }> = new Map();

  // 弹簧物理状态：用于头部的自然运动（借鉴 AIRI）
  _springHeadX = createSpringState(0);
  _springHeadY = createSpringState(0);
  // 身体跟随弹簧（比头部更慢、更柔和）
  _springBodyX = createSpringState(0);
  _springBodyY = createSpringState(0);
  // beat-sync 专用的 Y/Z 弹簧（velocity 在 controller 内管理）
  _springBeatY = createSpringState(0);
  _springBeatZ = createSpringState(0);

  // 节拍同步控制器（移植自 AIRI）
  _beatSync: BeatSyncController = createBeatSyncController({
    baseAngles: () => ({ x: 0, y: 0, z: 0 }),
  });

  // 缓存的模型 canvas 尺寸（绕过 getCanvasWidth/Height 的 1×1 bug）
  cachedCanvasW: number = 0;
  cachedCanvasH: number = 0;

  /**
   * 设置外部口型开合度（0~1），用于 TTS 唇形同步。
   * 设置后下一帧 update() 会消费该值，然后重置为 -1。
   */
  public setMouthOpenY(value: number): void {
    this._externalMouthValue = Math.max(0, Math.min(1, value));
  }

  /**
   * 设置瞬态参数覆盖（如 ParamCheek、ParamAngry）。
   * 在 update() 末尾应用，持续 durationMs 后自动过期。
   */
  public setTransientParam(key: string, value: number, durationMs: number): void {
    this._transientParams.set(key, {
      value: Math.max(0, Math.min(1, value)),
      expiresAt: Date.now() + durationMs,
    });
  }

  /**
   * 设置 idle 状态（无鼠标交互时为 true，启用眼跳）
   * 不立即重置 saccade，由 _idleBlend 平滑过渡
   */
  public setIdleState(isIdle: boolean): void {
    this._isIdle = isIdle;
  }

  /**
   * 触发节拍同步（移植自 AIRI）
   * 音乐节拍触发时调用，角色会跟着节拍摆头
   */
  public scheduleBeat(timestamp?: number | null): void {
    this._beatSync.scheduleBeat(timestamp);
  }

  /**
   * 设置节拍同步摆头风格
   */
  public setBeatSyncStyle(style: 'punchy-v' | 'balanced-v' | 'swing-lr' | 'sway-sine'): void {
    this._beatSync.setStyle(style);
  }

  /**
   * 查询节拍同步是否活跃
   */
  public isBeatSyncActive(): boolean {
    return this._beatSync.isActive();
  }

  /**
   * 获取正确的模型 canvas 尺寸。
   * getCanvasWidth/Height 在某些情况下返回 1×1（SDK bug），
   * 这个方法尝试从内部 model 对象直接读取 canvasinfo。
   */
  public getCorrectCanvasSize(): { w: number; h: number } {
    if (this.cachedCanvasW > 0 && this.cachedCanvasH > 0) {
      return { w: this.cachedCanvasW, h: this.cachedCanvasH };
    }
    const model = this.getModel();
    if (model) {
      // 尝试从内部对象读取
      try {
        const internal = (model as any)._model;
        if (internal?.canvasinfo) {
          const w = internal.canvasinfo.CanvasWidth / internal.canvasinfo.PixelsPerUnit;
          const h = internal.canvasinfo.CanvasHeight / internal.canvasinfo.PixelsPerUnit;
          if (w > 1 && h > 1) {
            this.cachedCanvasW = w;
            this.cachedCanvasH = h;
            return { w, h };
          }
        }
      } catch { /* ignore */ }
      // fallback: 读取 raw moc3 数据
      try {
        const moc = (model as any)._moc;
        if (moc) {
          const _info = moc.getCanvasWidth?.() ?? moc.canvasWidth;
        }
      } catch { /* ignore */ }
    }
    // 最终 fallback
    return { w: 750, h: 1080 };
  }
}


