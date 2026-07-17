/**
 * EmbeddingAtlas.tsx  — with void detection overlay + dark mode
 */

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { quadtree as d3Quadtree } from "d3-quadtree";
import type { ProcessedPaper, ViewTransform } from "../types";
import { useWebGLRenderer } from "../hooks/useWebGLRenderer";
import { ClusterRings } from "./ClusterRings";
import { Tooltip } from "./Tooltip";
import { SearchBar } from "./SearchBar";
import { useParquetData } from "../hooks/useParquetData";
import { useVoidData } from "../hooks/useVoidData";
import { VoidOverlay } from "./VoidOverlay";
import { VoidPanel } from "./VoidPanel";
import { TabBar } from "./TabBar";
import { ResearchTab } from "./ResearchTab";
import { DeepResearchTab } from "./DeepResearchTab";
import { JobsDropdown } from "./JobsDropdown";
import type { ResearchJobInfo, CrossPollinationAnim, CrossAnimPhase, PairLink } from "../types";

const MIN_SCALE = 100;
const MAX_SCALE = 80000;
const HOVER_RADIUS_PX = 12;
const DRAG_THRESHOLD_PX = 4;

function buildQuadtree(papers: ProcessedPaper[]) {
  return d3Quadtree<ProcessedPaper>()
    .x((d) => d.nx)
    .y((d) => d.ny)
    .addAll(papers);
}

function screenToNorm(
  sx: number,
  sy: number,
  transform: ViewTransform,
): [number, number] {
  return [
    (sx - transform.offsetX) / transform.scale,
    (sy - transform.offsetY) / transform.scale,
  ];
}

export const EmbeddingAtlas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  // ── Dark mode ──────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(() => {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  const [researchPanelWidth, setResearchPanelWidth] = useState(() =>
    Math.min(1180, Math.max(420, window.innerWidth - 32)),
  );

  const dm = darkMode; // shorthand

  const { papers, clusters, loading, loadingProgress, error, reload } =
    useParquetData(size.width, size.height);

  const bounds = useMemo(() => {
    if (papers.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of papers) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
  }, [papers]);

  const { voids, loading: voidsLoading } = useVoidData(
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
    papers.length > 0,
  );

  const [selectedVoidId, setSelectedVoidId] = useState<number | null>(null);
  const [voidsVisible, setVoidsVisible] = useState(true);
  const [showVoidLabels, setShowVoidLabels] = useState(false);

  // ── Research tabs ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>("viz");
  const [researchJobs, setResearchJobs] = useState<
    Map<string, ResearchJobInfo>
  >(new Map());
  const voidJobMap = useRef<Map<number, string>>(new Map());

  // ── Cross-pollination animation state ──────────────────────────────────────
  const [crossAnim, setCrossAnim] = useState<CrossPollinationAnim>({
    phase: 'idle',
    voidId: null,
    selectedDois: [],
    pairLinks: [],
  });
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [transform, setTransform] = useState<ViewTransform>({
    scale: 600,
    offsetX: 50,
    offsetY: 50,
  });
  const [hovered, setHovered] = useState<ProcessedPaper | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(
    null,
  );
  const [hoveredClusterId, setHoveredClusterId] = useState<number | null>(null);
  const [searchResultIds, setSearchResultIds] = useState<Set<
    string | number
  > | null>(null);

  const qtRef = useRef<ReturnType<typeof buildQuadtree> | null>(null);
  const isDragging = useRef(false);
  const dragMoved = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const voidBorderIds = useMemo<Set<string | number> | null>(() => {
    if (selectedVoidId === null) return null;
    const v = voids.find((v) => v.void_id === selectedVoidId);
    if (!v) return null;
    return new Set<string | number>(v.border_papers.map((p) => p.DOI));
  }, [selectedVoidId, voids]);

  const activeSearchResultIds = useMemo(() => {
    if (voidBorderIds !== null) return voidBorderIds;
    return searchResultIds;
  }, [voidBorderIds, searchResultIds]);

  const activeSelectedClusterId = useMemo(() => {
    if (selectedVoidId !== null) return null;
    return selectedClusterId;
  }, [selectedVoidId, selectedClusterId]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      setResearchPanelWidth((width) =>
        Math.min(width, Math.max(420, window.innerWidth - 16)),
      );
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  const resizeResearchPanel = useCallback((clientX: number) => {
    const minWidth = Math.min(420, window.innerWidth);
    const maxWidth = Math.max(minWidth, window.innerWidth - 16);
    setResearchPanelWidth(
      Math.min(maxWidth, Math.max(minWidth, window.innerWidth - clientX)),
    );
  }, []);

  const handleResearchResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      resizeResearchPanel(event.clientX);
    },
    [resizeResearchPanel],
  );

  const handleResearchResizeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      resizeResearchPanel(event.clientX);
    },
    [resizeResearchPanel],
  );

  useEffect(() => {
    if (papers.length > 0) qtRef.current = buildQuadtree(papers);
  }, [papers]);

  useEffect(() => {
    if (papers.length === 0) return;
    setTransform({
      scale: Math.min(size.width, size.height) * 0.9,
      offsetX: size.width * 0.05,
      offsetY: size.height * 0.05,
    });
  }, [size.width, size.height, papers.length > 0]);

  const crossPollinationActive = crossAnim.phase !== 'idle' && crossAnim.phase !== 'done';
  const goldDois = crossPollinationActive
    ? new Set<string | number>(crossAnim.selectedDois)
    : undefined;

  useWebGLRenderer(canvasRef, {
    papers,
    width: size.width,
    height: size.height,
    transform,
    hoveredId: hovered?.id ?? null,
    selectedClusterId: activeSelectedClusterId,
    searchResultIds: activeSearchResultIds,
    darkMode,
    crossPollinationActive,
    goldDois,
  });

  // ── Pointer events ────────────────────────────────────────────────────────
  const rafRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMousePos({ x: sx, y: sy });

    if (isDragging.current) {
      const dx = sx - lastMouse.current.x;
      const dy = sy - lastMouse.current.y;
      if (
        Math.abs(e.clientX - lastMouse.current.x) > DRAG_THRESHOLD_PX ||
        Math.abs(e.clientY - lastMouse.current.y) > DRAG_THRESHOLD_PX
      )
        dragMoved.current = true;
      setTransform((t) => ({
        ...t,
        offsetX: t.offsetX + dx,
        offsetY: t.offsetY + dy,
      }));
      lastMouse.current = { x: sx, y: sy };
      return;
    }

    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!qtRef.current) return;
      const t = transformRef.current;
      const [nx, ny] = screenToNorm(sx, sy, t);
      const radiusNorm = HOVER_RADIUS_PX / t.scale;
      const found = qtRef.current.find(nx, ny, radiusNorm);
      setHovered(found ?? null);
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragMoved.current = false;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragMoved.current) return;
      if (!hovered) {
        if (selectedClusterId !== null) setSelectedClusterId(null);
        if (selectedVoidId !== null) setSelectedVoidId(null);
        return;
      }
      const pdfUrl = hovered.pdfUrl?.trim();
      if (pdfUrl) {
        window.open(pdfUrl, "_blank", "noopener,noreferrer");
        return;
      }
      const doi = hovered.doi;
      if (doi && doi !== "null" && doi.trim()) {
        const url = `https://arxiv.org/abs/${doi}`;
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [hovered, selectedClusterId, selectedVoidId],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setTransform((t) => {
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, t.scale * factor),
      );
      const scaleDelta = newScale / t.scale;
      return {
        scale: newScale,
        offsetX: mx - scaleDelta * (mx - t.offsetX),
        offsetY: my - scaleDelta * (my - t.offsetY),
      };
    });
  }, []);

  const lastTouches = useRef<React.TouchList | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    lastTouches.current = e.touches;
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!lastTouches.current) return;
    if (e.touches.length === 1 && lastTouches.current.length === 1) {
      const dx = e.touches[0].clientX - lastTouches.current[0].clientX;
      const dy = e.touches[0].clientY - lastTouches.current[0].clientY;
      setTransform((t) => ({
        ...t,
        offsetX: t.offsetX + dx,
        offsetY: t.offsetY + dy,
      }));
    } else if (e.touches.length === 2 && lastTouches.current.length === 2) {
      const d0 = Math.hypot(
        lastTouches.current[0].clientX - lastTouches.current[1].clientX,
        lastTouches.current[0].clientY - lastTouches.current[1].clientY,
      );
      const d1 = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const factor = d1 / (d0 || 1);
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setTransform((t) => {
        const newScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, t.scale * factor),
        );
        const sf = newScale / t.scale;
        return {
          scale: newScale,
          offsetX: mx - sf * (mx - t.offsetX),
          offsetY: my - sf * (my - t.offsetY),
        };
      });
    }
    lastTouches.current = e.touches;
  }, []);

  const handleSearchResults = useCallback(
    (ids: Set<string | number> | null, focusPaper?: ProcessedPaper) => {
      setSearchResultIds(ids);
      setSelectedVoidId(null);
      if (focusPaper) {
        setTransform((t) => ({
          ...t,
          offsetX: size.width / 2 - focusPaper.nx * t.scale,
          offsetY: size.height / 2 - focusPaper.ny * t.scale,
        }));
      }
    },
    [size],
  );

  const handleClusterClick = useCallback(
    (id: number) => {
      setSelectedClusterId((prev) => (prev === id ? null : id));
      setSelectedVoidId(null);
      setSearchResultIds(null);
      const cluster = clusters.get(id);
      if (cluster) {
        setTransform((t) => ({
          ...t,
          offsetX: size.width / 2 - cluster.centroid[0] * t.scale,
          offsetY: size.height / 2 - cluster.centroid[1] * t.scale,
        }));
      }
    },
    [clusters, size],
  );

  const handleVoidSelect = useCallback(
    (id: number | null) => {
      setSelectedVoidId(id);
      setSelectedClusterId(null);
      setSearchResultIds(null);
      if (id === null) return;
      const v = voids.find((v) => v.void_id === id);
      if (!v) return;
      setTransform((t) => ({
        ...t,
        offsetX: size.width / 2 - v.ncx * t.scale,
        offsetY: size.height / 2 - v.ncy * t.scale,
      }));
    },
    [voids, size],
  );

  const IMAGENET_GAP = "Transformer-Augmented Vision Adaptation Gap";

  const handleInvestigate = useCallback(async () => {
    if (selectedVoidId === null) return;
    const v = voids.find((v) => v.void_id === selectedVoidId);
    if (!v) return;

    // Switch to existing job if already running
    const existingJobId = voidJobMap.current.get(v.void_id);
    if (existingJobId) {
      // Re-open the agent-swarm view for a void already under investigation.
      setActiveTab(`${existingJobId}:deep`);
      return;
    }

    const papers = v.selected_papers.map((p) => ({
      doi: p.DOI,
      title: p.title,
      year: p.year,
      citation_count: p.citation_count,
      abstract: p.abstract,
    }));

    // Kick off graph animation immediately
    const selectedDois = v.selected_papers.map((p) => p.DOI);
    setCrossAnim({
      phase: 'orchestrating',
      voidId: v.void_id,
      selectedDois,
      pairLinks: [],
    });

    try {
      const resp = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voidId: v.void_id, voidName: v.name, papers }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { jobId } = (await resp.json()) as { jobId: string };

      voidJobMap.current.set(v.void_id, jobId);
      setResearchJobs((prev) => {
        const m = new Map(prev);
        m.set(jobId, {
          voidId: v.void_id,
          voidName: v.name,
          status: "running",
          papers,
        });
        return m;
      });
      // Open the agent-swarm (Deep Research) view for every void.
      setActiveTab(`${jobId}:deep`);
    } catch (e) {
      console.error("[Investigate] Failed to start investigation:", e);
    }
  }, [selectedVoidId, voids]);

  const handleCrossPhaseChange = useCallback((
    phase: CrossAnimPhase,
    pairLinks: PairLink[],
  ) => {
    setCrossAnim(prev => {
      if (prev.phase === 'done') return prev;
      if (prev.phase === 'glowing' && phase !== 'done') return prev;
      return { ...prev, phase, pairLinks };
    });

    if (phase === 'glowing') {
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
      glowTimerRef.current = setTimeout(() => {
        setCrossAnim(prev =>
          prev.phase === 'glowing' ? { ...prev, phase: 'done' } : prev,
        );
      }, 1300);
    }
  }, []);

  const researchDoneVoidIds = useMemo<Set<number>>(() => {
    const s = new Set<number>();
    for (const [, job] of researchJobs) {
      if (job.status === 'done') s.add(job.voidId);
    }
    return s;
  }, [researchJobs]);

  const stats = useMemo(
    () => ({
      total: papers.length,
      clusterCount: clusters.size,
    }),
    [papers.length, clusters.size],
  );

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const theme = {
    bg: "var(--graph-background)",
    dot: "var(--graph-grid)",
    glass: "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
    glassBorder: "var(--border-subtle)",
    glassShadow: "var(--shadow-sm)",
    titleColor: "var(--text-primary)",
    subColor: "var(--text-muted)",
    btnBg: "var(--surface-raised)",
    btnBorder: "var(--border-default)",
    btnColor: "var(--text-secondary)",
    clusterBg: "var(--surface-raised)",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const shortVoidName = (name: string) =>
    name.length > 24 ? name.slice(0, 22) + "…" : name;

  const tabList = [
    { id: "viz", label: "Visualization" },
    ...Array.from(researchJobs.entries()).flatMap(([jid, job]) => {
      const short = shortVoidName(job.voidName);
      // Every investigated void gets both the agent-swarm view and raw logs.
      return [
        {
          id: `${jid}:deep`,
          label: `${short} — Deep Research`,
          closeable: true as const,
          status: job.status,
        },
        {
          id: `${jid}:logs`,
          label: `${short} — Full Logs`,
          closeable: true as const,
          status: job.status,
        },
      ];
    }),
  ];

  const handleCloseTab = (tabId: string) => {
    const jobId = tabId.split(":")[0];
    // Remove the whole job if both tabs are being closed (we close per-tab but same jobId)
    const jobTabs = tabList.filter(
      (t) => t.id.startsWith(jobId) && t.id !== "viz",
    );
    if (jobTabs.length <= 1) {
      // Last tab for this job — clean up the job entirely
      setResearchJobs((prev) => {
        const m = new Map(prev);
        m.delete(jobId);
        return m;
      });
      for (const [vid, jid] of voidJobMap.current)
        if (jid === jobId) {
          voidJobMap.current.delete(vid);
          break;
        }
    }
    if (activeTab === tabId) setActiveTab("viz");
  };

  return (
    <div
      data-theme={dm ? "dark" : "light"}
      style={{ display: "flex", flexDirection: "column", height: "100dvh" }}
    >
      {/* Content area — visualization always mounted; research overlay on top */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Visualization pane */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ background: theme.bg }}
        >
          {/* Grid texture */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle, ${theme.dot} 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
              opacity: 0.55,
              zIndex: 0,
            }}
          />

          {/* Void panel */}
          <VoidPanel
            voids={voids}
            selectedVoidId={selectedVoidId}
            showVoidLabels={showVoidLabels}
            voidsVisible={voidsVisible}
            loading={voidsLoading}
            onSelectVoid={handleVoidSelect}
            onToggleLabels={() => setShowVoidLabels((v) => !v)}
            onToggleVoids={() => setVoidsVisible((v) => !v)}
            darkMode={dm}
          />

          {/* Main canvas + overlay container */}
          <div
            ref={containerRef}
            className="absolute inset-0"
            style={{
              cursor: isDragging.current
                ? "grabbing"
                : hovered
                  ? "pointer"
                  : "grab",
              zIndex: 1,
            }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleClick}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => {
              lastTouches.current = null;
            }}
          >
            <canvas
              ref={canvasRef}
              width={size.width}
              height={size.height}
              className="absolute inset-0"
              style={{ zIndex: 1 }}
            />

            {!loading && (
              <ClusterRings
                clusters={clusters}
                selectedClusterId={selectedClusterId}
                hoveredClusterId={hoveredClusterId}
                transform={transform}
                width={size.width}
                height={size.height}
                onClusterClick={handleClusterClick}
                onClusterHover={setHoveredClusterId}
                darkMode={dm}
              />
            )}

            {!loading && voidsVisible && voids.length > 0 && (
              <VoidOverlay
                voids={voids}
                selectedVoidId={selectedVoidId}
                showVoidLabels={showVoidLabels}
                transform={transform}
                width={size.width}
                height={size.height}
                onVoidClick={(id) =>
                  handleVoidSelect(id === selectedVoidId ? null : id)
                }
                researchDoneVoidIds={researchDoneVoidIds}
                crossAnim={crossAnim}
              />
            )}
          </div>

          {/* Tooltip */}
          <Tooltip
            paper={hovered}
            x={mousePos.x}
            y={mousePos.y}
            containerWidth={size.width}
            containerHeight={size.height}
            darkMode={dm}
          />

          {/* Search bar */}
          <div
            className="atlas-search absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3"
            style={{ zIndex: 50 }}
          >
            <SearchBar
              papers={papers}
              onResults={handleSearchResults}
              disabled={loading}
              darkMode={dm}
            />
          </div>

          {/* Top-left title */}
          <div className="absolute top-4 left-4" style={{ zIndex: 50 }}>
            <div
              style={{
                background: theme.glass,
                border: `1px solid ${theme.glassBorder}`,
                borderRadius: "var(--radius-md)",
                padding: "10px 14px",
                boxShadow: theme.glassShadow,
              }}
            >
              <h1
                style={{
                  fontSize: 16,
                  lineHeight: 1.15,
                  fontWeight: 600,
                  color: theme.titleColor,
                  margin: 0,
                }}
              >
                arXiv Atlas
              </h1>
              <p
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  marginBottom: 0,
                  color: theme.subColor,
                }}
              >
                {stats.total > 0
                  ? `${stats.total.toLocaleString()} papers · ${stats.clusterCount} clusters · ${voids.length} voids`
                  : "Loading…"}
              </p>
            </div>
          </div>

          {/* Bottom-right controls: zoom + dark mode toggle */}
          <div
            className="absolute bottom-4 right-4 flex flex-col gap-2"
            style={{ zIndex: 50 }}
          >
            {[
              { label: "+", delta: 1.5, title: "Zoom in" },
              { label: "−", delta: 1 / 1.5, title: "Zoom out" },
              { label: "⊙", delta: null, title: "Reset view" },
            ].map(({ label, delta, title }) => (
              <button
                key={label}
                title={title}
                aria-label={title}
                onClick={() => {
                  if (delta === null) {
                    setTransform({
                      scale: Math.min(size.width, size.height) * 0.9,
                      offsetX: size.width * 0.05,
                      offsetY: size.height * 0.05,
                    });
                    setSelectedClusterId(null);
                    setSelectedVoidId(null);
                    setSearchResultIds(null);
                  } else {
                    setTransform((t) => {
                      const newScale = Math.max(
                        MIN_SCALE,
                        Math.min(MAX_SCALE, t.scale * delta),
                      );
                      const sf = newScale / t.scale;
                      return {
                        scale: newScale,
                        offsetX:
                          size.width / 2 - sf * (size.width / 2 - t.offsetX),
                        offsetY:
                          size.height / 2 - sf * (size.height / 2 - t.offsetY),
                      };
                    });
                  }
                }}
                style={{
                  width: 36,
                  height: 36,
                  background: theme.btnBg,
                  border: `1px solid ${theme.btnBorder}`,
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-xs)",
                  fontSize: label === "⊙" ? 16 : 20,
                  color: theme.btnColor,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {label}
              </button>
            ))}

            {/* Dark mode toggle */}
            <button
              title={dm ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={dm ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setDarkMode((v) => !v)}
              style={{
                width: 36,
                height: 36,
                background: theme.btnBg,
                border: `1px solid ${theme.btnBorder}`,
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-xs)",
                fontSize: 16,
                color: theme.btnColor,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {dm ? "☀︎" : "☽"}
            </button>
          </div>

          {/* Bottom-left cluster info */}
          {selectedClusterId !== null && selectedVoidId === null && (
            <div className="absolute bottom-4 left-4" style={{ zIndex: 50 }}>
              <div
                style={{
                  background: theme.clusterBg,
                  border: "1px solid var(--border-subtle)",
                  borderLeft: `3px solid ${clusters.get(selectedClusterId)?.color ?? "var(--border-strong)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "10px 14px",
                  boxShadow: "var(--shadow-sm)",
                  maxWidth: 260,
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background:
                        clusters.get(selectedClusterId)?.color ?? "var(--border-strong)",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {clusters.get(selectedClusterId)?.label ??
                      `Cluster ${selectedClusterId}`}
                  </span>
                  <button
                    onClick={() => setSelectedClusterId(null)}
                    aria-label="Clear cluster selection"
                    style={{
                      marginLeft: "auto",
                      fontSize: 14,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                    }}
                  >
                    ×
                  </button>
                </div>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    margin: 0,
                  }}
                >
                  {clusters.get(selectedClusterId)?.size.toLocaleString() ?? 0}{" "}
                  papers
                </p>
              </div>
            </div>
          )}

          {/* Investigate button — shown at bottom centre when a void is selected */}
          {selectedVoidId !== null && (
            <div
              style={{
                position: "absolute",
                bottom: 20,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 60,
              }}
            >
              <button
                onClick={handleInvestigate}
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-foreground)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  minHeight: 38,
                  padding: "8px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "var(--shadow-sm)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  whiteSpace: "nowrap",
                }}
              >
                Investigate
              </button>
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center"
              style={{
                background: "color-mix(in srgb, var(--graph-background) 92%, transparent)",
                zIndex: 100,
                backdropFilter: "blur(4px)",
              }}
            >
              <div className="flex flex-col items-center gap-4">
                <div
                  style={{
                    width: 44,
                    height: 44,
                    border: "3px solid var(--accent-soft)",
                    borderTop: "3px solid var(--accent)",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                <div className="text-center">
                  <p
                    style={{
                      fontSize: 18,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      margin: 0,
                    }}
                  >
                    arXiv Atlas
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                  >
                    {loadingProgress}
                  </p>
                </div>
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Error overlay */}
          {error && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                background: "color-mix(in srgb, var(--graph-background) 95%, transparent)",
                zIndex: 100,
              }}
            >
              <div
                style={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--danger)",
                  borderRadius: "var(--radius-lg)",
                  padding: "24px 28px",
                  maxWidth: 440,
                  boxShadow: "var(--shadow-md)",
                }}
              >
                <p
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    margin: "0 0 8px",
                  }}
                >
                  Failed to load data
                </p>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--danger)",
                    marginBottom: 16,
                    wordBreak: "break-all",
                  }}
                >
                  {error}
                </p>
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: 12,
                    marginBottom: 16,
                  }}
                >
                  Make sure{" "}
                  <code
                    style={{
                      background: "var(--surface-subtle)",
                      padding: "1px 4px",
                      borderRadius: 3,
                    }}
                  >
                    umap_200k.parquet
                  </code>{" "}
                  and{" "}
                  <code
                    style={{
                      background: "var(--surface-subtle)",
                      padding: "1px 4px",
                      borderRadius: 3,
                    }}
                  >
                    voids.json
                  </code>{" "}
                  are in your{" "}
                  <code
                    style={{
                      background: "var(--surface-subtle)",
                      padding: "1px 4px",
                      borderRadius: 3,
                    }}
                  >
                    public/
                  </code>{" "}
                  folder.
                </p>
                <button
                  onClick={reload}
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-foreground)",
                    border: "none",
                    borderRadius: 7,
                    padding: "8px 16px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
        {/* end visualization pane */}

        {/* Research tab overlay — absolute on top of visualization when active */}
        {(() => {
          const [jobId, tabType] = activeTab.split(":");
          const job = researchJobs.get(jobId);
          if (!job) return null;

          const onStatusChange = (status: "running" | "done" | "error") =>
            setResearchJobs((prev) => {
              const m = new Map(prev);
              const j = m.get(jobId);
              if (j) m.set(jobId, { ...j, status });
              return m;
            });

          return (
            <div
              className="research-overlay absolute z-200 h-full flex right-0 top-0"
              style={{
                width: researchPanelWidth,
                borderLeft: "1px solid var(--border-default)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              <div
                className="research-resize-handle"
                role="separator"
                aria-label="Resize research dashboard"
                aria-orientation="vertical"
                aria-valuemin={420}
                aria-valuemax={Math.max(420, window.innerWidth - 16)}
                aria-valuenow={Math.round(researchPanelWidth)}
                tabIndex={0}
                title="Drag to resize · Double-click to reset"
                onPointerDown={handleResearchResizeStart}
                onPointerMove={handleResearchResizeMove}
                onDoubleClick={() =>
                  setResearchPanelWidth(
                    Math.min(1180, Math.max(420, window.innerWidth - 32)),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    setResearchPanelWidth((width) =>
                      Math.min(window.innerWidth - 16, width + 24),
                    );
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    setResearchPanelWidth((width) => Math.max(420, width - 24));
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    setResearchPanelWidth(420);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    setResearchPanelWidth(Math.max(420, window.innerWidth - 16));
                  }
                }}
              >
                <span />
              </div>
              <button
                className="absolute top-0 right-0 z-300 cursor-pointer w-8 h-8 m-3 border rounded-full flex items-center justify-center"
                onClick={() => setActiveTab("viz")}
                aria-label="Close research panel"
                title="Close research panel"
                style={{
                  color: "var(--text-secondary)",
                  background: "var(--surface-raised)",
                  borderColor: "var(--border-default)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="size-4"
                >
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
              {tabType === "deep" ? (
                <DeepResearchTab
                  jobId={jobId}
                  voidId={job.voidId}
                  voidName={job.voidName}
                  papers={job.papers}
                  darkMode={dm}
                  onStatusChange={onStatusChange}
                  onCrossPhaseChange={handleCrossPhaseChange}
                />
              ) : (
                <ResearchTab
                  jobId={jobId}
                  voidName={job.voidName}
                  darkMode={dm}
                  onStatusChange={onStatusChange}
                />

              )}
            </div>
          );
        })()}
      </div>
      {/* end content area */}
    </div>
  );
};
