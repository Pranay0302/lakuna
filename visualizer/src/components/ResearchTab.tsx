import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SwarmViewer } from './SwarmViewer';

const SWARM_VOID = 'Transformer-Augmented Vision Adaptation Gap';

interface ResearchTabProps {
  jobId:          string;
  voidName:       string;
  darkMode:       boolean;
  onStatusChange: (status: 'running' | 'done' | 'error') => void;
}

interface LogLine {
  id:      number;
  message: string;
}

const LINE_COLORS = {
  phase:    'var(--info)',
  success:  'var(--success)',
  warning:  'var(--warning)',
  error:    'var(--danger)',
  stderr:   'var(--warning)',
  default:  'var(--text-secondary)',
};

function lineColor(msg: string): string {
  if (/PHASE|={4,}/.test(msg))                              return LINE_COLORS.phase;
  if (/COMPLETE|Done\.|SUCCESS|-> /.test(msg))              return LINE_COLORS.success;
  if (/\[WARN\]|WARNING/.test(msg))                         return LINE_COLORS.warning;
  if (/\[ERR\]|ERROR|Failed|error/.test(msg))               return LINE_COLORS.error;
  if (msg.startsWith('[ERR]') || msg.startsWith('[STDERR]')) return LINE_COLORS.stderr;
  return LINE_COLORS.default;
}

const STATUS_COLOR: Record<string, string> = {
  connecting: 'var(--text-muted)',
  running:    'var(--info)',
  done:       'var(--success)',
  error:      'var(--danger)',
};

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  running:    'Running',
  done:       'Complete',
  error:      'Error',
};

let _lineId = 0;

export const ResearchTab: React.FC<ResearchTabProps> = ({
  jobId,
  voidName,
  darkMode: dm,
  onStatusChange,
}) => {
  const [lines,       setLines]       = useState<LogLine[]>([]);
  const [status,      setStatus]      = useState<'connecting' | 'running' | 'done' | 'error'>('connecting');
  const [displayName, setDisplayName] = useState(voidName);
  const [jobStage,    setJobStage]    = useState<'ingesting' | 'ready' | 'researching' | 'complete'>('ingesting');
  const [launching,   setLaunching]   = useState(false);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const autoScroll   = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const appendLine = useCallback((msg: string) => {
    setLines(prev => [...prev, { id: _lineId++, message: msg }]);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/investigate/${encodeURIComponent(jobId)}/stream`);

    es.onmessage = (ev) => {
      let data: { type: string; message?: string; voidName?: string };
      try { data = JSON.parse(ev.data); } catch { return; }

      if (data.type === 'info') {
        if (data.voidName) setDisplayName(data.voidName);
        return;
      }

      if (data.type === 'log' && data.message) {
        appendLine(data.message);
        setTimeout(scrollToBottom, 20);
        // Detect ingest complete → show Research button
        if (data.message.includes('[INGEST_COMPLETE]') || data.message.includes('INGEST COMPLETE')) {
          setJobStage('ready');
        }
        if (data.message.includes('RESEARCH PHASE START')) {
          setJobStage('researching');
        }
        if (data.message.includes('RESEARCH COMPLETE')) {
          setJobStage('complete');
        }
        return;
      }

      if (data.type === 'done') {
        setStatus('done');
        onStatusChange('done');
        setJobStage('complete');
        es.close(); // prevent auto-reconnect loop
        return;
      }
      if (data.type === 'error') {
        setStatus('error');
        onStatusChange('error');
        es.close();
        return;
      }
    };

    es.onerror = () => {
      setStatus('error');
      onStatusChange('error');
      es.close();
    };

    es.onopen = () => setStatus('running');

    return () => es.close();
  }, [jobId, appendLine, scrollToBottom, onStatusChange]);

  const handleStartResearch = useCallback(async () => {
    setLaunching(true);
    try {
      await fetch(`/api/investigate/${jobId}/start-research`, { method: 'POST' });
      setJobStage('researching');
    } catch (e) {
      console.error('start-research error', e);
    } finally {
      setLaunching(false);
    }
  }, [jobId]);

  // Poll stage when 'ready' (in case the SSE stream missed the marker)
  useEffect(() => {
    if (jobStage !== 'ingesting') return;
    let cancelled = false;
    const t = setInterval(async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/investigate/${jobId}/status`);
        if (r.ok) {
          const d = await r.json() as { stage: typeof jobStage };
          if (d.stage !== 'ingesting') setJobStage(d.stage);
        }
      } catch { /* ignore */ }
    }, 2500);
    return () => { cancelled = true; clearInterval(t); };
  }, [jobId, jobStage]);

  // Detect when user scrolls up to pause auto-scroll
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    autoScroll.current = atBottom;
  }, []);

  const dotColor   = STATUS_COLOR[status];
  const isSwarm    = displayName === SWARM_VOID;
  const swarmLines = isSwarm
    ? lines.filter(l => l.message.startsWith('[SWARM] ')).map(l => l.message)
    : [];
  const termLines  = isSwarm
    ? lines.filter(l => !l.message.startsWith('[SWARM] '))
    : lines;

  return (
    <div
      style={{
        flex:           1,
        display:        'flex',
        flexDirection:  'column',
        background:     'var(--background)',
        color:          'var(--text-primary)',
        overflow:       'hidden',
        height:         '100%',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        style={{
          padding:      '10px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display:      'flex',
          alignItems:   'center',
          gap:          12,
          flexShrink:   0,
          background:   'var(--surface)',
        }}
      >
        <div
          style={{
            width:        9,
            height:       9,
            borderRadius: '50%',
            background:   dotColor,
            flexShrink:   0,
            animation:    status === 'running' ? 'rtPulse 1.5s ease-in-out infinite' : undefined,
          }}
          role="status"
          aria-label={STATUS_LABEL[status]}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize:   15,
              fontWeight: 600,
              color:      'var(--text-primary)',
              overflow:   'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize:   10,
              color:      dotColor,
              marginTop:  2,
            }}
          >
            {STATUS_LABEL[status]} &middot; job {jobId.slice(-8)} &middot; {lines.length} lines
          </div>
        </div>

        {/* scroll-to-bottom button */}
        <button
          onClick={() => { autoScroll.current = true; scrollToBottom(); }}
          title="Scroll to bottom"
          aria-label="Scroll research log to bottom"
          style={{
            background: 'var(--surface-subtle)',
            border:     '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            color:      'var(--text-secondary)',
            fontSize:   14,
            cursor:     'pointer',
            padding:    '3px 8px',
          }}
        >
          ↓
        </button>
      </div>

      {/* ── Main content area ───────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: isSwarm ? 'row' : 'column', flexWrap: isSwarm ? 'wrap' : 'nowrap', overflow: 'auto', minHeight: 0 }}>

        {/* Terminal log (left panel or full width) */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            flex:       isSwarm ? '1 1 22rem' : 1,
            minWidth:   0,
            overflowY:  'auto',
            padding:    '10px 16px 20px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize:   12,
            lineHeight: 1.75,
            color:      'var(--text-secondary)',
            borderRight: isSwarm ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          {lines.length === 0 && status === 'connecting' && (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Waiting for stream…
            </div>
          )}

          {termLines.map(({ id, message }) => (
            <div
              key={id}
              style={{
                color:      lineColor(message),
                whiteSpace: 'pre-wrap',
                wordBreak:  'break-all',
              }}
            >
              {message}
            </div>
          ))}

        {status === 'running' && (
          <div
            style={{
              color:         'var(--info)',
              marginTop:     4,
              display:       'inline-block',
              animation:     'rtBlink 1s step-end infinite',
            }}
          >
            ▊
          </div>
        )}

        {status === 'done' && (
          <div
            style={{
              marginTop:  12,
              padding:    '8px 12px',
              border:     '1px solid var(--success)',
              borderRadius: 'var(--radius-sm)',
              color:      'var(--success)',
              background: 'var(--success-soft)',
              fontSize:   11,
            }}
          >
            Investigation complete. Check <code>outputs/investigations/</code> for generated code.
          </div>
        )}

        {status === 'error' && (
          <div
            style={{
              marginTop:    12,
              padding:      '10px 12px',
              border:       '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              color:        'var(--danger)',
              background:   'var(--danger-soft)',
              fontSize:     11,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Process exited with an error — last output:
            </div>
            <div style={{
              fontFamily:  "'JetBrains Mono', monospace",
              fontSize:    10,
              color:       'var(--danger)',
              lineHeight:  1.7,
              whiteSpace:  'pre-wrap',
              wordBreak:   'break-all',
            }}>
              {lines
                .slice(-20)
                .map(l => l.message)
                .filter(Boolean)
                .join('\n') || '(no output captured)'}
            </div>
          </div>
        )}

          <div ref={bottomRef} />
        </div>

        {/* SwarmViewer — right panel, only for the MNIST swarm void */}
        {isSwarm && (
          <div style={{ flex: '1 1 32rem', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <div style={{
              padding:      '6px 12px',
              borderBottom: '1px solid var(--border-subtle)',
              background:   'var(--surface)',
              fontSize:     9,
              color:        'var(--text-secondary)',
              flexShrink:   0,
            }}>
              Agent swarm · {swarmLines.length} log entries
            </div>
            <SwarmViewer lines={swarmLines} />
          </div>
        )}
      </div>{/* end main content flex */}

      {/* ── Research button ─────────────────────────────────────────── */}
      {jobStage !== 'ingesting' && (
        <div style={{
          flexShrink:   0,
          borderTop:    '1px solid var(--border-subtle)',
          padding:      '12px 16px',
          display:      'flex',
          justifyContent: 'center',
          background:   'var(--surface)',
        }}>
          {jobStage === 'ready' && (
            <button
              onClick={handleStartResearch}
              disabled={launching}
              style={{
                background:    'var(--accent)',
                color:         'var(--accent-foreground)',
                border:        'none',
                borderRadius:  'var(--radius-md)',
                padding:       '10px 36px',
                fontSize:      13,
                fontWeight:    700,
                cursor:        launching ? 'wait' : 'pointer',
                boxShadow:     'var(--shadow-sm)',
                display:       'flex',
                alignItems:    'center',
                gap:           10,
              }}
            >
              {launching ? 'Launching…' : 'Research'}
            </button>
          )}

          {jobStage === 'researching' && (
            <div style={{ fontSize: 11, color: 'var(--info)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--info)', display: 'inline-block', animation: 'rtPulse 1.5s ease-in-out infinite' }} />
              Agent swarm running…
            </div>
          )}

          {jobStage === 'complete' && (
            <div style={{ fontSize: 11, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 8 }}>
              Research complete
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes rtPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
        @keyframes rtBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
};
