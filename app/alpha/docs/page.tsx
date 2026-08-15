'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, ExternalLink, ChevronDown, ChevronRight, Loader2, RefreshCw, Zap } from 'lucide-react';

const VPS_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://31.97.227.135:5000/api';

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

const VPS = VPS_BASE;

const DOC_COLORS: Record<string, string> = {
  CONCALL:        'bg-blue-500/20 text-blue-400',
  INVESTOR_PPT:   'bg-violet-500/20 text-violet-400',
  ANNUAL_REPORT:  'bg-emerald-500/20 text-emerald-400',
  RESULTS_UPDATE: 'bg-amber-500/20 text-amber-400',
};

const DOC_LABELS: Record<string, string> = {
  CONCALL:        'Concall',
  INVESTOR_PPT:   'Inv. Presentation',
  ANNUAL_REPORT:  'Annual Report',
  RESULTS_UPDATE: 'Results Update',
};

function MarkdownModal({ newsId, ticker, onClose }: { newsId: string; ticker: string; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`${VPS}/alpha/doc?news_id=${newsId}&ticker=${ticker}`)
      .then(r => r.ok ? r.text() : r.json().then(d => Promise.reject(d.error || 'Not found')))
      .then(t => { setContent(t); setLoading(false); })
      .catch(e => { setErr(String(e)); setLoading(false); });
  }, [newsId, ticker]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-4xl bg-[#0d1117] border border-slate-700 rounded-2xl overflow-hidden my-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-violet-400"/>
            {ticker} · {newsId.slice(0, 10)}
          </span>
          <div className="flex items-center gap-3">
            <a
              href={`${VPS}/alpha/doc?news_id=${newsId}&ticker=${ticker}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3"/> Raw
            </a>
            <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
          </div>
        </div>
        <div className="p-5 max-h-[80vh] overflow-y-auto">
          {loading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin"/>Loading markdown…</div>}
          {err && <div className="text-red-400 text-sm">{err}</div>}
          {!loading && !err && (
            <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ExtractionCard({ row, onView }: { row: ExtractionRow; onView: () => void }) {
  const [open, setOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');
  const color = DOC_COLORS[row.doc_type] || 'bg-slate-700 text-slate-400';
  const label = DOC_LABELS[row.doc_type] || row.doc_type;
  const kbSize = row.md_size_bytes ? Math.round(row.md_size_bytes / 1024) : 0;
  const dt = row.extracted_at ? new Date(row.extracted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';

  const triggerExtract = async () => {
    setExtracting(true);
    setExtractMsg('Starting extraction…');
    try {
      const r = await fetch(`${VPS}/trigger/alpha-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ news_id: row.news_id, ticker: row.ticker }),
      });
      const d = await r.json();
      if (!d.ok) { setExtractMsg(`Error: ${d.error}`); setExtracting(false); return; }
      setExtractMsg('Running… polling for result');
      // Poll until markdown appears
      let attempts = 0;
      const poll = async () => {
        attempts++;
        const s = await fetch(`${VPS}/alpha/extract-status?news_id=${row.news_id}&ticker=${row.ticker}`)
          .then(r => r.json()).catch(() => ({}));
        if (s.done) {
          setExtractMsg(`Done — ${Math.round((s.md_bytes || 0) / 1024)}KB extracted`);
          setExtracting(false);
        } else if (s.failed || attempts > 30) {
          setExtractMsg(s.last_log?.slice(-80) || 'Extraction failed');
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
    <div className="border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer bg-slate-900/50 hover:bg-slate-800/50"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${color}`}>{label}</span>
        <span className="font-bold text-white text-sm flex-1">{row.ticker}</span>
        <span className="text-xs text-slate-500 hidden sm:block">{row.quarter} {row.fiscal_year}</span>
        <span className="text-xs text-slate-600 hidden md:block">{dt}</span>
        <span className="text-xs text-slate-500">{kbSize}KB</span>
        {row.tables_extracted > 0 && (
          <span className="text-[10px] text-slate-500 hidden sm:block">{row.tables_extracted} tables</span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.extraction_status === 'complete' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
          {row.extraction_status}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500"/> : <ChevronRight className="w-3.5 h-3.5 text-slate-500"/>}
      </div>

      {open && (
        <div className="px-4 pb-4 pt-2 bg-slate-900/20 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(row.sections_found || []).map(s => (
              <span key={s} className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{s}</span>
            ))}
          </div>
          <div className="text-xs text-slate-500 space-y-0.5">
            <p><span className="text-slate-400">Pages:</span> {row.page_count} · <span className="text-slate-400">Tables:</span> {row.tables_extracted} · <span className="text-slate-400">MD size:</span> {kbSize}KB</p>
            <p className="truncate"><span className="text-slate-400">news_id:</span> {row.news_id}</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {row.extraction_status === 'complete' && (
              <button
                onClick={onView}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 transition-colors"
              >
                <FileText className="w-3.5 h-3.5"/> View Markdown
              </button>
            )}
            {row.source_pdf_r2 && (
              <a
                href={row.source_pdf_r2}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5"/> PDF
              </a>
            )}
            {row.extraction_status === 'complete' && (
              <a
                href={`${VPS}/alpha/doc?news_id=${row.news_id}&ticker=${row.ticker}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5"/> Raw MD
              </a>
            )}
            <button
              onClick={triggerExtract}
              disabled={extracting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {extracting
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/> Extracting…</>
                : <><Zap className="w-3.5 h-3.5"/> {row.extraction_status === 'complete' ? 'Re-extract' : 'Extract'}</>
              }
            </button>
          </div>
          {extractMsg && (
            <p className={`text-[11px] mt-1 ${extractMsg.startsWith('Done') ? 'text-emerald-400' : extractMsg.startsWith('Error') ? 'text-red-400' : 'text-amber-400'}`}>
              {extractMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AlphaDocsPage() {
  const [rows, setRows]           = useState<ExtractionRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal]         = useState<{ newsId: string; ticker: string } | null>(null);

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
    const matchText = !q || r.ticker.toLowerCase().includes(q) || (r.fiscal_year || '').includes(q) || (r.quarter || '').toLowerCase().includes(q);
    const matchType = !typeFilter || r.doc_type === typeFilter;
    return matchText && matchType;
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
        <MarkdownModal newsId={modal.newsId} ticker={modal.ticker} onClose={() => setModal(null)} />
      )}

      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/alpha/status" className="text-slate-500 hover:text-white"><ArrowLeft className="w-4 h-4"/></Link>
            <div>
              <h1 className="text-lg font-black text-white">Document Library</h1>
              <p className="text-xs text-slate-500">Extracted markdown · PDFs · Investor docs</p>
            </div>
          </div>
          <button onClick={load} className="text-xs text-slate-500 hover:text-white border border-slate-800 rounded-lg p-1.5">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}/>
          </button>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: `All (${counts.total})`, val: '' },
            { label: `Concall (${counts.concall})`, val: 'CONCALL' },
            { label: `Presentation (${counts.ppt})`, val: 'INVESTOR_PPT' },
            { label: `Annual Report (${counts.ar})`, val: 'ANNUAL_REPORT' },
          ].map(({ label, val }) => (
            <button
              key={val}
              onClick={() => setTypeFilter(t => t === val ? '' : val)}
              className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${
                typeFilter === val
                  ? 'bg-violet-600 border-violet-500 text-white'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-xs text-emerald-400 self-center">{counts.complete} extracted</span>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Filter by ticker, quarter, FY…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"
        />

        {/* Document list */}
        {loading ? (
          <div className="text-center py-12 text-slate-600">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2"/>Loading documents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-600 text-sm">
            {rows.length === 0 ? 'No extractions yet — documents are extracted automatically during ingest.' : 'No documents match your filter.'}
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
