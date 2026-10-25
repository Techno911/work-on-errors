import type { ReactNode } from 'react';

export interface DocumentSurfaceProps {
  children: ReactNode;
}

export function DocumentSurface({ children }: DocumentSurfaceProps) {
  return (
    <div className="chip-document-surface" data-chip-doc>
      {children}
    </div>
  );
}
