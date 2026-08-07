export type {
  CharacterProfile,
  PersonaFolder,
  PromptLayer,
  PromptLayerType,
  PromptStack,
  PersonaResolutionContext,
  PersonaStore,
} from './types';

export {
  buildSystemPrompt,
  buildPromptStack,
  buildEmotionAnalyzePrompt,
  createDefaultProfile,
  PRESET_PROFILES,
} from './promptEngine';

export { personaManager } from './manager';
