import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { Button } from './Button';
import './Pagination.css';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export const Pagination = ({ page, totalPages, onPageChange, disabled = false }: PaginationProps) => {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Pagination">
      <Button
        variant="secondary"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={disabled || page === 1}
        aria-label="Previous page"
      >
        <IconChevronLeft size={16} />
        <span>Previous</span>
      </Button>
      <span className="pagination__indicator" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="secondary"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={disabled || page === totalPages}
        aria-label="Next page"
      >
        <span>Next</span>
        <IconChevronRight size={16} />
      </Button>
    </nav>
  );
};
