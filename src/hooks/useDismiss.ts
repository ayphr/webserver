import { useEffect, useRef, type RefObject } from 'react';

export interface UseDismissOptions {
  /** Only listen while active — normally while the menu/popover is open. */
  enabled?: boolean;
  /** Also dismiss on Escape. Defaults to true. */
  escape?: boolean;
  /** Extra elements whose clicks should not dismiss (besides the container). */
  ignoreRefs?: ReadonlyArray<RefObject<Element | null>>;
  /** Custom hit-test: return true when the target should be kept open. */
  isInside?: (target: Node) => boolean;
}

/**
 * Dismisses a menu/popover on outside pointer-down and optionally on Escape.
 *
 * Pass a container ref for the usual containment check. To opt out of that
 * check (e.g. when the clickable trigger lives outside the menu), pass `null`
 * and supply `isInside` for custom hit-testing.
 *
 * The callback is kept in a ref so inline handlers don't re-subscribe the
 * document listeners on every render.
 */
export function useDismiss(
  containerRef: RefObject<Element | null> | null,
  onDismiss: () => void,
  { enabled = true, escape = true, ignoreRefs, isInside }: UseDismissOptions = {},
): void {
  const onDismissRef = useRef(onDismiss);
  const isInsideRef = useRef(isInside);
  const ignoreRefsRef = useRef(ignoreRefs);

  useEffect(() => {
    onDismissRef.current = onDismiss;
    isInsideRef.current = isInside;
    ignoreRefsRef.current = ignoreRefs;
  }, [onDismiss, isInside, ignoreRefs]);

  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef?.current?.contains(target)) return;
      if (ignoreRefsRef.current?.some((ignored) => ignored.current?.contains(target))) return;
      if (isInsideRef.current?.(target)) return;
      onDismissRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismissRef.current();
    };

    document.addEventListener('mousedown', handlePointerDown);
    if (escape) document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      if (escape) document.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, enabled, escape]);
}
