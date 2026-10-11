import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface TooltipAnchor {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TooltipOptions {
  content: ReactNode;
  anchor: TooltipAnchor;
}

export interface TooltipContextType {
  showTooltip: (options: TooltipOptions) => void;
  hideTooltip: () => void;
}

export const TooltipContext = createContext<TooltipContextType | undefined>(undefined);

export const useTooltip = () => {
  const context = useContext(TooltipContext);
  if (!context) {
    throw new Error('useTooltip must be used within TooltipProvider');
  }
  return context;
};