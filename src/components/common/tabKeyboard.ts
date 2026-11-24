import type { KeyboardEvent } from 'react';

/**
 * WAI-ARIA tablist keyboard support. Attach the returned handler to the element
 * with `role="tablist"`; each tab should carry `role="tab"` and `data-tab-id`.
 */
export function createTabKeyDownHandler<T extends string>(onSelect: (id: T) => void) {
  return (event: KeyboardEvent<HTMLElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    if (tabs.length === 0) return;

    const target = event.target as HTMLElement;
    const current = target.closest<HTMLButtonElement>('[role="tab"]')
      ?? tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    if (!current) return;
    const currentIndex = Math.max(0, tabs.indexOf(current));

    let nextIndex = currentIndex;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = currentIndex === tabs.length - 1 ? 0 : currentIndex + 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
    }

    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    next.focus();
    const tabId = next.dataset.tabId as T | undefined;
    if (tabId !== undefined) onSelect(tabId);
  };
}
