import React, { useState, useCallback } from 'react';
import type { Void } from '../hooks/useVoidData';

interface VoidPanelProps {
  voids:          Void[];
  selectedVoidId: number | null;
  showVoidLabels: boolean;
  voidsVisible:   boolean;
  loading:        boolean;
  onSelectVoid:   (id: number | null) => void;
  onToggleLabels: () => void;
  onToggleVoids:  () => void;
  darkMode:       boolean;
}

const PANEL_W = 310;
const mono  = 'inherit';
const serif = 'inherit';

function emptinessOf(v: Void): number {
  return Math.min(1, Math.max(0, v.empty_radius / 0.35));
}

// ── Compass ───────────────────────────────────────────────────────────────────

const SectorCompass: React.FC<{
  angleDeg: number;
  sector:   number;
  dim?:     boolean;
}> = ({ angleDeg, sector, dim = false }) => {
  const rad = (angleDeg * Math.PI) / 180;
  const nx  = Math.sin(rad) * 7;
  const ny  = -Math.cos(rad) * 7;
  const op  = dim ? 0.45 : 1.0;

  return (
    <svg width={24} height={24} viewBox="-12 -12 24 24" style={{ flexShrink: 0, display: 'block' }}>
      <circle r={10} fill="none" stroke="var(--accent)" strokeWidth={0.8} opacity={dim ? 0.3 : 0.55} />
      {Array.from({ length: 8 }, (_, i) => {
        const a  = (i * Math.PI) / 4;
        const x1 = Math.sin(a) * 7.5;
        const y1 = -Math.cos(a) * 7.5;
        const x2 = Math.sin(a) * 10;
        const y2 = -Math.cos(a) * 10;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={0.6} opacity={0.35} />;
      })}
      <line x1={0} y1={0} x2={nx} y2={ny} stroke="var(--accent)" strokeWidth={1.6} strokeLinecap="round" opacity={op} />
      <circle r={2} fill="var(--accent)" opacity={op} />
      <text x={0} y={14} textAnchor="middle" fontFamily={mono} fontSize={6} fill="var(--text-muted)" opacity={op}>
        S{sector}
      </text>
    </svg>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

export const VoidPanel: React.FC<VoidPanelProps> = ({
  voids,
  selectedVoidId,
  showVoidLabels,
  voidsVisible,
  loading,
  onSelectVoid,
  onToggleLabels,
  onToggleVoids,
}) => {
  const [panelOpen, setPanelOpen] = useState(false);

  const selectedVoid = voids.find(v => v.void_id === selectedVoidId) ?? null;

  // ── Derived theme tokens ─────────────────────────────────────────────────
  const panelBg     = 'var(--surface)';
  const panelBorder = 'var(--border-default)';
  const panelShadow = 'var(--shadow-md)';
  const tabBg       = 'var(--surface-raised)';
  const tabBorder   = 'var(--border-default)';
  const headingC    = 'var(--text-primary)';
  const subC        = 'var(--text-muted)';
  const divider     = 'var(--border-subtle)';
  const controlBorder = 'var(--border-subtle)';
  const labelCtrlC  = 'var(--text-secondary)';
  const rankBadgeC  = 'var(--text-muted)';
  const voidNameSel = 'var(--accent)';
  const voidNameDef = 'var(--text-primary)';
  const emptyBarBg  = 'var(--surface-active)';
  const selHeaderBg = 'var(--surface-raised)';
  const selHeaderBC = 'var(--border-default)';
  const selHeaderC  = 'var(--accent)';
  const selHeaderSC = 'var(--text-muted)';
  const metaBlockC  = 'var(--text-primary)';
  const reasoningC  = 'var(--text-secondary)';
  const metaC       = 'var(--text-muted)';
  const cardBg0     = 'var(--accent-soft)';
  const cardBg1     = 'var(--surface-raised)';
  const cardBorder0 = 'var(--accent)';
  const cardBorder1 = 'var(--border-subtle)';
  const cardTitleC  = 'var(--text-primary)';
  const rankPillC0  = 'var(--accent)';
  const rankPillBg0 = 'var(--surface-raised)';
  const rankPillC1  = 'var(--text-muted)';
  const rankPillBg1 = 'var(--surface-subtle)';
  const chipHiC     = 'var(--accent)';
  const chipHiBg    = 'var(--surface-raised)';
  const chipDimC    = 'var(--text-muted)';
  const chipDimBg   = 'var(--surface-subtle)';
  const doiC        = 'var(--accent)';
  const scoreTrackBg= 'var(--surface-active)';
  const scoreValC   = 'var(--accent)';
  const scoreLblC   = 'var(--text-muted)';
  const borderLblC  = 'var(--text-secondary)';
  const borderRowBC = 'var(--border-subtle)';
  const borderTitleC= 'var(--text-primary)';
  const borderDoiC  = 'var(--accent)';

  const handleItemClick = useCallback(
    (id: number) => { onSelectVoid(id === selectedVoidId ? null : id); },
    [selectedVoidId, onSelectVoid],
  );

  const openDOI = useCallback((doi: string) => {
    window.open(`https://arxiv.org/abs/${doi}`, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <>
      {/* ── Toggle tab ── */}
      <button
        type="button"
        onClick={() => setPanelOpen(o => !o)}
        title={panelOpen ? 'Close void panel' : 'Open void panel'}
        aria-label={panelOpen ? 'Close knowledge void panel' : 'Open knowledge void panel'}
        aria-expanded={panelOpen}
        style={{
          position: 'absolute',
          top: '50%',
          left: panelOpen ? PANEL_W : 0,
          transform: 'translateY(-50%)',
          zIndex: 60,
          background: tabBg,
          border: `1px solid ${tabBorder}`,
          borderLeft: 'none',
          borderRadius: '0 8px 8px 0',
          padding: '12px 6px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          boxShadow: 'var(--shadow-sm)',
          transition: 'left 0.28s cubic-bezier(.4,0,.2,1), background 0.3s',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <polygon
            points="8,2 14,8 8,14 2,8"
            stroke="var(--accent)"
            strokeWidth="1.4"
            strokeDasharray="3 2"
            fill="var(--accent-soft)"
          />
          <circle cx="8" cy="8" r="1.5" fill="var(--accent)" />
        </svg>
        <span
          style={{
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            fontFamily: mono,
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--text-secondary)',
            userSelect: 'none',
          }}
        >
          {panelOpen ? 'CLOSE' : 'VOIDS'}
        </span>
      </button>

      {/* ── Panel ── */}
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: PANEL_W,
          height: '100%',
          zIndex: 55,
          background: panelBg,
          borderRight: `1px solid ${panelBorder}`,
          boxShadow: panelShadow,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: panelOpen ? 'translateX(0)' : `translateX(-${PANEL_W}px)`,
          pointerEvents: panelOpen ? 'all' : 'none',
          transition: 'transform 0.28s cubic-bezier(.4,0,.2,1), background 0.3s',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 16px 10px', borderBottom: `1px solid ${divider}`, flexShrink: 0 }}>
          <p style={{ fontFamily: serif, fontSize: 17, fontWeight: 600, color: headingC, margin: 0, lineHeight: 1 }}>
            Knowledge Voids
          </p>
          <p style={{ fontFamily: mono, fontSize: 9, color: subC, marginTop: 4, letterSpacing: '0.04em', marginBottom: 0 }}>
            {loading ? 'Loading…' : `${voids.length} sparse regions · ranked by emptiness`}
          </p>
        </div>

        {/* Controls */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: `1px solid ${controlBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          {[
            { label: 'Show shapes', checked: voidsVisible,    onChange: onToggleVoids  },
            { label: 'Show labels', checked: showVoidLabels,  onChange: onToggleLabels },
          ].map(({ label, checked, onChange }) => (
            <label
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontFamily: mono,
                fontSize: 10,
                color: labelCtrlC,
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                style={{ accentColor: 'var(--accent)' }}
              />
              {label}
            </label>
          ))}
          {selectedVoidId !== null && (
            <button
              type="button"
              onClick={() => onSelectVoid(null)}
              aria-label="Clear selected void"
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: mono,
                fontSize: 9,
                color: 'var(--text-muted)',
                padding: '2px 4px',
              }}
            >
              clear ×
            </button>
          )}
        </div>

        {/* ── Void list ── */}
        <div style={{ overflowY: 'auto', flex: '1 1 0' as any, minHeight: 0, padding: '4px 0' }}>
          {loading && (
            <p style={{ fontFamily: mono, fontSize: 10, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
              Loading voids…
            </p>
          )}

          {!loading && voids.map(v => {
            const selected = v.void_id === selectedVoidId;
            const fill     = emptinessOf(v);

            return (
              <button
                key={v.void_id}
                type="button"
                aria-pressed={selected}
                aria-label={`${selected ? 'Deselect' : 'Select'} ${v.name ?? `Void ${v.void_id}`}`}
                onClick={() => handleItemClick(v.void_id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: 'inherit',
                  border: 'none',
                  background: selected ? 'var(--accent-soft)' : 'transparent',
                  borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'background 0.12s',
                }}
              >
                <div style={{ fontFamily: mono, fontSize: 9, color: rankBadgeC, marginBottom: 3, letterSpacing: '0.04em' }}>
                  #{v.void_rank}{' · '}r={v.empty_radius.toFixed(3)}{' · '}{v.border_papers.length} border papers
                  {v.shape_area > 0 && ` · area ${v.shape_area.toFixed(3)}`}
                </div>
                <div
                  style={{
                    fontFamily: serif,
                    fontSize: 13,
                    fontWeight: selected ? 700 : 500,
                    color: selected ? voidNameSel : voidNameDef,
                    lineHeight: 1.3,
                    marginBottom: 3,
                  }}
                >
                  {v.name ?? `Void ${v.void_id}`}
                </div>
                <div
                  style={{
                    height: 3, borderRadius: 2,
                    background: emptyBarBg,
                    marginTop: 5,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute', top: 0, left: 0, height: '100%',
                      width: `${fill * 100}%`,
                      background: 'var(--accent)',
                      borderRadius: 2,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Detail pane ── */}
        {selectedVoid && (
          <div
            style={{
              flexShrink: 0,
              height: '50%',
              minHeight: 0,
              overflowY: 'auto',
              borderTop: `1px solid ${divider}`,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Sticky header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px 7px',
                position: 'sticky',
                top: 0,
                zIndex: 2,
                background: selHeaderBg,
                borderBottom: `1px solid ${selHeaderBC}`,
                flexShrink: 0,
              }}
            >
              <svg width={11} height={11} viewBox="-6 -6 12 12" style={{ flexShrink: 0 }}>
                <polygon points="0,-5 5,0 0,5 -5,0" fill="var(--accent)" />
              </svg>
              <span style={{ fontFamily: mono, fontSize: 9, color: selHeaderC, letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 600 }}>
                Selected · {selectedVoid.selected_papers.length} picks
              </span>
              <span style={{ fontFamily: mono, fontSize: 8, color: selHeaderSC, marginLeft: 'auto', fontStyle: 'italic' }}>
                cross-pollination
              </span>
            </div>

            {/* Metadata */}
            <div style={{ padding: '10px 14px 8px', flexShrink: 0 }}>
              <div style={{ fontFamily: serif, fontSize: 14, fontWeight: 700, color: metaBlockC, lineHeight: 1.3, marginBottom: 4 }}>
                {selectedVoid.name ?? `Void ${selectedVoid.void_rank}`}
              </div>
              {selectedVoid.name_reasoning && (
                <div style={{ fontFamily: serif, fontSize: 12, color: reasoningC, lineHeight: 1.55, fontStyle: 'italic', marginBottom: 8 }}>
                  {selectedVoid.name_reasoning}
                </div>
              )}
              <div style={{ fontFamily: mono, fontSize: 9, color: metaC, letterSpacing: '0.03em', marginBottom: 10 }}>
                rank #{selectedVoid.void_rank}{' · '}empty_r={selectedVoid.empty_radius.toFixed(4)}
                {selectedVoid.shape_area > 0 && ` · hull ${selectedVoid.shape_area.toFixed(3)}`}
                {' · '}{selectedVoid.shape?.vertices?.length ?? 0} hull verts
              </div>
            </div>
            <div style={{ height: 1, background: divider, margin: '6px 0 0', flexShrink: 0 }} />

            {/* Selected papers */}
            {selectedVoid.selected_papers.length > 0 && (
              <>
                {selectedVoid.selected_papers.map(p => (
                  <button
                    key={p.rank}
                    type="button"
                    onClick={() => openDOI(p.DOI)}
                    aria-label={`Open ${p.title.replace(/\n/g, ' ').trim()} on arXiv`}
                    style={{
                      display: 'block',
                      width: 'calc(100% - 20px)',
                      textAlign: 'left',
                      margin: p.rank === 0 ? '7px 10px 5px' : '4px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${p.rank === 0 ? cardBorder0 : cardBorder1}`,
                      background: p.rank === 0 ? cardBg0 : cardBg1,
                      color: 'inherit',
                      padding: 0,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'background 0.1s',
                      flexShrink: 0,
                    }}
                  >
                    {/* Accent bar */}
                    <div
                      style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                        background: 'var(--accent)',
                        opacity: 0.25 + p.scores.combined * 0.75,
                        borderRadius: '7px 0 0 7px',
                      }}
                    />
                    <div style={{ padding: '8px 10px 9px 14px' }}>
                      {/* Compass + rank + angle */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                        <SectorCompass angleDeg={p.scores.angle_deg} sector={p.scores.sector} dim={p.rank > 0} />
                        <span
                          style={{
                            fontFamily: mono, fontSize: 8,
                            color: p.rank === 0 ? rankPillC0 : rankPillC1,
                            background: p.rank === 0 ? rankPillBg0 : rankPillBg1,
                            borderRadius: 3, padding: '2px 6px', letterSpacing: '0.03em', flexShrink: 0,
                          }}
                        >
                          #{p.rank + 1}
                        </span>
                        <span style={{ fontFamily: mono, fontSize: 8, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          {p.scores.angle_deg.toFixed(0)}° · S{p.scores.sector}
                        </span>
                      </div>

                      {/* Title */}
                      <div style={{ fontFamily: serif, fontSize: 12, color: cardTitleC, lineHeight: 1.4, marginBottom: 6 }}>
                        {p.title.replace(/\n/g, ' ').trim()}
                      </div>

                      {/* Chips */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                        {p.year != null && (
                          <span style={{ fontFamily: mono, fontSize: 8, color: chipHiC, background: chipHiBg, borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>
                            {p.year}
                          </span>
                        )}
                        {p.citation_count != null && (
                          <span style={{ fontFamily: mono, fontSize: 8, color: p.citation_count > 50 ? chipHiC : chipDimC, background: p.citation_count > 50 ? chipHiBg : chipDimBg, borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>
                            {p.citation_count.toLocaleString()} citations
                          </span>
                        )}
                        {p.DOI && p.DOI !== 'null' && (
                          <span style={{ fontFamily: mono, fontSize: 8, color: doiC, background: 'transparent', borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>
                            {p.DOI.length > 15 ? p.DOI.slice(0, 13) + '…' : p.DOI}
                          </span>
                        )}
                      </div>

                      {/* Score bars */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {[
                            { lbl: 'cite', val: p.scores.citation, color: 'var(--accent)' },
                            { lbl: 'rec',  val: p.scores.recency,  color: 'var(--info)' },
                          ].map(({ lbl, val, color }) => (
                            <React.Fragment key={lbl}>
                              <span style={{ fontFamily: mono, fontSize: 8, color: scoreLblC, width: 22, flexShrink: 0 }}>{lbl}</span>
                              <div style={{ flex: 1, height: 4, borderRadius: 2, background: scoreTrackBg, overflow: 'hidden', position: 'relative' }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${Math.min(1, Math.max(0, val)) * 100}%`, background: color, borderRadius: 2 }} />
                              </div>
                            </React.Fragment>
                          ))}
                          <span style={{ fontFamily: mono, fontSize: 8, color: scoreValC, width: 32, textAlign: 'right', flexShrink: 0 }}>
                            {p.scores.combined.toFixed(3)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                <div style={{ height: 1, background: divider, margin: '6px 0 0', flexShrink: 0 }} />
              </>
            )}

            {/* Border papers */}
            <div style={{ fontFamily: mono, fontSize: 9, color: borderLblC, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 14px 5px', flexShrink: 0 }}>
              Border papers ({selectedVoid.border_papers.length})
            </div>
            {selectedVoid.border_papers.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openDOI(p.DOI)}
                aria-label={`Open ${p.title.replace(/\n/g, ' ').trim()} on arXiv`}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '5px 14px',
                  color: 'inherit',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${borderRowBC}`,
                  cursor: 'pointer',
                }}
              >
                <p style={{ fontFamily: serif, fontSize: 12, color: borderTitleC, lineHeight: 1.35, margin: 0 }}>
                  {p.title.replace(/\n/g, ' ').trim()}
                </p>
                {p.DOI && p.DOI !== 'null' && (
                  <p style={{ fontFamily: mono, fontSize: 9, color: borderDoiC, margin: '2px 0 0' }}>
                    {p.DOI}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};