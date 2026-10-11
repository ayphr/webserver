import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TooltipContext, type TooltipOptions } from './TooltipContext';
import './Tooltip.css';

const GAP = 10;
const VIEWPORT_MARGIN = 8;

interface TooltipState {
  content: ReactNode;
  anchor: TooltipOptions['anchor'];
}

interface TooltipPlacement {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const hideTooltip = useCallback(() => {
    setTooltip(null);
    setPlacement(null);
  }, []);

  const showTooltip = useCallback(({ content, anchor }: TooltipOptions) => {
    setTooltip({ content, anchor });
    setPlacement(null);
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || placement || !tooltipRef.current) return;

    const element = tooltipRef.current;
    const { width, height } = element.getBoundingClientRect();
    const { top, left, width: anchorWidth, height: anchorHeight } = tooltip.anchor;

    const spaceAbove = top - GAP - VIEWPORT_MARGIN;
    const spaceBelow = window.innerHeight - (top + anchorHeight) - GAP - VIEWPORT_MARGIN;
    const placeAbove = spaceAbove >= height || spaceBelow < height;

    const placedTop = placeAbove ? top - GAP - height : top + anchorHeight + GAP;
    const placedLeft = Math.min(
      Math.max(left + anchorWidth / 2, VIEWPORT_MARGIN + width / 2),
      window.innerWidth - VIEWPORT_MARGIN - width / 2
    );

    setPlacement({
      left: placedLeft,
      top: placedTop,
      placement: placeAbove ? 'top' : 'bottom',
    });
  }, [tooltip, placement]);

  useEffect(() => {
    if (!tooltip) return;

    const handle = () => hideTooltip();
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [tooltip, hideTooltip]);

  const tooltipContextValue = useMemo(() => {
    return {
      showTooltip,
      hideTooltip,
    };
  }, [showTooltip, hideTooltip]);

  return (
    <TooltipContext.Provider value={tooltipContextValue}>
      {children}
      {tooltip && (
        <div
          ref={tooltipRef}
          className={`ayphr-tooltip${placement ? ' ayphr-tooltip--visible' : ''}`}
          data-placement={placement?.placement}
          style={placement ? { left: placement.left, top: placement.top } : undefined}
          role="tooltip"
        >
          {tooltip.content}
        </div>
      )}
    </TooltipContext.Provider>
  );
};
