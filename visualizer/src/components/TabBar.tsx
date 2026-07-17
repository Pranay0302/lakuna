import React from 'react';

export interface TabDef {
  id: string;
  label: string;
  closeable?: boolean;
  status?: 'running' | 'done' | 'error';
}

interface TabBarProps {
  tabs: TabDef[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  darkMode: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--info)',
  done:    'var(--success)',
  error:   'var(--danger)',
};

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
}) => (
  <div
    role="tablist"
    aria-label="Open views"
    style={{
      display:         'flex',
      alignItems:      'stretch',
      height:          38,
      flexShrink:      0,
      background:      'var(--surface-subtle)',
      borderBottom:    '1px solid var(--border-default)',
      overflowX:       'auto',
      overflowY:       'hidden',
      zIndex:          1000,
      userSelect:      'none',
    }}
  >
    {tabs.map(tab => {
      const active = tab.id === activeTabId;
      const dotColor = tab.status ? STATUS_COLOR[tab.status] : undefined;

      return (
        <div
          key={tab.id}
          style={{
            display:       'flex',
            alignItems:    'center',
            flexShrink:    0,
            maxWidth:      240,
            minWidth:      100,
            background:    active
              ? 'var(--surface-raised)'
              : 'transparent',
            borderRight:   '1px solid var(--border-subtle)',
            borderBottom:  active
              ? '2px solid var(--accent)'
              : '2px solid transparent',
            transition:    'background var(--duration-fast) var(--ease-standard)',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`Open ${tab.label}`}
            onClick={() => onTabChange(tab.id)}
            style={{
              alignSelf:     'stretch',
              display:       'flex',
              alignItems:    'center',
              gap:           6,
              padding:       tab.closeable ? '0 4px 0 12px' : '0 14px 0 12px',
              minWidth:      0,
              flex:          1,
              background:    'transparent',
              border:        'none',
              cursor:        'pointer',
              fontSize:      11,
              color:         active
                ? 'var(--text-primary)'
                : 'var(--text-muted)',
            }}
          >
            {dotColor && (
              <span
                aria-label={tab.status}
                style={{
                  width:        6,
                  height:       6,
                  borderRadius: '50%',
                  background:   dotColor,
                  flexShrink:   0,
                  animation:    tab.status === 'running' ? 'tbPulse 1.5s ease-in-out infinite' : undefined,
                }}
              />
            )}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tab.label}
            </span>
          </button>

          {tab.closeable && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onTabClose(tab.id); }}
              aria-label={`Close ${tab.label}`}
              style={{
                fontSize:   13,
                lineHeight: 1,
                color:      'var(--text-muted)',
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                padding:    '5px 10px 5px 4px',
                flexShrink: 0,
                borderRadius: 'var(--radius-sm)',
              }}
              title="Close tab"
            >
              ×
            </button>
          )}
        </div>
      );
    })}

    <style>{`
      @keyframes tbPulse {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.3; }
      }
    `}</style>
  </div>
);
