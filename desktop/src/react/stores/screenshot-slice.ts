export interface ScreenshotProgress {
  completedBlocks: number;
  totalBlocks: number;
  currentPage: number;
  totalPages: number;
}

export interface ScreenshotSlice {
  screenshotTaskCount: number;
  screenshotProgress: ScreenshotProgress | null;
  beginScreenshotTask: (progress: ScreenshotProgress) => void;
  updateScreenshotProgress: (progress: Partial<ScreenshotProgress>) => void;
  endScreenshotTask: () => void;
}

export const createScreenshotSlice = (
  set: (partial: Partial<ScreenshotSlice> | ((s: ScreenshotSlice) => Partial<ScreenshotSlice>)) => void,
): ScreenshotSlice => ({
  screenshotTaskCount: 0,
  screenshotProgress: null,

  beginScreenshotTask: (progress) => set((s) => ({
    screenshotTaskCount: s.screenshotTaskCount + 1,
    screenshotProgress: progress,
  })),

  updateScreenshotProgress: (progress) => set((s) => ({
    screenshotProgress: s.screenshotProgress ? { ...s.screenshotProgress, ...progress } : null,
  })),

  endScreenshotTask: () => set((s) => ({
    screenshotTaskCount: Math.max(0, s.screenshotTaskCount - 1),
    screenshotProgress: s.screenshotTaskCount <= 1 ? null : s.screenshotProgress,
  })),
});
