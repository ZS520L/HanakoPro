import { normalizeComputerUseSettings } from "./settings.js";

const SUPPORTED_COMPUTER_USE_PLATFORMS = new Set(["darwin", "win32"]);

export function isComputerUsePlatformSupported(platform = process.platform) {
  return SUPPORTED_COMPUTER_USE_PLATFORMS.has(platform);
}

export function effectiveComputerUseSettings(settings = {}, { platform = process.platform } = {}) {
  const normalized = normalizeComputerUseSettings(settings || {});
  if (isComputerUsePlatformSupported(platform)) return normalized;
  return {
    ...normalized,
    enabled: false,
  };
}

export function selectedComputerProviderId(settings = {}, { platform = process.platform } = {}) {
  if (!isComputerUsePlatformSupported(platform)) return null;
  const normalized = normalizeComputerUseSettings(settings || {});
  return normalized.provider_by_platform?.[platform] || null;
}
