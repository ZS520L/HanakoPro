type Translator = (key: string, vars?: Record<string, string | number>) => string;

export function notifyPasteUploadFailure(t: Translator, reason?: unknown): void {
  const base = t('error.uploadFailed');
  const reasonText = typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : reason instanceof Error && reason.message
      ? reason.message
      : '';

  window.dispatchEvent(new CustomEvent('hana-inline-notice', {
    detail: {
      text: reasonText ? `${base}: ${reasonText}` : base,
      type: 'error',
    },
  }));
}
