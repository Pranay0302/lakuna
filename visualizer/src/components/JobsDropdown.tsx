import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ResearchJobInfo } from '../types';

interface Props {
  jobs:          Map<string, ResearchJobInfo>;
  activeTab:     string;
  onNavigate:    (tabId: string) => void;
  darkMode:      boolean;
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--info)',
  done:    'var(--success)',
  error:   'var(--danger)',
};

const IMAGENET_GAP = 'Transformer-Augmented Vision Adaptation Gap';

export const JobsDropdown: React.FC<Props> = ({ jobs, activeTab, onNavigate }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const running = [...jobs.values()].filter(j => j.status === 'running').length;
  const total   = jobs.size;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  if (!total) return null;

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={`Investigation jobs, ${total} total${running ? `, ${running} running` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display:       'flex',
          alignItems:    'center',
          gap:           6,
          height:        38,
          padding:       '0 14px',
          background:    open ? 'var(--surface-active)' : 'transparent',
          border:        'none',
          borderLeft:    '1px solid var(--border-subtle)',
          cursor:        'pointer',
          fontSize:      11,
          color:         'var(--text-secondary)',
          userSelect:    'none',
        }}
        title="Active investigation jobs"
      >
        {running > 0 && (
          <span style={{
            width:        7,
            height:       7,
            borderRadius: '50%',
            background:   'var(--info)',
            display:      'inline-block',
            animation:    'jdPulse 1.5s ease-in-out infinite',
            flexShrink:   0,
          }} />
        )}
        <span>Jobs {total}</span>
        <span style={{ fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div role="menu" aria-label="Active investigations" style={{
          position:    'absolute',
          top:         '100%',
          right:       0,
          minWidth:    280,
          background:  'var(--surface-raised)',
          border:      '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          boxShadow:   'var(--shadow-md)',
          zIndex:      2000,
          overflow:    'hidden',
        }}>
          <div style={{
            padding:     '8px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize:    9,
            color:       'var(--text-muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Active Investigations
          </div>

          {[...jobs.entries()].map(([jobId, job]) => {
            const isImagenet    = job.voidName === IMAGENET_GAP;
            const logsTabId     = `${jobId}:logs`;
            const deepTabId     = `${jobId}:deep`;
            const activeIsThis  = activeTab.startsWith(jobId);
            const dotColor      = STATUS_COLOR[job.status] ?? 'var(--text-muted)';

            return (
              <div key={jobId} style={{
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                {/* Job header */}
                <div style={{
                  padding:    '8px 12px 5px',
                  display:    'flex',
                  alignItems: 'center',
                  gap:        7,
                  background: activeIsThis ? 'var(--surface-subtle)' : 'transparent',
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: dotColor, flexShrink: 0,
                    animation: job.status === 'running' ? 'jdPulse 1.5s ease-in-out infinite' : undefined,
                  }} />
                  <span style={{
                    fontSize:     13,
                    color:        'var(--text-primary)',
                    flex:         1,
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}>
                    {job.voidName}
                  </span>
                  <span style={{ fontSize: 9, color: dotColor }}>
                    {job.status}
                  </span>
                </div>

                {/* Tab buttons */}
                <div style={{ display: 'flex', gap: 6, padding: '4px 12px 8px' }}>
                  <TabButton
                    label="Full Logs"
                    active={activeTab === logsTabId}
                    onClick={() => { onNavigate(logsTabId); close(); }}
                  />
                  {isImagenet && (
                    <TabButton
                      label="Deep Research"
                      active={activeTab === deepTabId}
                      onClick={() => { onNavigate(deepTabId); close(); }}
                      accent
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes jdPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
      `}</style>
    </div>
  );
};

const TabButton: React.FC<{
  label: string; active: boolean; onClick: () => void; accent?: boolean;
}> = ({ label, active, onClick, accent }) => (
  <button
    type="button"
    role="menuitem"
    aria-current={active ? 'page' : undefined}
    onClick={onClick}
    style={{
      background:   active
        ? (accent ? 'var(--accent-soft)' : 'var(--surface-active)')
        : 'transparent',
      border:       `1px solid ${active ? (accent ? 'var(--accent)' : 'var(--border-strong)') : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-sm)',
      padding:      '3px 9px',
      fontSize:     9,
      color:        active ? (accent ? 'var(--accent)' : 'var(--text-primary)') : 'var(--text-muted)',
      cursor:       'pointer',
      letterSpacing: '0.04em',
    }}
  >
    {label}
  </button>
);
