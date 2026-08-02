'use client';
import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

interface Props {
  content: string;
  title?: string;
  maxWidth?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function InfoTooltip({ content, title, maxWidth = 'max-w-xs', position = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const positionClass =
    position === 'top'    ? 'bottom-full mb-2 left-1/2 -translate-x-1/2' :
    position === 'bottom' ? 'top-full mt-2 left-1/2 -translate-x-1/2' :
    position === 'left'   ? 'right-full mr-2 top-1/2 -translate-y-1/2' :
                            'left-full ml-2 top-1/2 -translate-y-1/2';

  return (
    <span ref={ref} className="relative inline-flex items-center ml-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-slate-600 hover:text-slate-400 transition-colors focus:outline-none"
        aria-label="Column info"
      >
        <Info className="w-3 h-3" />
      </button>

      {open && (
        <span
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className={`absolute z-50 ${positionClass} ${maxWidth} w-64
            bg-slate-800 border border-slate-600/60 rounded-lg shadow-2xl p-3
            pointer-events-auto`}
        >
          {title && (
            <div className="text-xs font-bold text-white mb-1.5">{title}</div>
          )}
          <p className="text-[11px] text-slate-300 leading-relaxed whitespace-normal">{content}</p>
        </span>
      )}
    </span>
  );
}
