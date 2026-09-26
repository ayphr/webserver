import { useState } from 'react';
import type { ReactNode } from 'react';
import { ModalContext, type ModalState } from './ModalContext';

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
