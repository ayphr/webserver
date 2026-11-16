import './BioText.css';

export interface BioTextProps {
  value: string;
  className?: string;
}

export const BioText = ({ value, className }: BioTextProps) => {
  if (!value) return null;

  return <p className={`bio-text ${className ?? ''}`.trim()}>{value}</p>;
};