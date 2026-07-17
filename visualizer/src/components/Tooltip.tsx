import React from 'react';
import type { ProcessedPaper } from '../types';

interface TooltipProps {
  paper:            ProcessedPaper | null;
  x:                number;
  y:                number;
  containerWidth:   number;
  containerHeight:  number;
  darkMode:         boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  paper,
  x,
  y,
  containerWidth,
  containerHeight,
}) => {
  if (!paper) return null;

  const PAD       = 16;
  const TOOLTIP_W = 320;
  const TOOLTIP_H = 90;

  const left = x + PAD + TOOLTIP_W > containerWidth  ? x - TOOLTIP_W - PAD : x + PAD;
  const top  = y + PAD + TOOLTIP_H > containerHeight ? y - TOOLTIP_H - PAD : y + PAD;

  const hasDoi =
    paper.doi &&
    paper.doi !== 'null' &&
    paper.doi !== 'undefined' &&
    paper.doi.trim() !== '';
  const hasPdf = Boolean(paper.pdfUrl?.trim());

  return (
    <div
      className="pointer-events-none absolute z-50 select-none"
      style={{ left, top, maxWidth: TOOLTIP_W }}
    >
      <div
        style={{
          background:          'var(--surface-raised)',
          border:              '1px solid var(--border-default)',
          borderRadius:        'var(--radius-md)',
          padding:             '12px 14px',
          boxShadow:           'var(--shadow-md)',
          transition: 'background var(--duration-normal) var(--ease-standard), border-color var(--duration-normal) var(--ease-standard)',
        }}
      >
        <p
          style={{
            fontSize:   13,
            lineHeight: '1.4',
            fontWeight: 500,
            color:      'var(--text-primary)',
            margin:     '0 0 4px',
          }}
        >
          {paper.title || '(No title)'}
        </p>

        {hasDoi && (
          <p
            style={{
              fontSize:   11,
              color:      'var(--accent)',
              margin:     '0 0 6px',
              overflow:   'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {paper.doi}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span
            style={{
              fontSize:   10,
              color:      'var(--text-muted)',
            }}
          >
            id: {paper.id}
          </span>
          <span style={{ color: 'var(--border-strong)' }}>·</span>
          <span
            style={{
              fontSize: 10,
              color:    'var(--text-muted)',
            }}
          >
            cluster {paper.clusterId < 0 ? 'noise' : paper.clusterId}
          </span>
        </div>

        {(hasDoi || hasPdf) && (
          <p
            style={{
              fontSize: 10,
              color:    'var(--text-secondary)',
              margin:   '4px 0 0',
            }}
          >
            Click to open {hasPdf ? 'PDF' : 'paper'} ↗
          </p>
        )}
      </div>
    </div>
  );
};
