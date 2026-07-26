import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export interface ModalState {
  isOpen: boolean;
  title?: string;
  content?: ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
  showCancel?: boolean;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

interface ModalContextType {
  modal: ModalState;
  openModal: (options: Omit<ModalState, 'isOpen'>) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const ModalProvider = ({ children }: { children: ReactNode }) => {
  const [modal, setModal] = useState<ModalState>({
    isOpen: false,
  });

  const openModal = (options: Omit<ModalState, 'isOpen'>) => {
    setModal({
      isOpen: true,
      ...options,
    });
  };

  const closeModal = () => {
    setModal({
      isOpen: false,
    });
  };

  return (
    <ModalContext.Provider value={{ modal, openModal, closeModal }}>
      {children}
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return context;
};
