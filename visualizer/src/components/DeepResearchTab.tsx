/**
 * DeepResearchTab — live dashboard for the agentic research swarm.
 *
 * Layout:
 *   ┌─[Paper boxes + Generate Code buttons]───────────────────────────────┐
 *   │ Left: Orchestrator goal + Judge feedback                             │
 *   │ Middle (wide): Paper agent messages + cross-pollination animation    │
 *   │ Right: Ideas / MCP memory                                            │
 *   │                                    [Bottom-right: Metric graph]      │
 *   └──────────────────────────────────────────────────────────────────────┘
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MetricPoint,
  PaperRef,
  ResearchEvent,
  CrossAnimPhase,
  PairLink,
} from "../types";
import { MetricGraph } from "./MetricGraph";

const IMAGENET_GAP = "Transformer-Augmented Vision Adaptation Gap";

const mono = "inherit";
const serif = "inherit";
const DIM = "var(--border-subtle)";
const BORDER = "var(--border-default)";

// ── helpers ───────────────────────────────────────────────────────────────────

function shortId(id: string) {
  return id.replace(/^expert:/, "").replace(/_/g, " ");
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Safely convert an unknown event payload value to a display string. */
function toStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

// ── sub-components ─────────────────────────────────────────────────────────────

interface PaperBoxProps {
  paper: PaperRef;
  index: number;
  codegenJobId?: string;
  codegenStatus?: "idle" | "running" | "done" | "error";
  onGenerate: (paper: PaperRef) => void;
}

const PaperBox: React.FC<PaperBoxProps> = ({
  paper,
  index,
  codegenStatus = "idle",
  onGenerate,
}) => {
  const rank = index + 1;
  const color =
    codegenStatus === "done"
      ? "var(--success)"
      : codegenStatus === "running"
        ? "var(--info)"
        : codegenStatus === "error"
          ? "var(--danger)"
          : "var(--accent)";
  const statusSoft =
    codegenStatus === "done"
      ? "var(--success-soft)"
      : codegenStatus === "error"
        ? "var(--danger-soft)"
        : "var(--accent-soft)";

  return (
    <div
      style={{
        flex: "1 1 9rem",
        minWidth: 130,
        maxWidth: 230,
        background: "var(--surface-raised)",
        border: `1px solid ${BORDER}`,
        borderRadius: "var(--radius-md)",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: "default",
      }}
    >
      {/* Rank diamond */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <svg width={12} height={12} style={{ flexShrink: 0 }}>
          <rect
            x={2}
            y={2}
            width={8}
            height={8}
            transform="rotate(45 6 6)"
            fill={color}
            opacity={0.85}
          />
        </svg>
        <span style={{ fontFamily: mono, fontSize: 9, color: "var(--text-muted)" }}>
          #{rank}
        </span>
        {paper.year && (
          <span
            style={{
              fontFamily: mono,
              fontSize: 8,
              color: "var(--text-muted)",
              marginLeft: "auto",
            }}
          >
            {paper.year}
          </span>
        )}
      </div>

      {/* Title */}
      <p
        style={{
          fontFamily: serif,
          fontSize: 11,
          color: "var(--text-primary)",
          lineHeight: 1.4,
          margin: 0,
          flex: 1,
        }}
      >
        {truncate(paper.title.replace(/\n/g, " ").trim(), 80)}
      </p>

      {/* DOI chip */}
      {paper.doi && (
        <a
          href={`https://arxiv.org/abs/${paper.doi}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: mono,
            fontSize: 8,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          {paper.doi}
        </a>
      )}

      {/* Generate code button */}
      <button
        onClick={() => onGenerate(paper)}
        disabled={codegenStatus === "running"}
        style={{
          background: statusSoft,
          border: `1px solid ${color}`,
          borderRadius: "var(--radius-sm)",
          color,
          fontFamily: mono,
          fontSize: 9,
          fontWeight: 700,
          padding: "4px 0",
          cursor: codegenStatus === "running" ? "wait" : "pointer",
          width: "100%",
          animation:
            codegenStatus === "running"
              ? "drPulse 1.5s ease-in-out infinite"
              : undefined,
        }}
      >
        {codegenStatus === "running"
          ? "Generating…"
          : codegenStatus === "done"
            ? "Generated"
            : codegenStatus === "error"
              ? "Retry"
              : "Generate Code"}
      </button>
    </div>
  );
};

// ── Left panel ────────────────────────────────────────────────────────────────

const OrchestratorPanel: React.FC<{
  phase: string;
  plan: string;
  diagnosis: string;
  judgeDecision: string;
  judgeReason: string;
  iteration: number;
}> = ({ phase, plan, diagnosis, judgeDecision, judgeReason, iteration }) => (
  <div
    style={{
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      gap: 14,
      padding: "16px",
      borderRight: `1px solid ${DIM}`,
      overflowY: "auto",
      background: "var(--surface)",
    }}
  >
    <div
      style={{
        fontFamily: mono,
        fontSize: 9,
        color: "var(--accent)",
        fontWeight: 600,
      }}
    >
      Orchestrator
    </div>

    {/* Current phase */}
    <Section title="Phase">
      <div style={{ fontFamily: mono, fontSize: 11, color: "var(--info)" }}>
        {phase || "Waiting…"}
      </div>
      {iteration > 0 && (
        <div
          style={{
            fontFamily: mono,
            fontSize: 9,
            color: "var(--text-muted)",
            marginTop: 3,
          }}
        >
          Iteration {iteration}
        </div>
      )}
    </Section>

    {/* Diagnosis */}
    {diagnosis && (
      <Section title="Diagnosis">
        <p
          style={{
            fontFamily: mono,
            fontSize: 10,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            margin: 0,
            whiteSpace: "pre-wrap",
          }}
        >
          {truncate(diagnosis, 320)}
        </p>
      </Section>
    )}

    {/* Current plan */}
    {plan && (
      <Section title="Current Plan">
        <p
          style={{
            fontFamily: serif,
            fontSize: 12,
            color: "var(--text-primary)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {truncate(plan, 400)}
        </p>
      </Section>
    )}

    {/* Judge feedback */}
    {judgeDecision && (
      <Section title="Judge Verdict">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 5,
          }}
        >
          <div
            style={{
              background:
                judgeDecision === "keep"
                  ? "var(--success-soft)"
                  : "var(--danger-soft)",
              border: `1px solid ${judgeDecision === "keep" ? "var(--success)" : "var(--danger)"}`,
              borderRadius: "var(--radius-sm)",
              padding: "2px 7px",
              fontFamily: mono,
              fontSize: 10,
              fontWeight: 700,
              color: judgeDecision === "keep" ? "var(--success)" : "var(--danger)",
            }}
          >
            {judgeDecision}
          </div>
        </div>
        {judgeReason && (
          <p
            style={{
              fontFamily: mono,
              fontSize: 10,
              color: "var(--text-muted)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {truncate(judgeReason, 280)}
          </p>
        )}
      </Section>
    )}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div>
    <div
      style={{
        fontFamily: mono,
        fontSize: 8,
        color: "var(--text-muted)",
        marginBottom: 5,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

// ── Agent message parser ──────────────────────────────────────────────────────

interface AgentMessage {
  agentId: string;
  stage: string;
  lines: string[];
  thinking: string[];
  isDone: boolean;
}

function parseAgentMessages(logs: string[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let current: AgentMessage | null = null;

  for (const raw of logs) {
    // Strip [ERR] / [OUT] prefix the backend adds
    const line = raw
      .replace(/^\[(?:ERR|OUT)\]\s*/, "")
      .replace(/\x1b\[[0-9;]*m/g, "");

    // Agent start: "  ◆ label (stage)"
    const startMatch = line.match(/◆\s+(.+?)\s+\((.+?)\)/);
    if (startMatch) {
      if (current) messages.push(current);
      current = {
        agentId: startMatch[1].trim(),
        stage: startMatch[2].trim(),
        lines: [],
        thinking: [],
        isDone: false,
      };
      continue;
    }

    if (!current) continue;

    // Agent done: "[done in X.Xs]"
    if (/\[done in [\d.]+s\]/.test(line)) {
      current.isDone = true;
      messages.push(current);
      current = null;
      continue;
    }

    // Thinking token (wrapped in <think>...</think> by our llm.py)
    const thinkMatch = line.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      current.thinking.push(thinkMatch[1]);
    } else if (
      line.trim() &&
      !line.includes("[LLM]") &&
      !line.includes("backend=")
    ) {
      current.lines.push(line.trim());
    }
  }

  if (current) messages.push(current);
  return messages;
}

// ── Agent output card (real-time streaming) ───────────────────────────────────

const AgentOutputCard: React.FC<{
  agentId: string;
  msg: AgentMessage | undefined;
  ideaText: string | undefined;
}> = ({ agentId, msg, ideaText }) => {
  const outputRef = useRef<HTMLDivElement>(null);
  const isActive = !!msg && !msg.isDone;
  const lines = msg?.lines ?? [];

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, lines[lines.length - 1]]);

  return (
    <div
      style={{
        minWidth: 0,
        background: isActive ? "var(--accent-soft)" : "var(--surface-raised)",
        border: `1px solid ${isActive ? "var(--accent)" : "var(--border-subtle)"}`,
        borderLeft: `2px solid ${isActive ? "var(--info)" : "var(--accent)"}`,
        borderRadius: "var(--radius-md)",
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        overflow: "hidden",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
      >
        {isActive && (
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--info)",
              flexShrink: 0,
              animation: "drPulse 1s ease-in-out infinite",
            }}
          />
        )}
        <span
          style={{
            fontFamily: mono,
            fontSize: 9,
            color: isActive ? "var(--accent)" : "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shortId(agentId)}
        </span>
        {msg?.isDone && (
          <span
            style={{
              fontFamily: mono,
              fontSize: 8,
              color: "var(--text-muted)",
              marginLeft: "auto",
            }}
          >
            Done
          </span>
        )}
      </div>

      <div
        ref={outputRef}
        style={{
          flex: 1,
          overflowY: "auto",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 9,
          color: "var(--text-secondary)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          minHeight: 0,
        }}
      >
        {lines.join("\n")}
        {isActive && (
          <span
            style={{
              animation: "drBlink 0.8s step-end infinite",
              color: "var(--info)",
            }}
          >
            ▎
          </span>
        )}
      </div>

      {ideaText && (
        <div
          style={
            {
              fontFamily: serif,
              fontSize: 10,
              color: "var(--text-muted)",
              lineHeight: 1.4,
              flexShrink: 0,
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: 4,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            } as React.CSSProperties
          }
        >
          {truncate(ideaText, 140)}
        </div>
      )}
    </div>
  );
};

// ── Middle panel — agent messages + cross-pollination ─────────────────────────

const AgentPanel: React.FC<{
  activeAgents: string[];
  seedIdeas: SeedIdea[];
  crossIdeas: CrossIdea[];
  currentEvents: string[];
  allLogs: string[];
}> = ({ activeAgents, seedIdeas, crossIdeas, currentEvents, allLogs }) => {
  const logBoxRef = useRef<HTMLDivElement>(null);
  const rawLogPanelRef = useRef<HTMLDetailsElement>(null);
  const [rawLogHeight, setRawLogHeight] = useState(120);

  const resizeRawLog = useCallback((clientY: number) => {
    const rect = rawLogPanelRef.current?.getBoundingClientRect();
    if (!rect) return;
    setRawLogHeight(Math.min(360, Math.max(80, rect.bottom - clientY)));
  }, []);

  // Auto-scroll log box
  useEffect(() => {
    logBoxRef.current?.scrollTo({
      top: logBoxRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [currentEvents.length]);

  const agentMessages = useMemo(() => parseAgentMessages(allLogs), [allLogs]);

  // Use activeAgents as canonical IDs (they carry full 'expert:xxx' form needed for idea lookups).
  // Fall back to parsed IDs when events haven't arrived yet.
  const liveIds = useMemo(() => {
    if (activeAgents.length > 0) return activeAgents;
    return [...new Set(agentMessages.map((m) => m.agentId))];
  }, [activeAgents, agentMessages]);

  return (
    <div
      style={{
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--background)",
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: 9,
          color: "var(--text-secondary)",
          fontWeight: 600,
          padding: "16px 16px 8px",
          flexShrink: 0,
        }}
      >
        Agent Activity
      </div>

      {/* ── Agent output cards ── */}
      <div
        style={{
          height: 190,
          flexShrink: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 8,
          padding: "8px 12px",
          overflowY: "auto",
          alignItems: "stretch",
        }}
      >
        {liveIds.length === 0 ? (
          <div
            style={{
              fontFamily: mono,
              fontSize: 10,
              color: "var(--text-muted)",
              paddingTop: 32,
              textAlign: "center",
              width: "100%",
            }}
          >
            Waiting for agents…
          </div>
        ) : (
          liveIds.map((agentId) => {
            // activeAgents IDs are 'expert:introcnn'; parsed log IDs are 'introcnn' —
            // try both so the card always gets its message
            const msg = [...agentMessages]
              .reverse()
              .find(
                (m) => m.agentId === agentId || m.agentId === shortId(agentId),
              );
            const seedIdea = seedIdeas.find((s) => s.agent_id === agentId);
            const crossIdea = crossIdeas.find((c) => c.agent_id === agentId);
            return (
              <AgentOutputCard
                key={agentId}
                agentId={agentId}
                msg={msg}
                ideaText={crossIdea?.text || seedIdea?.text}
              />
            );
          })
        )}
      </div>

      <div
        style={{
          height: 1,
          background: "var(--border-subtle)",
          flexShrink: 0,
        }}
      />

      {/* ── Scrollable message area ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "10px 12px 8px",
        }}
      >
        {/* Ideas from events.jsonl */}
        {crossIdeas.map((ci, i) => (
          <IdeaCard
            key={`cross-${i}`}
            tag="Cross-pollination"
            tagColor="var(--accent)"
            from={`${shortId(ci.agent_id)} × ${shortId(ci.seed_agent_id)}`}
            text={ci.text}
            connection={ci.connection}
          />
        ))}
        {seedIdeas.map((si, i) => (
          <IdeaCard
            key={`seed-${i}`}
            tag="Seed"
            tagColor="var(--info)"
            from={shortId(si.agent_id)}
            text={si.text}
          />
        ))}

        {/* Detailed transcripts stay available without dominating the workspace. */}
        {agentMessages.length > 0 && (
          <details
            style={{
              flexShrink: 0,
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface)",
              padding: "8px 10px",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                color: "var(--text-secondary)",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Detailed agent transcripts ({agentMessages.length})
            </summary>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginTop: 8,
              }}
            >
              {agentMessages.map((msg, i) => (
          <div
            key={i}
            style={{
              background: msg.isDone
                ? "var(--surface-raised)"
                : "var(--accent-soft)",
              border: `1px solid ${msg.isDone ? "var(--border-subtle)" : "var(--accent)"}`,
              borderLeft: `2px solid ${msg.isDone ? "var(--accent)" : "var(--info)"}`,
              borderRadius: "var(--radius-sm)",
              padding: "7px 10px",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              {!msg.isDone && (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--info)",
                    animation: "drPulse 1s ease-in-out infinite",
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: msg.isDone ? "var(--accent)" : "var(--info)",
                }}
              >
                {msg.stage}
              </span>
              <span style={{ fontFamily: mono, fontSize: 9, color: "var(--text-muted)" }}>
                {msg.agentId}
              </span>
              {msg.isDone && (
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 8,
                    color: "var(--text-muted)",
                    marginLeft: "auto",
                  }}
                >
                  done
                </span>
              )}
            </div>

            {msg.thinking.length > 0 && (
              <details style={{ marginBottom: 4 }}>
                <summary
                  style={{
                    fontFamily: mono,
                    fontSize: 8,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  thinking ({msg.thinking.join("").length} chars)
                </summary>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 9,
                    color: "var(--text-muted)",
                    lineHeight: 1.6,
                    marginTop: 4,
                    whiteSpace: "pre-wrap",
                    maxHeight: 120,
                    overflowY: "auto",
                  }}
                >
                  {msg.thinking.join("")}
                </div>
              </details>
            )}

            {msg.lines.length > 0 && (
              <p
                style={{
                  fontFamily: serif,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.55,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {truncate(msg.lines.join("\n"), 400)}
              </p>
            )}
          </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ── Raw logs ── */}
      <details
        ref={rawLogPanelRef}
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface)",
          position: "relative",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            padding: "7px 12px",
            color: "var(--text-muted)",
            fontSize: 10,
            userSelect: "none",
          }}
        >
          Raw activity log · {currentEvents.length} entries
        </summary>
        <div
          className="raw-log-resizer"
          role="separator"
          aria-label="Resize raw activity log"
          aria-orientation="horizontal"
          aria-valuemin={80}
          aria-valuemax={360}
          aria-valuenow={Math.round(rawLogHeight)}
          tabIndex={0}
          title="Drag to resize the raw activity log"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeRawLog(event.clientY);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              resizeRawLog(event.clientY);
            }
          }}
          onDoubleClick={() => setRawLogHeight(120)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              setRawLogHeight((height) =>
                Math.min(
                  360,
                  Math.max(80, height + (event.key === "ArrowUp" ? 16 : -16)),
                ),
              );
            }
          }}
        />
        <div
          ref={logBoxRef}
          style={{
            overflowY: "auto",
            height: rawLogHeight,
            maxHeight: rawLogHeight,
            padding: "5px 10px",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 9,
            color: "var(--text-muted)",
            lineHeight: 1.7,
          }}
        >
          {currentEvents.slice(-20).map((l, i) => (
            <div
              key={i}
              style={{
                color: l.includes("[ERR]")
                  ? "var(--danger)"
                  : l.includes("◆")
                    ? "var(--accent)"
                    : "var(--text-muted)",
              }}
            >
              {l.replace(/\x1b\[[0-9;]*m/g, "")}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
};

const IdeaCard: React.FC<{
  tag: string;
  tagColor: string;
  from: string;
  text: string;
  connection?: string;
}> = ({ tag, tagColor, from, text, connection }) => (
  <div
    style={{
      background: "var(--surface-raised)",
      border: `1px solid var(--border-subtle)`,
      borderLeft: `2px solid ${tagColor}`,
      borderRadius: "var(--radius-sm)",
      padding: "7px 10px",
      flexShrink: 0,
    }}
  >
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}
    >
      <span
        style={{
          fontFamily: mono,
          fontSize: 8,
          color: tagColor,
          background: "var(--surface-subtle)",
          borderRadius: "var(--radius-sm)",
          padding: "1px 5px",
        }}
      >
        {tag}
      </span>
      <span style={{ fontFamily: mono, fontSize: 9, color: "var(--text-muted)" }}>
        {from}
      </span>
    </div>
    <p
      style={{
        fontFamily: serif,
        fontSize: 12,
        color: "var(--text-secondary)",
        lineHeight: 1.55,
        margin: 0,
      }}
    >
      {truncate(text, 220)}
    </p>
    {connection && (
      <p
        style={{
          fontFamily: mono,
          fontSize: 9,
          color: "var(--text-muted)",
          lineHeight: 1.5,
          margin: "4px 0 0",
          borderTop: "1px solid var(--border-subtle)",
          paddingTop: 4,
        }}
      >
        {truncate(connection, 160)}
      </p>
    )}
  </div>
);

// ── Right panel — ideas / MCP ─────────────────────────────────────────────────

const IdeasPanel: React.FC<{
  seedIdeas: SeedIdea[];
  crossIdeas: CrossIdea[];
  plan: string;
}> = ({ seedIdeas, crossIdeas, plan }) => {
  const allIdeas = [...crossIdeas.slice(0, 6), ...seedIdeas.slice(0, 6)];

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: 9,
          color: "var(--text-secondary)",
          fontWeight: 600,
          padding: "16px 14px 8px",
        }}
      >
        Ideas &amp; Memory
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {allIdeas.length === 0 && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 10,
              color: "var(--text-muted)",
              padding: 4,
            }}
          >
            No ideas yet…
          </div>
        )}

        {allIdeas.map((idea, i) => (
          <div
            key={i}
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: "7px 9px",
            }}
          >
            <div
              style={{
                fontFamily: mono,
                fontSize: 8,
                color: "var(--text-muted)",
                marginBottom: 4,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{ color: "paper_title" in idea ? "var(--accent)" : "var(--info)" }}
              >
                {"seed_paper_title" in idea ? "cross-pollinate" : "seed"}
              </span>
              <span>{truncate(shortId(idea.agent_id), 16)}</span>
            </div>
            <p
              style={{
                fontFamily: serif,
                fontSize: 11,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {truncate(idea.text, 160)}
            </p>
            {"expected_effect" in idea && idea.expected_effect && (
              <p
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: "var(--accent)",
                  margin: "4px 0 0",
                  lineHeight: 1.4,
                }}
              >
                ↝ {truncate((idea as SeedIdea).expected_effect, 120)}
              </p>
            )}
          </div>
        ))}

        {/* Current plan */}
        {plan && (
          <div
            style={{
              background: "var(--accent-soft)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              padding: "7px 9px",
            }}
          >
            <div
              style={{
                fontFamily: mono,
                fontSize: 8,
                color: "var(--accent)",
                marginBottom: 5,
              }}
            >
              Current Plan
            </div>
            <p
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {truncate(plan, 300)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Event-derived types ───────────────────────────────────────────────────────

interface SeedIdea {
  idea_id: string;
  agent_id: string;
  paper_id: string;
  paper_title: string;
  text: string;
  rationale: string;
  expected_effect: string;
  changes: string;
}

interface CrossIdea {
  idea_id: string;
  agent_id: string;
  paper_id: string;
  seed_idea_id: string;
  seed_agent_id: string;
  seed_paper_title: string;
  text: string;
  connection: string;
  changes: string;
}

// ── Main DeepResearchTab ──────────────────────────────────────────────────────

interface Props {
  jobId: string;
  voidId: number;
  voidName: string;
  papers: PaperRef[];
  darkMode: boolean;
  onStatusChange: (s: "running" | "done" | "error") => void;
  onCrossPhaseChange?: (phase: CrossAnimPhase, pairLinks: PairLink[]) => void;
}

export const DeepResearchTab: React.FC<Props> = ({
  jobId,
  voidId,
  voidName,
  papers,
  onStatusChange,
  onCrossPhaseChange,
}) => {
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [metricPoints, setMetricPoints] = useState<MetricPoint[]>([]);
  const [codegenMap, setCodegenMap] = useState<
    Map<
      string,
      { jobId: string; status: "idle" | "running" | "done" | "error" }
    >
  >(new Map());
  const [recentLogs, setRecentLogs] = useState<string[]>([]);
  const [jobStage, setJobStage] = useState<
    "ingesting" | "ready" | "researching" | "complete"
  >("ingesting");
  const [launching, setLaunching] = useState(false);
  const [orchestratorWidth, setOrchestratorWidth] = useState(220);
  const [ideasWidth, setIdeasWidth] = useState(280);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const metricKey =
    voidName === IMAGENET_GAP ? "test_accuracy" : "predicted_accuracy";

  // Poll job stage every 2 s
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/investigate/${jobId}/status`);
        if (r.ok) {
          const d = (await r.json()) as { stage: typeof jobStage };
          setJobStage(d.stage);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setTimeout(poll, 2000);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const handleStartResearch = useCallback(async () => {
    setLaunching(true);
    try {
      await fetch(`/api/investigate/${jobId}/start-research`, {
        method: "POST",
      });
      setJobStage("researching");
    } catch (e) {
      console.error("start-research error", e);
    } finally {
      setLaunching(false);
    }
  }, [jobId]);

  // Poll research events every 2 s
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const [evtResp, metResp] = await Promise.all([
          fetch(`/api/investigate/${jobId}/research-events`),
          fetch(`/api/investigate/${jobId}/latest-metrics`),
        ]);
        if (evtResp.ok) {
          const data: ResearchEvent[] = await evtResp.json();
          setEvents(data);
          // Extract metric points from experiment_done events
          const pts = data
            .filter((e) => e.event === "experiment_done")
            .map((e, i) => {
              const m = e.payload.metrics as
                | Record<string, unknown>
                | undefined;
              const v = m
                ? Number(
                    m[metricKey] ??
                      m.test_accuracy ??
                      m.predicted_accuracy ??
                      0,
                  )
                : 0;
              return {
                iteration: (e.payload.iteration as number) ?? i,
                value: v,
                label: `i${(e.payload.iteration as number) ?? i}`,
              };
            });
          if (pts.length) setMetricPoints(pts);
        }
        if (metResp.ok) {
          const met = (await metResp.json()) as Record<string, unknown> | null;
          if (met) {
            const v = Number(
              met[metricKey] ??
                met.test_accuracy ??
                met.predicted_accuracy ??
                0,
            );
            if (v > 0) {
              setMetricPoints((prev) => {
                const last = prev[prev.length - 1];
                if (last?.value === v) return prev;
                const n = prev.length;
                return [...prev, { iteration: n, value: v, label: `i${n}` }];
              });
            }
          }
        }
      } catch {
        /* network error — ignore */
      }
      if (!cancelled) setTimeout(poll, 2000);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, metricKey]);

  // Track recent log lines from the investigation SSE stream
  useEffect(() => {
    const es = new EventSource(
      `/api/investigate/${encodeURIComponent(jobId)}/stream`,
    );
    const lines: string[] = [];
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data) as { type: string; message?: string };
        if (d.type === "log" && d.message) {
          lines.push(d.message);
          if (lines.length > 2000) lines.splice(0, lines.length - 2000);
          setRecentLogs([...lines]);
        }
        if (d.type === "done") {
          onStatusChange("done");
          es.close();
        }
        if (d.type === "error") {
          onStatusChange("error");
          es.close();
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [jobId, onStatusChange]);

  // Poll codegen job statuses
  useEffect(() => {
    if (!codegenMap.size) return;
    const running = [...codegenMap.values()].filter(
      (v) => v.status === "running",
    );
    if (!running.length) return;
    const t = setInterval(async () => {
      for (const entry of running) {
        try {
          const r = await fetch(`/api/paper2code/${entry.jobId}`);
          if (r.ok) {
            const d = (await r.json()) as {
              status: "running" | "done" | "error";
            };
            if (d.status !== "running") {
              setCodegenMap((prev) => {
                const m = new Map(prev);
                for (const [doi, v] of m) {
                  if (v.jobId === entry.jobId)
                    m.set(doi, { ...v, status: d.status });
                }
                return m;
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [codegenMap]);

  const handleGenerate = useCallback(async (paper: PaperRef) => {
    try {
      const r = await fetch("/api/paper2code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doi: paper.doi, title: paper.title }),
      });
      if (!r.ok) throw new Error("failed");
      const { jobId: cjId } = (await r.json()) as { jobId: string };
      setCodegenMap((prev) => {
        const m = new Map(prev);
        m.set(paper.doi, { jobId: cjId, status: "running" });
        return m;
      });
    } catch (e) {
      console.error("paper2code error", e);
    }
  }, []);

  // Derive structured state from events
  const latestIteration = useMemo(() => {
    const exps = events.filter((e) => e.event === "experiment_done");
    return exps.length
      ? ((exps[exps.length - 1].payload.iteration as number) ?? 0)
      : 0;
  }, [events]);

  const currentPhase = useMemo(() => {
    const phases = recentLogs
      .filter((l) => l.includes("PHASE") || l.includes("▶"))
      .slice(-1);
    return (
      phases[0]
        ?.replace(/\[.*?s\]/, "")
        .replace("▶", "")
        .trim() ?? ""
    );
  }, [recentLogs]);

  const seedIdeas = useMemo<SeedIdea[]>(() => {
    const e = events
      .filter((ev) => ev.event === "seed_ideas_done")
      .slice(-1)[0];
    const raw = (e?.payload.ideas ?? []) as Record<string, unknown>[];
    return raw.map((r) => ({
      idea_id: toStr(r.idea_id),
      agent_id: toStr(r.agent_id),
      paper_id: toStr(r.paper_id),
      paper_title: toStr(r.paper_title),
      text: toStr(r.text),
      rationale: toStr(r.rationale),
      expected_effect: toStr(r.expected_effect),
      changes: toStr(r.changes),
    }));
  }, [events]);

  const crossIdeas = useMemo<CrossIdea[]>(() => {
    const e = events
      .filter((ev) => ev.event === "cross_ideas_done")
      .slice(-1)[0];
    const raw = (e?.payload.ideas ?? []) as Record<string, unknown>[];
    return raw.map((r) => ({
      idea_id: toStr(r.idea_id),
      agent_id: toStr(r.agent_id),
      paper_id: toStr(r.paper_id),
      seed_idea_id: toStr(r.seed_idea_id),
      seed_agent_id: toStr(r.seed_agent_id ?? r.agent_id),
      seed_paper_title: toStr(r.seed_paper_title),
      text: toStr(r.text),
      connection: toStr(r.connection),
      changes: toStr(r.changes),
    }));
  }, [events]);

  const currentPlan = useMemo(() => {
    const e = events.filter((ev) => ev.event === "plan_done").slice(-1)[0];
    return toStr(e?.payload.plan);
  }, [events]);

  const diagnosis = useMemo(() => {
    const e = events
      .filter((ev) => ev.event === "orchestration_diagnosis_done")
      .slice(-1)[0];
    return toStr(e?.payload.diagnosis);
  }, [events]);

  const judgeEvent = useMemo(() => {
    const e = events.filter((ev) => ev.event === "judge_done").slice(-1)[0];
    const raw = e?.payload.judge as
      | Record<string, unknown>
      | string
      | undefined;
    if (!raw) return undefined;
    if (typeof raw === "string") return { decision: raw, reason: "" };
    return {
      decision: toStr(raw.decision),
      reason: toStr(raw.reason ?? raw.summary ?? raw.raw ?? ""),
    };
  }, [events]);

  const activeAgents = useMemo<string[]>(() => {
    const e = events
      .filter((ev) => ev.event === "agents_selected")
      .slice(-1)[0];
    return (e?.payload.agents as string[]) ?? [];
  }, [events]);

  // Derive and emit animation phase to EmbeddingAtlas
  useEffect(() => {
    if (!onCrossPhaseChange) return;

    const hasAgentsSelected = events.some((e) => e.event === "agents_selected");
    const hasSeedIdeas = events.some((e) => e.event === "seed_ideas_done");
    const hasCrossIdeas = events.some((e) => e.event === "cross_ideas_done");
    const hasPlanDone = events.some((e) => e.event === "plan_done");
    const hasExperiment = events.some((e) => e.event === "experiment_done");
    const hasJudgeKeep = events.some((e) => {
      if (e.event !== "judge_done") return false;
      const raw = e.payload.judge as
        | Record<string, unknown>
        | string
        | undefined;
      if (!raw) return false;
      const decision = typeof raw === "string" ? raw : toStr(raw.decision);
      return decision === "keep";
    });

    // Build pair links from seed + cross idea maps
    const agentPaperMap = new Map(
      seedIdeas.map((s) => [s.agent_id, s.paper_id]),
    );
    const pairLinks: PairLink[] = crossIdeas
      .map((ci) => ({
        fromDoi: agentPaperMap.get(ci.agent_id) ?? "",
        toDoi: agentPaperMap.get(ci.seed_agent_id) ?? "",
      }))
      .filter((p) => p.fromDoi && p.toDoi);

    let phase: CrossAnimPhase = "idle";
    if (hasJudgeKeep) phase = "glowing";
    else if (hasExperiment) phase = "building";
    else if (hasPlanDone) phase = "building";
    else if (hasCrossIdeas) phase = "proposals_complete";
    else if (hasSeedIdeas) phase = "cross_pollinating";
    else if (hasAgentsSelected) phase = "orchestrating";

    onCrossPhaseChange(phase, pairLinks);
  }, [events, seedIdeas, crossIdeas, onCrossPhaseChange]);

  const resizeOrchestrator = useCallback((clientX: number) => {
    const rect = dashboardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOrchestratorWidth(Math.min(340, Math.max(170, clientX - rect.left)));
  }, []);

  const resizeIdeas = useCallback((clientX: number) => {
    const rect = dashboardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setIdeasWidth(Math.min(400, Math.max(220, rect.right - clientX)));
  }, []);

  return (
    <div
      style={{
        background: "var(--background)",
        color: "var(--text-primary)",
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Workspace header ─────────────────────────────────────────── */}
      <header
        style={{
          minHeight: 58,
          padding: "10px 52px 10px 18px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          borderBottom: `1px solid ${DIM}`,
          background: "var(--surface)",
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {voidName}
          </div>
          <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-muted)" }}>
            {papers.length} source papers · void {voidId}
          </div>
        </div>
        <div
          style={{
            maxWidth: "48%",
            padding: "5px 9px",
            borderRadius: "var(--radius-pill)",
            background: "var(--surface-subtle)",
            color: "var(--text-secondary)",
            fontSize: 11,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentPhase || (jobStage === "ingesting" ? "Preparing papers" : "Ready")}
        </div>
      </header>

      {/* ── Source papers ────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 16px 12px",
          borderBottom: `1px solid ${DIM}`,
          background: "var(--surface)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            marginBottom: 8,
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-secondary)",
          }}
        >
          Source papers
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {papers.map((p, i) => (
            <PaperBox
              key={p.doi || i}
              paper={p}
              index={i}
              codegenStatus={codegenMap.get(p.doi)?.status ?? "idle"}
              onGenerate={handleGenerate}
            />
          ))}
        </div>
      </div>

      {/* ── Main 3-column area ────────────────────────────────────────── */}
      <div
        ref={dashboardRef}
        className="research-dashboard-grid"
        style={
          {
            flex: 1,
            "--orchestrator-width": `${orchestratorWidth}px`,
            "--ideas-width": `${ideasWidth}px`,
          } as React.CSSProperties
        }
      >
        <div
          className="dashboard-column-resizer"
          role="separator"
          aria-label="Resize orchestrator panel"
          aria-orientation="vertical"
          aria-valuemin={170}
          aria-valuemax={340}
          aria-valuenow={Math.round(orchestratorWidth)}
          tabIndex={0}
          title="Drag to resize the orchestrator panel"
          style={{ left: orchestratorWidth }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeOrchestrator(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              resizeOrchestrator(event.clientX);
            }
          }}
          onDoubleClick={() => setOrchestratorWidth(220)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setOrchestratorWidth((width) =>
                Math.min(
                  340,
                  Math.max(170, width + (event.key === "ArrowRight" ? 16 : -16)),
                ),
              );
            }
          }}
        />
        <div
          className="dashboard-column-resizer"
          role="separator"
          aria-label="Resize ideas and memory panel"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={400}
          aria-valuenow={Math.round(ideasWidth)}
          tabIndex={0}
          title="Drag to resize the ideas and memory panel"
          style={{ left: `calc(100% - ${ideasWidth}px)` }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeIdeas(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              resizeIdeas(event.clientX);
            }
          }}
          onDoubleClick={() => setIdeasWidth(280)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setIdeasWidth((width) =>
                Math.min(
                  400,
                  Math.max(220, width + (event.key === "ArrowLeft" ? 16 : -16)),
                ),
              );
            }
          }}
        />
        {/* Left: orchestrator */}
        <OrchestratorPanel
          phase={currentPhase}
          plan={currentPlan}
          diagnosis={diagnosis}
          judgeDecision={judgeEvent?.decision ?? ""}
          judgeReason={judgeEvent?.reason ?? ""}
          iteration={latestIteration}
        />

        {/* Middle: agents */}
        <AgentPanel
          activeAgents={activeAgents}
          seedIdeas={seedIdeas}
          crossIdeas={crossIdeas}
          currentEvents={recentLogs}
          allLogs={recentLogs}
        />

        {/* Right: ideas and metrics */}
        <aside className="research-dashboard-aside">
          <IdeasPanel
            seedIdeas={seedIdeas}
            crossIdeas={crossIdeas}
            plan={currentPlan}
          />
          <div
            style={{
              flexShrink: 0,
              padding: "12px",
              borderTop: "1px solid var(--border-subtle)",
              background: "var(--surface)",
              overflowX: "auto",
            }}
          >
            <MetricGraph
              points={metricPoints}
              width={220}
              height={100}
              metricKey={metricKey}
            />
          </div>
        </aside>
      </div>

      {/* ── Persistent workflow status ───────────────────────────────── */}
      <div
        style={{
          minHeight: 58,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "10px 16px",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--surface)",
        }}
      >
        {jobStage === "ingesting" && (
          <div
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              padding: "9px 22px",
              fontFamily: mono,
              fontSize: 12,
              color: "var(--info)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              animation: "drPulse 1.5s ease-in-out infinite",
            }}
          >
            Downloading &amp; ingesting papers…
          </div>
        )}

        {jobStage === "ready" && (
          <button
            onClick={handleStartResearch}
            disabled={launching}
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "12px 40px",
              fontSize: 14,
              fontWeight: 700,
              cursor: launching ? "wait" : "pointer",
              boxShadow: "var(--shadow-md)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {launching ? "Launching…" : "Research"}
          </button>
        )}

        {jobStage === "researching" && (
          <div
            style={{
              background: "var(--warning-soft)",
              border: "1px solid var(--warning)",
              borderRadius: "var(--radius-md)",
              padding: "9px 22px",
              fontFamily: mono,
              fontSize: 12,
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--warning)",
                display: "inline-block",
                animation: "drPulse 1.5s ease-in-out infinite",
              }}
            />
            Agent swarm running…
          </div>
        )}

        {jobStage === "complete" && (
          <div
            style={{
              background: "var(--success-soft)",
              border: "1px solid var(--success)",
              borderRadius: "var(--radius-md)",
              padding: "9px 22px",
              fontFamily: mono,
              fontSize: 12,
              color: "var(--success)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Research complete
          </div>
        )}
      </div>

      <style>{`
        @keyframes drPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes drDash   { to { stroke-dashoffset: -18; } }
        @keyframes drBlink  { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
};
