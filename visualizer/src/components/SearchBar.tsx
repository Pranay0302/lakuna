import React, { useState, useCallback, useId, useRef } from 'react';
import type { ProcessedPaper } from '../types';

interface SearchBarProps {
  papers:    ProcessedPaper[];
  onResults: (ids: Set<string | number> | null, focusPaper?: ProcessedPaper) => void;
  disabled?: boolean;
  darkMode:  boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  papers,
  onResults,
  disabled,
}) => {
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<ProcessedPaper[]>([]);
  const [open,      setOpen]      = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef    = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const listboxId = useId();

  const search = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      onResults(null);
      return;
    }

    const lower = q.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);

    const scored: { paper: ProcessedPaper; score: number }[] = [];
    for (const paper of papers) {
      const title = paper.title.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const idx = title.indexOf(term);
        if (idx === -1) { score = -1; break; }
        score += (idx === 0 ? 3 : 1) + (term.length / title.length) * 2;
      }
      if (score > 0) scored.push({ paper, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top    = scored.slice(0, 8).map(s => s.paper);
    const allIds = new Set(scored.map(s => s.paper.id));

    setResults(top);
    setOpen(top.length > 0);
    setActiveIdx(0);
    onResults(allIds.size > 0 ? allIds : null, top[0]);
  }, [papers, onResults]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 120);
  };

  const handleSelect = (paper: ProcessedPaper) => {
    setQuery(paper.title);
    setOpen(false);
    onResults(new Set([paper.id]), paper);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[activeIdx]) handleSelect(results[activeIdx]);
    if (e.key === 'Escape') { setOpen(false); setQuery(''); onResults(null); }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
    onResults(null);
    inputRef.current?.focus();
  };

  return (
    <div className="relative" style={{ width: 'min(340px, calc(100vw - 32px))', maxWidth: '100%' }}>
      {/* Input row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: open ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-md)',
          height: 42,
          boxShadow: 'var(--shadow-sm)',
          transition: 'border-radius var(--duration-fast) var(--ease-standard), background var(--duration-normal) var(--ease-standard)',
        }}
      >
        <svg aria-hidden="true" width="16" height="16" fill="none" stroke="var(--text-muted)" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search papers by title…"
          disabled={disabled}
          role="combobox"
          aria-label="Search papers by title"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && results[activeIdx] ? `${listboxId}-option-${activeIdx}` : undefined}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            fontSize: 14,
            color: 'var(--text-primary)',
            caretColor: 'var(--accent)',
            minWidth: 0,
          }}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear paper search"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              flexShrink: 0,
              padding: 4,
              display: 'flex',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Paper search results"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-default)',
            borderTop: '1px solid var(--border-subtle)',
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {results.map((p, i) => (
            <button
              key={p.id}
              id={`${listboxId}-option-${i}`}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              onClick={() => handleSelect(p)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                background: i === activeIdx
                  ? 'var(--accent-soft)'
                  : 'transparent',
                border: 'none',
                borderBottom: i < results.length - 1
                  ? '1px solid var(--border-subtle)'
                  : 'none',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.title}
              </p>
              {p.doi && p.doi !== 'null' && (
                <p
                  style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    margin: '2px 0 0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.doi}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};