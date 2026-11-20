import { createContext, useContext } from 'react';
import type { RadioStyle } from '../lib/radio/GentleLofiEngine';

export type RadioContextType = {
  isPlaying: boolean;
  volume: number;
  style: RadioStyle;
  toggle: () => Promise<void>;
  setVolume: (value: number) => void;
  setStyle: (style: RadioStyle) => void;
};

export const RadioContext = createContext<RadioContextType | undefined>(undefined);

export const useRadio = (): RadioContextType => {
  const context = useContext(RadioContext);
  if (!context) {
    throw new Error('useRadio must be used within RadioProvider');
  }
  return context;
};
