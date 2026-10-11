import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { useTooltip } from '../../context';
import '../../context/Tooltip.css';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
}

export const Tooltip = ({ content, children }: TooltipProps) => {
  const { showTooltip, hideTooltip } = useTooltip();

  const handleMouseEnter = (event: MouseEvent<HTMLElement>) => {
    showTooltip({ content, anchor: event.currentTarget.getBoundingClientRect() });
  };

  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    showTooltip({ content, anchor: event.currentTarget.getBoundingClientRect() });
  };

  return (
    <span
      className="ayphr-tooltip-target"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hideTooltip}
      onFocus={handleFocus}
      onBlur={hideTooltip}
    >
      {children}
    </span>
  );
};