import { cloneElement, isValidElement } from 'react';
import type { FocusEvent, MouseEvent, ReactElement, ReactNode } from 'react';
import { useTooltip } from '../../context';
import '../../context/Tooltip.css';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
}

/** Shared with TooltipProvider so the anchor can reference the rendered tooltip. */
const TOOLTIP_ID = 'ayphr-tooltip';

export const Tooltip = ({ content, children }: TooltipProps) => {
  const { showTooltip, hideTooltip } = useTooltip();

  const handleMouseEnter = (event: MouseEvent<HTMLElement>) => {
    showTooltip({ content, anchor: event.currentTarget.getBoundingClientRect(), anchorElement: event.currentTarget });
  };

  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    showTooltip({ content, anchor: event.currentTarget.getBoundingClientRect(), anchorElement: event.currentTarget });
  };

  const target = isValidElement(children)
    ? (() => {
      const child = children as ReactElement<Record<string, unknown>>;
      return cloneElement(child, {
        'aria-describedby': [child.props['aria-describedby'], TOOLTIP_ID]
          .filter(Boolean)
          .join(' '),
      });
    })()
    : children;

  return (
    <span
      className="ayphr-tooltip-target"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hideTooltip}
      onFocus={handleFocus}
      onBlur={hideTooltip}
    >
      {target}
    </span>
  );
};
