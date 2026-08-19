'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, FileText, ExternalLink, ChevronDown, ChevronRight,
  Loader2, RefreshCw, Zap, X,
} from 'lucide-react';

const VPS = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://31.97.227.135:5000/api';

interface ExtractionRow {
  id: string;
  news_id: string;
  ticker: string;
  doc_type: string;
  fiscal_year: string | null;
  quarter: string | null;
  source_pdf_r2: string;
  md_r2_url: string;
  extraction_status: string;
  page_count: number;
  md_size_bytes: number;
  tables_extracted: number;
  sections_found: string[];
  extracted_at: string | null;
}

const DOC_COLORS: Record<string, string> = {
  CONCALL:        'bg-blue-500/20 text-blue-400 border-blue-500/30',
  INVESTOR_PPT:   'bg-violet-500/20 text-violet-400 border-violet-500/30',
  ANNUAL_REPORT:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  RESULTS_UPDATE: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};
const DOC_LABELS: Record<string, string> = {
  CONCALL:        'Concall',
  INVESTOR_PPT:   'Presentation',
  ANNUAL_REPORT:  'Annual Report',
  RESULTS_UPDATE: 'Results Update',
};

// Simple markdown → HTML renderer (handles headers, bold, italic, code, lists, blockquotes)
function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // headers
    .replace(/^#{4} (.+)$/gm, '<h4 class="text-sm font-bold text-slate-200 mt-4 mb-1">$1</h4>')
    .replace(/^#{3} (.+)$/gm, '<h3 class="text-base font-bold text-white mt-5 mb-1.5">$1</h3>')
    .replace(/^#{2} (.+)$/gm, '<h2 class="text-lg font-black text-white mt-6 mb-2 border-b border-slate-800 pb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-black text-violet-200 mt-2 mb-3">$1</h1>')
    // bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="text-white"><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-slate-300">$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-violet-300 rounded px-1 py-0.5 text-[11px] font-mono">$1</code>')
    // blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-2 border-violet-500/50 pl-3 text-slate-400 italic">$1</blockquote>')
    // hr
    .replace(/^---+$/gm, '<hr class="border-slate-800 my-4"/>')
    // unordered list items
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 text-slate-300 list-disc">$1</li>')
    // ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-slate-300 list-decimal">$1</li>')
    // double newlines → paragraph breaks
    .replace(/\n\n/g, '</p><p class="text-slate-300 leading-relaxed mb-2">')
    // single newlines within paragraphs
    .replace(/\n/g, '<br/>');
}

function MarkdownModal({ newsId, ticker, onClose }: { newsId: string; ticker: string; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [rawMode, setRawMode] = useState(false);

  useEffect(() => {
    fetch(`${VPS}/alpha/doc?news_id=${newsId}&ticker=${ticker}`)
      .then(r => r.ok ? r.text() : r.json().then((d: any) => Promise.reject(d.error || 'Not found')))
      .then(t => { setContent(t); setLoading(false); })
      .catch(e => { setErr(String(e)); setLoading(false); });
  }, [newsId, ticker]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-start justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-[#0d1117] border border-slate-700 rounded-2xl overflow-hidden my-2 sm:my-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-violet-400 shrink-0"/>
            <span className="text-sm font-bold text-white truncate">
              {ticker} · {newsId.slice(0, 10)}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setRawMode(r => !r)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 border border-slate-700 rounded-lg transition-colors"
            >
              {rawMode ? 'Rendered' : 'Raw'}
            </button>
            <a href={`${VPS}/alpha/doc?news_id=${newsId}&ticker=${ticker}`}
              target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 text-xs text-slate-400 hover:text-white">
              <ExternalLink className="w-3 h-3"/>
            </a>
            <button onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors">
              <X className="w-4 h-4"/>
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div className="p-4 sm:p-6 max-h-[75vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 text-slate-500 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin"/>Loading…
            </div>
          )}
          {err && <div className="text-red-400 text-sm py-4">{err}</div>}
          {!loading && !err && (
            rawMode
              ? <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{content}</pre>
              : <div
                  className="text-sm text-slate-300 leading-relaxed space-y-1"
                  dangerouslySetInnerHTML={{ __html: '<p class="text-slate-300 leading-relaxed mb-2">' + renderMarkdown(content) + '</p>' }}
                />
          )}
        </div>
      </div>
    </div>
  );
}

function ExtractionCard({ row, onView }: { row: ExtractionRow; onView: () => void }) {
  const [open, setOpen]           = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');
  const color   = DOC_COLORS[row.doc_type] || 'bg-slate-700 text-slate-400 border-slate-600';
  const label   = DOC_LABELS[row.doc_type] || row.doc_type;
  const kbSize  = row.md_size_bytes ? Math.round(row.md_size_bytes / 1024) : 0;
  const isOk    = row.extraction_status === 'complete';
  const dt      = row.extracted_at
    ? new Date(row.extracted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : '—';

  const triggerExtract = async () => {
    setExtracting(true);
    setExtractMsg('Starting…');
    try {
      const r = await fetch(`${VPS}/trigger/alpha-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ news_id: row.news_id, ticker: row.ticker }),
      });
      const d = await r.json();
      if (!d.ok) { setExtractMsg(`Error: ${d.error}`); setExtracting(false); return; }
      setExtractMsg('Running…');
      let attempts = 0;
      const poll = async () => {
        attempts++;
        const s = await fetch(`${VPS}/alpha/extract-status?news_id=${row.news_id}&ticker=${row.ticker}`)
          .then(r => r.json()).catch(() => ({}));
        if (s.done) {
          setExtractMsg(`Done — ${Math.round((s.md_bytes || 0) / 1024)}KB extracted`);
          setExtracting(false);
        } else if (s.failed || attempts > 36) {
          setExtractMsg(s.last_log?.slice(-100) || 'Extraction failed');
          setExtracting(false);
        } else {
          setTimeout(poll, 5000);
        }
      };
      setTimeout(poll, 5000);
    } catch (e: any) {
      setExtractMsg(`Error: ${e.message}`);
      setExtracting(false);
    }
  };

  return (
    <div className="border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors bg-slate-900/40">
      {/* Row header */}
      <button
        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-slate-800/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold border ${color}`}>{label}</span>
        <span className="font-bold text-white text-sm flex-1 min-w-0 truncate">{row.ticker}</span>
        <span className="text-[11px] text-slate-500 hidden sm:block shrink-0">{row.quarter} {row.fiscal_year}</span>
        <span className="text-[11px] text-slate-600 hidden md:block shrink-0">{dt}</span>
        <span className="text-[11px] text-slate-500 shrink-0">{kbSize > 0 ? `${kbSize}KB` : '—'}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-semibold ${isOk ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
          {isOk ? '✓' : '✗'}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0"/> : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0"/>}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-4 pb-4 pt-2 bg-slate-900/60 border-t border-slate-800/50 space-y-3">
          {/* Meta */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span><span className="text-slate-400">Pages:</span> {row.page_count || '—'}</span>
            <span><span className="text-slate-400">Tables:</span> {row.tables_extracted}</span>
            <span><span className="text-slate-400">MD:</span> {kbSize > 0 ? `${kbSize}KB` : '—'}</span>
            <span className="hidden sm:block truncate max-w-[200px]"><span className="text-slate-400">ID:</span> {row.news_id}</span>
          </div>

          {/* Sections */}
          {(row.sections_found || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {row.sections_found.map(s => (
                <span key={s} className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 items-center">
            {isOk && (
              <button
                onClick={onView}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                  bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30
                  transition-colors active:scale-95"
              >
                <FileText className="w-3.5 h-3.5"/> View Markdown
              </button>
            )}
            <button
              onClick={triggerExtract}
              disabled={extracting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-95"
            >
              {extracting
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/> Extracting…</>
                : <><Zap className="w-3.5 h-3.5"/> {isOk ? 'Re-extract' : 'Extract'}</>}
            </button>
            {row.source_pdf_r2 && (
              <a href={row.source_pdf_r2} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                  bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition-colors">
                <ExternalLink className="w-3.5 h-3.5"/> PDF
              </a>
            )}
          </div>
          {extractMsg && (
            <p className={`text-[11px] ${
              extractMsg.startsWith('Done') ? 'text-emerald-400' :
              extractMsg.startsWith('Error') ? 'text-red-400' : 'text-amber-400'
            }`}>{extractMsg}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AlphaDocsPage() {
  const [rows, setRows]               = useState<ExtractionRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('');
  const [modal, setModal]             = useState<{ newsId: string; ticker: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch(
        '/api/sb/alpha_doc_extractions?order=extracted_at.desc&limit=200',
        { cache: 'no-store' }
      ).then(r => r.json());
      setRows(Array.isArray(data) ? data : []);
    } catch { setRows([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => {
    const q = filter.toLowerCase();
    const matchText = !q || r.ticker.toLowerCase().includes(q)
      || (r.fiscal_year || '').includes(q)
      || (r.quarter || '').toLowerCase().includes(q);
    return matchText && (!typeFilter || r.doc_type === typeFilter);
  });

  const counts = {
    total:    rows.length,
    concall:  rows.filter(r => r.doc_type === 'CONCALL').length,
    ppt:      rows.filter(r => r.doc_type === 'INVESTOR_PPT').length,
    ar:       rows.filter(r => r.doc_type === 'ANNUAL_REPORT').length,
    complete: rows.filter(r => r.extraction_status === 'complete').length,
  };

  return (
    <div className="min-h-screen bg-[#0d1117] p-3 md:p-5">
      {modal && (
        <MarkdownModal
          newsId={modal.newsId}
          ticker={modal.ticker}
          onClose={() => setModal(null)}
        />
      )}

      <div className="max-w-5xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link href="/alpha/status" className="text-slate-500 hover:text-white p-1">
              <ArrowLeft className="w-4 h-4"/>
            </Link>
            <div>
              <h1 className="text-base font-black text-white">Document Library</h1>
              <p className="text-[11px] text-slate-500">{counts.complete} extracted · {counts.total} total</p>
            </div>
          </div>
          <button onClick={load} className="p-1.5 border border-slate-800 rounded-lg text-slate-500 hover:text-white">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}/>
          </button>
        </div>

        {/* Type filter chips */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'All',           val: '',              count: counts.total },
            { label: 'Concall',       val: 'CONCALL',       count: counts.concall },
            { label: 'Presentation',  val: 'INVESTOR_PPT',  count: counts.ppt },
            { label: 'Annual Report', val: 'ANNUAL_REPORT', count: counts.ar },
          ].map(({ label, val, count }) => (
            <button
              key={val}
              onClick={() => setTypeFilter(t => t === val ? '' : val)}
              className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors active:scale-95 ${
                typeFilter === val
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Filter by ticker, quarter, FY…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm
            text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 transition-colors"
        />

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-14 gap-2 text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin"/> Loading documents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-slate-600 text-sm">
            {rows.length === 0
              ? 'No extractions yet — documents are extracted automatically during ingest.'
              : 'No documents match your filter.'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(row => (
              <ExtractionCard
                key={row.id || row.news_id}
                row={row}
                onView={() => setModal({ newsId: row.news_id, ticker: row.ticker })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
