export interface SelectionSlice {
  selectedIdsBySession: Record<string, string[]>;
  toggleMessageSelection: (sessionPath: string, messageId: string) => void;
  setMessageSelection: (sessionPath: string, messageIds: string[]) => void;
  clearSelection: (sessionPath: string) => void;
}

export const createSelectionSlice = (
  set: (partial: Partial<SelectionSlice> | ((s: SelectionSlice) => Partial<SelectionSlice>)) => void,
): SelectionSlice => ({
  selectedIdsBySession: {},

  toggleMessageSelection: (sessionPath, messageId) => set((s) => {
    const current = s.selectedIdsBySession[sessionPath] || [];
    const next = current.includes(messageId)
      ? current.filter(id => id !== messageId)
      : [...current, messageId];
    const copy = { ...s.selectedIdsBySession };
    if (next.length === 0) delete copy[sessionPath];
    else copy[sessionPath] = next;
    return {
      selectedIdsBySession: copy,
    };
  }),

  setMessageSelection: (sessionPath, messageIds) => set((s) => {
    const next = Array.from(new Set(messageIds.filter(Boolean)));
    const copy = { ...s.selectedIdsBySession };
    if (next.length === 0) delete copy[sessionPath];
    else copy[sessionPath] = next;
    return { selectedIdsBySession: copy };
  }),

  clearSelection: (sessionPath) => set((s) => {
    const copy = { ...s.selectedIdsBySession };
    delete copy[sessionPath];
    return { selectedIdsBySession: copy };
  }),
});
