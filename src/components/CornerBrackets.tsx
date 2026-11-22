import React from 'react';

interface CornerBracketsProps {
  className?: string;
  color?: string; // e.g. '#8B7FE8' or '#111218'
  size?: number; // size in px of the bracket arms, default 8
  strokeWidth?: number;
}

export const CornerBrackets: React.FC<CornerBracketsProps> = ({
  className = '',
  color = 'var(--accent-signal)',
  size = 8,
  strokeWidth = 1.5,
}) => {
  const arm = `${size}px`;
  const stroke = `${strokeWidth}px solid ${color}`;

  return (
    <div className={`pointer-events-none absolute inset-0 z-20 ${className}`}>
      {/* Top Left */}
      <span
        className="absolute top-0 left-0"
        style={{
          width: arm,
          height: arm,
          borderTop: stroke,
          borderLeft: stroke,
        }}
      />
      {/* Top Right */}
      <span
        className="absolute top-0 right-0"
        style={{
          width: arm,
          height: arm,
          borderTop: stroke,
          borderRight: stroke,
        }}
      />
      {/* Bottom Left */}
      <span
        className="absolute bottom-0 left-0"
        style={{
          width: arm,
          height: arm,
          borderBottom: stroke,
          borderLeft: stroke,
        }}
      />
      {/* Bottom Right */}
      <span
        className="absolute bottom-0 right-0"
        style={{
          width: arm,
          height: arm,
          borderBottom: stroke,
          borderRight: stroke,
        }}
      />
    </div>
  );
};
