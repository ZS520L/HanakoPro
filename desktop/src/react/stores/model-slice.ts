import type { Model } from '../types';

export type ThinkingLevel = 'off' | 'auto' | 'high' | 'xhigh';
export type ModelsLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface ModelSlice {
  models: Model[];
  currentModel: { id: string; provider: string } | null;
  modelsLoadState: ModelsLoadState;
  thinkingLevel: ThinkingLevel;
  setModels: (models: Model[]) => void;
  setCurrentModel: (model: { id: string; provider: string } | null) => void;
  setModelsLoadState: (state: ModelsLoadState) => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
}

export const createModelSlice = (
  set: (partial: Partial<ModelSlice>) => void
): ModelSlice => ({
  models: [],
  currentModel: null,
  modelsLoadState: 'idle',
  thinkingLevel: 'auto',
  setModels: (models) => set({ models }),
  setCurrentModel: (model) => set({ currentModel: model }),
  setModelsLoadState: (state) => set({ modelsLoadState: state }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
});
