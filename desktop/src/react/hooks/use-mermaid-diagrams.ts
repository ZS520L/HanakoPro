import { useEffect, type DependencyList, type RefObject } from 'react';
import { renderMermaidDiagrams } from '../utils/mermaid-renderer';

export function useMermaidDiagrams(
  ref: RefObject<ParentNode | null>,
  deps: DependencyList,
): void {
  useEffect(() => {
    void renderMermaidDiagrams(ref.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns the render dependencies for injected HTML
  }, deps);
}
