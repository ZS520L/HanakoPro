export interface ApiKeySavePlanInput {
  keyEdited: boolean;
  keyVal: string;
  urlEdited: boolean;
  urlVal: string;
  derivedBaseUrl: string;
  isPresetSetup: boolean;
  isLocalPreset: boolean;
  seedDefaultModels?: boolean;
  api: string;
}

export interface ApiKeySavePlan {
  shouldSave: boolean;
  shouldVerify: boolean;
  payload: Record<string, unknown>;
  effectiveUrl: string;
  api: string;
  key: string;
}

export function getApiKeySavePlan(input: ApiKeySavePlanInput): ApiKeySavePlan {
  const key = input.keyVal.trim();
  const effectiveUrl = input.urlVal.trim() || input.derivedBaseUrl;

  if (!input.keyEdited) {
    return {
      shouldSave: false,
      shouldVerify: false,
      payload: {},
      effectiveUrl,
      api: input.api,
      key,
    };
  }

  const payload: Record<string, unknown> = input.isPresetSetup
    ? { base_url: effectiveUrl, api_key: key, api: input.api, seed_default_models: true }
    : { api_key: key };

  if (input.seedDefaultModels) {
    payload.seed_default_models = true;
  }

  if (input.urlEdited && !input.isPresetSetup) {
    payload.base_url = effectiveUrl;
  }

  return {
    shouldSave: true,
    shouldVerify: key !== "" || input.isLocalPreset,
    payload,
    effectiveUrl,
    api: input.api,
    key,
  };
}
