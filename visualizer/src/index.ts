import { serve } from "bun";
import index from "./index.html";
import { readParquet } from 'parquet-wasm/node';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

// ── Research investigation job management ─────────────────────────────────────

interface InvestigationJob {
  logs:        string[];
  status:      'running' | 'done' | 'error';
  stage:       'ingesting' | 'ready' | 'researching' | 'complete';
  voidId:      number;
  voidName:    string;
  papers:      Array<{ doi?: string; title: string; abstract?: string; year?: number }>;
  outcome?:    string;
  subscribers: Set<(msg: string, type: string) => void>;
  sessionDir?: string;   // set once the research orchestrator announces it
}

// Mini jobs for single-paper codegen triggered from the UI
interface CodegenJob {
  logs:   string[];
  status: 'running' | 'done' | 'error';
  doi:    string;
}
const codegenJobs = new Map<string, CodegenJob>();

const activeJobs = new Map<string, InvestigationJob>();

interface ResearchProblemConfig {
  problemDir: string;
  problem: string;
  runCommand: string;
  metric: string;
  papers: string[];
}

function makeJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function researchEnv(extra: Record<string, string> = {}): Record<string, string> {
  const gx10Url = process.env.LOCAL_LLM_URL ?? '';
  const explicitBackend = process.env.LLM_BACKEND?.trim();
  const inferredBackend =
    explicitBackend ||
    (process.env.ANTHROPIC_API_KEY ? 'anthropic' :
      process.env.OPENROUTER_API_KEY ? 'openrouter' :
        'offline');

  return {
    ...process.env,
    LLM_BACKEND:        inferredBackend,
    ANTHROPIC_API_KEY:  process.env.ANTHROPIC_API_KEY ?? '',
    LOCAL_LLM_URL:      gx10Url,
    LOCAL_LLM_MODEL:    process.env.LOCAL_LLM_MODEL ?? 'gemma4:latest',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    PYTHONUNBUFFERED:   '1',
    ...extra,
  };
}

function resolveResearchPython(rootDir: string): string {
  const virtualEnvPython = process.env.VIRTUAL_ENV
    ? resolve(process.env.VIRTUAL_ENV, 'bin', 'python')
    : '';
  const candidates = [
    process.env.RESEARCH_PYTHON ?? '',
    virtualEnvPython,
    '/opt/homebrew/bin/python3',
    'python3',
  ].filter(Boolean);

  const failures: string[] = [];
  for (const candidate of [...new Set(candidates)]) {
    const probe = Bun.spawnSync({
      cmd: [candidate, '-c', 'import sys, torch; print(sys.executable)'],
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: researchEnv(),
    });
    if (probe.exitCode === 0) return candidate;
    const detail = new TextDecoder().decode(probe.stderr).trim().split('\n').slice(-1)[0] ?? 'probe failed';
    failures.push(`${candidate}: ${detail}`);
  }
  throw new Error(
    `No Python runtime with PyTorch is available. Set RESEARCH_PYTHON to the correct interpreter. ${failures.join(' | ')}`,
  );
}

function visionResearchProblem(): ResearchProblemConfig {
  return {
    problemDir: 'research_problems/imagenet_cnn',
    problem: 'Improve the Tiny-ImageNet style CNN classifier while keeping the evaluation command, RGB image input, and metrics contract fixed.',
    runCommand: 'python3 train.py --dataset fake --epochs 2 --limit-train 400 --limit-test 160 --image-size 32 --data-dir data --metrics-out logs/latest_metrics.json --log-file logs/train_events.jsonl',
    metric: 'test_accuracy',
    papers: [
      'data/cleaned_json/an_introduction_to_convolutional_neural_networks_cleaned.json',
      'data/cleaned_json/an_image_is_worth_16x16_words_transformers_for_image_recognition_at_scale_cleaned.json',
      'data/cleaned_json/attention_is_all_you_need_cleaned.json',
    ],
  };
}

function mnistResearchProblem(): ResearchProblemConfig {
  return {
    problemDir: 'research_problems/mnist_fcnn',
    problem: 'Improve a poorly performing MNIST classifier while keeping the evaluation command and metrics contract fixed.',
    runCommand: 'python3 train.py --dataset fake --epochs 2 --limit-train 800 --limit-test 200 --data-dir data --metrics-out logs/latest_metrics.json --log-file logs/train_events.jsonl',
    metric: 'test_accuracy',
    papers: [
      'data/cleaned_json/improving_classification_neural_networks_by_using_absolute_activation_function_mnistlenet-5_example_cleaned.json',
      'data/cleaned_json/an_introduction_to_convolutional_neural_networks_cleaned.json',
      'data/cleaned_json/attention_is_all_you_need_cleaned.json',
      'data/cleaned_json/fast_kv_compaction_via_attention_matching_cleaned.json',
    ],
  };
}

function resolveResearchProblem(voidName: string): ResearchProblemConfig {
  const normalized = voidName.toLowerCase();
  if (
    normalized.includes('mnist') ||
    normalized.includes('classification') ||
    normalized.includes('transformer-augmented')
  ) {
    return mnistResearchProblem();
  }

  return visionResearchProblem();
}

function safePaperId(value: string, index: number): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (normalized || `paper_${index + 1}`).slice(0, 100);
}

async function stageSelectedPapers(
  job: InvestigationJob,
  sessionDir: string,
): Promise<string[]> {
  const paperDir = resolve(sessionDir, 'source_papers');
  mkdirSync(paperDir, { recursive: true });
  const paths: string[] = [];

  for (const [index, paper] of job.papers.entries()) {
    const title = String(paper.title || `Boundary paper ${index + 1}`).trim();
    const abstract = String(paper.abstract || '').trim();
    const paperId = safePaperId(String(paper.doi || title), index);
    const path = resolve(paperDir, `${paperId}.json`);
    const evidenceText = abstract ||
      `${title}. This boundary paper was selected from the knowledge void "${job.voidName}". ` +
      `Use its title and relationship to the other selected papers as limited evidence; do not invent findings.`;
    await Bun.write(path, JSON.stringify({
      paper_id: paperId,
      title,
      abstract: evidenceText,
      pdf_parse: {
        paper_id: paperId,
        abstract: [{ text: evidenceText, section: 'Abstract', sec_num: null }],
        body_text: [],
        back_matter: [],
        ref_entries: {},
      },
    }, null, 2));
    paths.push(path);
  }
  return paths;
}

// ── Shared subprocess pipe helper ─────────────────────────────────────────────
// Drains stdout + stderr fully THEN fires the exit callback so the last error
// lines are guaranteed to reach subscribers before the terminal event is sent.

function makePusher(job: InvestigationJob) {
  return (prefix: string, line: string) => {
    if (!line.trim()) return;
    const msg = `${prefix}${line}`;
    job.logs.push(msg);
    if (!job.sessionDir) {
      const m = line.match(/Session directory:\s*(.+)/);
      if (m) job.sessionDir = m[1].trim();
    }
    for (const sub of job.subscribers) {
      try { sub(msg, 'log'); } catch { job.subscribers.delete(sub); }
    }
  };
}

async function drainStream(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  push: (prefix: string, line: string) => void,
) {
  const dec = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of stream) {
      buf += dec.decode(chunk, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) push(prefix, line);
    }
  } catch { /* stream closed early */ }
  if (buf.trim()) push(prefix, buf);
}

function notify(
  job: InvestigationJob,
  msg: string,
  type: 'log' | 'done' | 'error',
) {
  job.logs.push(msg);
  for (const sub of job.subscribers) {
    try { sub(msg, type); } catch { job.subscribers.delete(sub); }
  }
  if (type !== 'log') job.subscribers.clear();
}

async function spawnInvestigation(
  jobId: string,
  voidId: number,
  voidName: string,
  papers: Array<{ doi?: string; title: string; abstract?: string; year?: number }>,
): Promise<void> {
  const rootDir  = resolve(import.meta.dir, '../..');
  const gx10Url  = process.env.LOCAL_LLM_URL ?? '';
  const scriptPy = resolve(rootDir, 'run_investigation.py');

  const job: InvestigationJob = {
    logs:        [],
    status:      'running',
    stage:       'ingesting',
    voidId,
    voidName,
    papers,
    subscribers: new Set(),
  };
  activeJobs.set(jobId, job);

  const push = makePusher(job);

  const proc = Bun.spawn({
    cmd: [
      'python3', scriptPy,
      '--void-id',   String(voidId),
      '--void-name', voidName,
      '--papers',    JSON.stringify(papers),
      '--gx10-url',  gx10Url,
    ],
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: rootDir,
    env: researchEnv({ LOCAL_LLM_URL: gx10Url }),
  });

  // Drain both streams and wait for process exit — in that order so all output
  // is captured before we fire the terminal event.
  const stdoutDone = drainStream(proc.stdout, '',       push);
  const stderrDone = drainStream(proc.stderr, '[ERR] ', push);

  ;(async () => {
    const code = await proc.exited;
    await Promise.allSettled([stdoutDone, stderrDone]); // flush remaining bytes

    // This is always the ingest process — advance to ready, keep SSE open
    job.stage  = 'ready';
    job.status = 'running';
    const msg = code === 0
      ? '=== INGEST COMPLETE — click Research to start the agent swarm ==='
      : `=== INGEST ERROR (exit ${code}) — see logs above for details ===`;
    notify(job, msg, 'log');          // keep subscribers alive for research phase
  })();
}

// ── SSE helper ────────────────────────────────────────────────────────────────

function makeSSEStream(job: InvestigationJob, voidName: string): ReadableStream {
  const enc = new TextEncoder();
  const sse  = (data: object) => enc.encode(`data: ${JSON.stringify(data)}\n\n`);

  return new ReadableStream({
    start(ctrl) {
      // Send job metadata
      ctrl.enqueue(sse({ type: 'info', voidName, voidId: job.voidId }));

      // Replay buffered logs
      for (const msg of job.logs) {
        ctrl.enqueue(sse({ type: 'log', message: msg }));
      }

      // Already finished?
      if (job.status !== 'running') {
        ctrl.enqueue(sse({ type: job.status }));
        try { ctrl.close(); } catch { }
        return;
      }

      // Subscribe to live updates
      const sub = (msg: string, type: string) => {
        try {
          ctrl.enqueue(sse(type === 'log' ? { type: 'log', message: msg } : { type }));
          if (type !== 'log') {
            job.subscribers.delete(sub);
            try { ctrl.close(); } catch { }
          }
        } catch {
          job.subscribers.delete(sub);
        }
      };
      job.subscribers.add(sub);
    },
    cancel() { /* client disconnected; subscriber cleaned up on next write */ },
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {

    "/api/health": () => Response.json({
      ok: true,
      service: "lakuna-visualizer",
      backend: process.env.LLM_BACKEND ?? "offline",
      time: new Date().toISOString(),
    }),

    "/public/umap_cv.parquet": async () => {
      const bytes = await Bun.file(resolve("public/umap_cv.parquet")).arrayBuffer();
      const table = readParquet(new Uint8Array(bytes));
      const arrowBytes = table.intoIPCStream();
      return new Response(arrowBytes, {
        headers: { "Content-Type": "application/vnd.apache.arrow.stream" },
      });
    },

    "/public/cluster_labels_cv.json": async () => {
      const file = Bun.file(resolve("public/cluster_labels_cv.json"));
      return new Response(file, { headers: { "Content-Type": "application/json" } });
    },

    "/public/voids_ranked_cv.json": async () => {
      const file = Bun.file(resolve("public/voids_ranked_cv.json"));
      return new Response(file, { headers: { "Content-Type": "application/json" } });
    },

    "/public/papers/:filename": async req => {
      const filename = decodeURIComponent(req.params.filename);
      if (filename.includes("/") || filename.includes("..") || !filename.endsWith(".pdf")) {
        return new Response("Invalid paper path", { status: 400 });
      }
      const file = Bun.file(resolve("public/papers", filename));
      if (!(await file.exists())) {
        return new Response("Paper not found", { status: 404 });
      }
      return new Response(file, { headers: { "Content-Type": "application/pdf" } });
    },

    // ── Investigation API ───────────────────────────────────────────────────

    "/api/investigate": {
      async POST(req) {
        let body: { voidId?: number; voidName?: string; papers?: unknown[] };
        try { body = await req.json(); }
        catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

        const { voidId, voidName, papers } = body;
        if (voidId === undefined || !voidName || !Array.isArray(papers)) {
          return Response.json({ error: 'Missing voidId, voidName, or papers' }, { status: 400 });
        }

        const jobId = makeJobId();
        console.log(`[investigate] Starting job ${jobId} for void ${voidId}: "${voidName}"`);

        // Fire and don't await — investigation runs in background
        spawnInvestigation(
          jobId, voidId, voidName,
          papers as Array<{ doi?: string; title: string; abstract?: string; year?: number }>,
        ).catch(err => console.error(`[investigate] spawn error:`, err));

        return Response.json({ jobId });
      },
    },

    "/api/investigate/:jobId/stream": async req => {
      const { jobId } = req.params;
      const job = activeJobs.get(jobId);
      if (!job) return new Response('Job not found', { status: 404 });

      const stream = makeSSEStream(job, job.voidName);
      return new Response(stream, {
        headers: {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection':    'keep-alive',
        },
      });
    },

    // Job stage/status (polled by the UI to show the Research button)
    "/api/investigate/:jobId/status": async req => {
      const job = activeJobs.get(req.params.jobId);
      if (!job) return new Response('Not found', { status: 404 });
      return Response.json({ stage: job.stage, status: job.status, outcome: job.outcome });
    },

    // Start the research phase (called when user clicks "Research")
    "/api/investigate/:jobId/start-research": {
      async POST(req) {
        const job = activeJobs.get(req.params.jobId);
        if (!job) return Response.json({ error: 'job not found' }, { status: 404 });
        if (job.stage === 'researching') return Response.json({ error: 'already researching' }, { status: 409 });
        if (job.stage === 'ingesting')   return Response.json({ error: 'still ingesting' }, { status: 409 });

        job.stage  = 'researching';
        job.status = 'running';

        const rootDir = resolve(import.meta.dir, '../..');
        const push    = makePusher(job);

        let researchPython: string;
        try {
          researchPython = resolveResearchPython(rootDir);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          job.status = 'error';
          job.stage = 'ready';
          job.outcome = 'dependency_error';
          notify(job, `=== RESEARCH DEPENDENCY ERROR — ${message} ===`, 'error');
          return Response.json({ error: message }, { status: 503 });
        }

        // ── Executable research-problem loop: diagnosis → plan → code → judge ─
        const researchProblem = resolveResearchProblem(job.voidName);
        {
          const problemDir = resolve(rootDir, researchProblem.problemDir);
          const logFile  = resolve(problemDir, 'logs/research_swarm_live.log');
          const sessionDir = resolve(
            problemDir,
            'logs',
            'visualizer_sessions',
            `${req.params.jobId}_${Date.now()}`,
          );
          job.sessionDir = sessionDir;
          const selectedPaperPaths = await stageSelectedPapers(job, sessionDir);
          const paperPaths = selectedPaperPaths.length > 0
            ? selectedPaperPaths
            : researchProblem.papers.map(p => resolve(rootDir, p));
          const reset = Bun.spawnSync({
            cmd: ['bash', 'reset_baseline.sh'],
            cwd: problemDir,
            stdout: 'pipe',
            stderr: 'pipe',
          });
          if (reset.exitCode !== 0) {
            push('[ERR] ', `Failed to reset research problem baseline before run.`);
          }

          const zeroExaArgs = /^(1|true|yes|on)$/i.test(process.env.ZERO_EXA_ENABLED ?? '')
            ? [
                '--zero-exa',
                '--zero-exa-max-results', process.env.ZERO_EXA_MAX_RESULTS ?? '4',
                '--zero-exa-max-pay', process.env.ZERO_EXA_MAX_PAY_USD ?? '0.02',
                '--zero-exa-timeout', process.env.ZERO_EXA_TIMEOUT_SECONDS ?? '60',
              ]
            : [];

          const proc = Bun.spawn({
            cmd: [
              researchPython, resolve(rootDir, 'run.py'), 'research', problemDir,
              '--problem', `${researchProblem.problem} Knowledge void: ${job.voidName}. Ground every proposal in the selected boundary papers.`,
              '--papers', ...paperPaths,
              '--run-command', researchProblem.runCommand.replace(/^python3\b/, researchPython),
              '--metrics-file', 'logs/latest_metrics.json',
              '--metric', researchProblem.metric,
              '--editable', 'model.py',
              '--iterations', process.env.RESEARCH_SWARM_ITERATIONS ?? '3',
              '--max-agents', String(Math.min(5, Math.max(1, paperPaths.length))),
              '--max-cross-ideas', '6',
              '--session-dir', sessionDir,
              '--log-file', logFile,
              ...zeroExaArgs,
            ],
            stdout: 'pipe', stderr: 'pipe', cwd: rootDir,
            env: researchEnv(),
          });

          const stdoutDone = drainStream(proc.stdout, '',     push);
          const stderrDone = drainStream(proc.stderr, '',     push);

          ;(async () => {
            const code = await proc.exited;
            await Promise.allSettled([stdoutDone, stderrDone]);

            // Ensure event polling can begin even if stdout parsing lags.
            job.sessionDir = sessionDir;

            try {
              const summary = await Bun.file(resolve(sessionDir, 'summary.json')).json() as { outcome?: string };
              job.outcome = summary.outcome;
            } catch {
              job.outcome = code === 0 ? 'finished' : 'error';
            }

            job.status = code === 0 ? 'done' : 'error';
            job.stage  = code === 0 ? 'complete' : 'ready';
            const final = code === 0
              ? '=== RESEARCH COMPLETE ==='
              : `=== RESEARCH ERROR (exit ${code}) — scroll up for details ===`;
            notify(job, final, job.status);
          })();

          return Response.json({ ok: true });
        }
      },
    },

    // Research events from the session's events.jsonl (polled by DeepResearchTab)
    "/api/investigate/:jobId/research-events": async req => {
      const job = activeJobs.get(req.params.jobId);
      if (!job) return new Response('Job not found', { status: 404 });
      if (!job.sessionDir) return Response.json([]);

      const eventsFile = Bun.file(`${job.sessionDir}/events.jsonl`);
      if (!(await eventsFile.exists())) return Response.json([]);

      const text = await eventsFile.text();
      const events = text.trim().split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      return Response.json(events);
    },

    // Current metrics from the research problem's metrics file
    "/api/investigate/:jobId/latest-metrics": async req => {
      const job = activeJobs.get(req.params.jobId);
      if (!job) return new Response('Job not found', { status: 404 });
      if (!job.sessionDir) return Response.json(null);

      // Try imagenet problem dir first, then investigations dir
      const rootDir = resolve(import.meta.dir, '../..');
      const candidates = [
        `${rootDir}/research_problems/mnist_fcnn/logs/latest_metrics.json`,
        `${rootDir}/research_problems/imagenet_cnn/logs/latest_metrics.json`,
        `${rootDir}/outputs/investigations/void_${job.voidId}/logs/latest_metrics.json`,
      ];
      for (const p of candidates) {
        const f = Bun.file(p);
        if (await f.exists()) {
          return new Response(f, { headers: { 'Content-Type': 'application/json' } });
        }
      }
      return Response.json(null);
    },

    // Single-paper codegen triggered from the Deep Research tab
    "/api/paper2code": {
      async POST(req) {
        let body: { doi?: string; title?: string };
        try { body = await req.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
        const { doi, title } = body;
        if (!doi || !title) return Response.json({ error: 'doi and title required' }, { status: 400 });

        const jobId = makeJobId();
        const cgJob: CodegenJob = { logs: [], status: 'running', doi };
        codegenJobs.set(jobId, cgJob);

        const rootDir = resolve(import.meta.dir, '../..');
        const gx10Url = process.env.LOCAL_LLM_URL ?? '';
        const proc = Bun.spawn({
          cmd: [
            'python3', resolve(rootDir, 'run_paper2code_single.py'),
            '--doi', doi, '--title', title, '--gx10-url', gx10Url,
          ],
          stdout: 'pipe', stderr: 'pipe', cwd: rootDir,
          env: researchEnv({
            LLM_BACKEND: gx10Url ? 'gx10' : 'offline',
            LOCAL_LLM_URL: gx10Url,
          }),
        });

        (async () => {
          const dec = new TextDecoder(); let buf = '';
          for await (const chunk of proc.stdout) {
            buf += dec.decode(chunk, { stream: true });
            const parts = buf.split('\n'); buf = parts.pop() ?? '';
            for (const l of parts) if (l.trim()) cgJob.logs.push(l);
          }
          if (buf.trim()) cgJob.logs.push(buf);
        })().catch(() => {});
        (async () => {
          const dec = new TextDecoder(); let buf = '';
          for await (const chunk of proc.stderr) {
            buf += dec.decode(chunk, { stream: true });
            const parts = buf.split('\n'); buf = parts.pop() ?? '';
            for (const l of parts) if (l.trim()) cgJob.logs.push(`[ERR] ${l}`);
          }
        })().catch(() => {});
        proc.exited.then(code => { cgJob.status = code === 0 ? 'done' : 'error'; });

        return Response.json({ jobId });
      },
    },

    // Poll codegen job status
    "/api/paper2code/:jobId": async req => {
      const cj = codegenJobs.get(req.params.jobId);
      if (!cj) return new Response('Not found', { status: 404 });
      return Response.json({ status: cj.status, logs: cj.logs.slice(-20) });
    },

    "/api/investigate/jobs": async () => {
      const jobs = Array.from(activeJobs.entries()).map(([id, j]) => ({
        jobId:    id,
        voidId:   j.voidId,
        voidName: j.voidName,
        status:   j.status,
        logLines: j.logs.length,
      }));
      return Response.json(jobs);
    },

    // ── Fallthrough SPA ─────────────────────────────────────────────────────
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr:     true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
