'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';

interface Props {
  content: string;
  title?: string;
  position?: 'top' | 'bottom' | 'left' | 'right'; // hint only — auto-flipped on mobile
}

interface Rect { top: number; left: number; width: number; height: number; bottom: number; }

export function InfoTooltip({ content, title, position = 'bottom' }: Props) {
  const [open, setOpen]       = useState(false);
  const [rect, setRect]       = useState<Rect | null>(null);
  const [isMobile, setMobile] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Detect mobile on mount + resize
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const open_ = useCallback(() => {
    if (btnRef.current) {
      setRect(btnRef.current.getBoundingClientRect());
    }
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click / scroll
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        tipRef.current  && !tipRef.current.contains(e.target as Node)
      ) close();
    };
    const onScroll = () => close();
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  // ── Tooltip position (desktop) ────────────────────────────────────────────
  const TIP_W = 280;
  const getStyle = (): React.CSSProperties => {
    if (!rect) return {};
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 8;

    // Prefer placing below button; flip up if not enough room
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const placeBelow = position === 'bottom' || spaceBelow >= 160 || spaceAbove < 160;

    let top = placeBelow
      ? rect.bottom + MARGIN
      : rect.top - MARGIN; // will use transform translateY(-100%)

    // Horizontal: centre on button, clamp to viewport
    let left = rect.left + rect.width / 2 - TIP_W / 2;
    if (left < MARGIN) left = MARGIN;
    if (left + TIP_W > vw - MARGIN) left = vw - MARGIN - TIP_W;

    return placeBelow
      ? { position: 'fixed', top, left, width: TIP_W, zIndex: 9999 }
      : { position: 'fixed', top, left, width: TIP_W, zIndex: 9999, transform: 'translateY(-100%)' };
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const tooltip = open && typeof document !== 'undefined' ? createPortal(
    isMobile ? (
      // Mobile: full-width bottom sheet with backdrop
      <>
        <div
          className="fixed inset-0 bg-black/60 z-[9998]"
          onClick={close}
        />
        <div
          ref={tipRef}
          className="fixed bottom-0 left-0 right-0 z-[9999] bg-slate-800 border-t border-slate-600
            rounded-t-2xl p-5 shadow-2xl"
          style={{ maxHeight: '50vh', overflowY: 'auto' }}
        >
          <div className="flex items-start justify-between mb-3">
            {title && <p className="text-sm font-bold text-white flex-1 pr-3">{title}</p>}
            <button onClick={close} className="text-slate-400 hover:text-white flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{content}</p>
        </div>
      </>
    ) : (
      // Desktop: fixed positioned tooltip
      <div
        ref={tipRef}
        style={getStyle()}
        className="bg-slate-800 border border-slate-600/70 rounded-xl shadow-2xl p-3.5 pointer-events-auto"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={close}
      >
        {title && <p className="text-xs font-bold text-white mb-1.5">{title}</p>}
        <p className="text-[11px] text-slate-300 leading-relaxed">{content}</p>
      </div>
    ),
    document.body
  ) : null;

  return (
    <span className="relative inline-flex items-center ml-0.5 flex-shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); open ? close() : open_(); }}
        onMouseEnter={() => { if (!isMobile) open_(); }}
        onMouseLeave={() => { if (!isMobile) close(); }}
        className="text-slate-600 hover:text-slate-400 transition-colors focus:outline-none p-0.5 rounded"
        aria-label="More info"
      >
        <Info className="w-3 h-3" />
      </button>
      {tooltip}
    </span>
  );
}
