import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import './SidebarList.css';

export type SidebarPrefix = 'assistant-sidebar' | 'query-sidebar';

const block = (prefix: SidebarPrefix, suffix: string, extra = '') =>
  [`sidebar-list__${suffix}`, `${prefix}__${suffix}`, extra].filter(Boolean).join(' ');

export type SidebarShellProps = HTMLAttributes<HTMLElement> & {
  prefix: SidebarPrefix;
  ariaLabel: string;
};

/** Shared aside wrapper for the assistant and query sidebars. */
export const SidebarShell = forwardRef<HTMLElement, SidebarShellProps>(
  ({ prefix, ariaLabel, className = '', children, ...props }, ref) => (
    <aside
      ref={ref}
      aria-label={ariaLabel}
      className={`sidebar-list ${prefix} ${className}`.trim()}
      {...props}
    >
      {children}
    </aside>
  ),
);
SidebarShell.displayName = 'SidebarShell';

export type SidebarSectionProps = HTMLAttributes<HTMLDivElement> & {
  prefix: SidebarPrefix;
  isDragging?: boolean;
  rootRef?: (node: HTMLDivElement | null) => void;
};

export const SidebarSection = ({
  prefix,
  isDragging = false,
  rootRef,
  className = '',
  style,
  children,
  ...props
}: SidebarSectionProps) => (
  <div
    ref={rootRef}
    className={block(prefix, 'section', `${isDragging ? block(prefix, 'section--dragging') : ''} ${className}`.trim())}
    style={style}
    {...props}
  >
    {children}
  </div>
);

export type SidebarRowProps = {
  prefix: SidebarPrefix;
  className?: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
  indented?: boolean;
  onClick?: () => void;
  editing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onEditBlur?: () => void;
  onEditKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  actions?: ReactNode;
  forceActions?: boolean;
  dragHandle?: ReactNode;
  chevron?: ReactNode;
  rootRef?: (node: HTMLDivElement | null) => void;
  rowStyle?: CSSProperties;
  isDragging?: boolean;
  isDropTarget?: boolean;
  rowId?: string;
  tabIndex?: number;
  onRowFocus?: () => void;
  ariaExpanded?: boolean;
  ariaCurrent?: boolean;
};

/** Shared row used by both sidebars for query/chat and folder entries. */
export const SidebarRow = ({
  prefix,
  className = '',
  icon,
  label,
  active = false,
  indented = false,
  onClick,
  editing = false,
  editValue = '',
  onEditChange,
  onEditBlur,
  onEditKeyDown,
  actions,
  forceActions = false,
  dragHandle,
  chevron,
  rootRef,
  rowStyle,
  isDragging = false,
  isDropTarget = false,
  rowId,
  tabIndex = 0,
  onRowFocus,
  ariaExpanded,
  ariaCurrent = false,
}: SidebarRowProps) => {
  const handleMainKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      ref={rootRef}
      className={[
        block(prefix, 'row'),
        active ? block(prefix, 'row--active') : '',
        indented ? block(prefix, 'row--indented') : '',
        forceActions ? block(prefix, 'row--confirming') : '',
        isDragging ? block(prefix, 'row--dragging') : '',
        isDropTarget ? block(prefix, 'row--drop-target') : '',
        className,
      ].filter(Boolean).join(' ')}
      style={rowStyle}
    >
      <div
        className={block(prefix, 'main')}
        role={onClick ? 'button' : undefined}
        data-row-id={rowId}
        tabIndex={onClick ? tabIndex : undefined}
        aria-expanded={ariaExpanded}
        aria-current={ariaCurrent ? 'true' : undefined}
        onClick={onClick}
        onKeyDown={handleMainKeyDown}
        onFocus={onRowFocus}
      >
        <span className={block(prefix, 'icon')}>{icon}</span>
        {chevron && <span className={block(prefix, 'chevron')}>{chevron}</span>}
        {editing ? (
          <input
            autoFocus
            className={block(prefix, 'edit')}
            value={editValue}
            onChange={(event) => onEditChange?.(event.target.value)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Rename ${label}`}
          />
        ) : (
          <span className={block(prefix, 'label')}>{label}</span>
        )}
      </div>
      {actions && <div className={block(prefix, 'actions')}>{actions}</div>}
      {dragHandle && <div className={block(prefix, 'drag')}>{dragHandle}</div>}
    </div>
  );
};

export type SidebarActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  prefix: SidebarPrefix;
};

export const SidebarAction = ({ prefix, className = '', ...props }: SidebarActionProps) => (
  <button type="button" className={`${block(prefix, 'action')} ${className}`.trim()} {...props} />
);

export type SidebarDragHandleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  prefix: SidebarPrefix;
  label: string;
};

export const SidebarDragHandle = forwardRef<HTMLButtonElement, SidebarDragHandleProps>(
  ({ prefix, label, className = '', ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`${block(prefix, 'drag-handle')} ${className}`.trim()}
      aria-label={`Drag ${label}`}
      {...props}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick?.(event);
      }}
    />
  ),
);
SidebarDragHandle.displayName = 'SidebarDragHandle';

export type SidebarEditInputProps = InputHTMLAttributes<HTMLInputElement> & {
  prefix: SidebarPrefix;
  label: string;
};

export const SidebarEditInput = ({ prefix, label, className = '', ...props }: SidebarEditInputProps) => (
  <input autoFocus className={`${block(prefix, 'edit')} ${className}`.trim()} aria-label={label} {...props} />
);
