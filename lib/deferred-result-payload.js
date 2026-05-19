export function normalizeDeferredResolveResult({ result, files, sessionFiles } = {}) {
  if (result !== undefined) {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return {
        ...result,
        ...(files !== undefined ? { files } : {}),
        ...(sessionFiles !== undefined ? { sessionFiles } : {}),
      };
    }
    return result;
  }
  if (sessionFiles !== undefined) {
    return {
      files: files ?? [],
      sessionFiles,
    };
  }
  return files;
}
