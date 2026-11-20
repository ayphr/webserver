import { createContext, useContext } from 'react';

export type RadioContextType = {
  isPlaying: boolean;
  volume: number;
  toggle: () => Promise<void>;
  setVolume: (value: number) => void;
};

export const RadioContext = createContext<RadioContextType | undefined>(undefined);

export const useRadio = (): RadioContextType => {
  const context = useContext(RadioContext);
  if (!context) {
    throw new Error('useRadio must be used within RadioProvider');
  }
  return context;
};
