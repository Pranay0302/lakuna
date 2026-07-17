# Lakuna

A unified research-paper pipeline: **ingest PDFs → discuss papers with an AI agent
swarm → autonomously improve models → generate runnable code repos**, with a WebGL
visualizer for the arXiv atlas.

```
PDF
 └─[ingest]→  cleaned JSON
                 ├─[discuss]→   expert Q&A (agent swarm)
                 ├─[research]→  autonomous model-improvement loop
                 └─[codegen]→   generated code repository
```

---

## Built with Zero.xyz, Nexla & Akash

Lakuna is wired into three external platforms. Each one owns a distinct layer of
the pipeline — evidence, data transport, and hosting.

### 🔎 Zero.xyz — paid live web evidence for the research loop

**Where:** `agentswarm/zero_exa.py`, used by `run.py research` and the visualizer.

Instead of calling Exa directly, Lakuna purchases **Exa semantic web search through
the [Zero](https://www.zero.xyz/) capability marketplace**. Each research iteration
runs the full Zero lifecycle through the official `@zeroxyz/cli` runner:

1. `zero search` — discover the current Exa search capability (re-discovered before
   every call, since the marketplace changes).
2. `zero get <capability>` — inspect its live endpoint and request schema.
3. `zero fetch --capability <ref> --max-pay <cap>` — make **one metered, spend-capped
   paid call** and get evidence back.
4. `zero review <runId>` — rate the run for accuracy / value / reliability.

The returned evidence is shared across every selected paper expert, so a single paid
search grounds the whole panel. It is **strictly opt-in** — nothing is discovered,
called, or charged unless you pass `--zero-exa` (CLI) or set `ZERO_EXA_ENABLED=true`
(visualizer). Every call is bounded by a hard per-call spend cap
(`--zero-exa-max-pay`, default **$0.02**), and local paper retrieval remains the
fallback whenever Zero is unavailable. The CLI is baked into the Docker image but
stays dormant by default.

### 🔗 Nexla — source/sink data transport for ingestion

**Where:** `ingestion/nexla/` and `ingestion/arxiv_atlas.py`, exposed as `run.py nexla`.

Nexla is Lakuna's **data integration layer**. A thin, fully-tested wrapper around
`nexla-cli` lets the pipeline pull PDFs *from* Nexla sources and push cleaned JSON
*to* Nexla sinks, while the existing Grobid + doc2json flow still does the actual
parsing:

- `nexla pull <source_id>` — pull PDFs from a Nexla File-Upload source.
- `nexla push <json> <sink_id>` — push a cleaned JSON to a Nexla destination.
- `nexla ingest <source_id> <sink_id>` — end-to-end source → parse → sink.
- `nexla arxiv-atlas` — fetch **live arXiv metadata**, write compact JSONL batches
  under `data/nexla/arxiv_atlas/`, and optionally push them to a Nexla destination —
  atlas-scale ingestion without bulk-downloading every PDF.

Mutating Nexla commands default to **dry-run**; pass `--live` to activate real
sources/sinks. (`--local-dir` is a local-only testing fallback and does not upload to
the Nexla dashboard.)

### ☁️ Akash — decentralized hosting for the visualizer

**Where:** `deploy.yaml` (SDL manifest), `deploy.local.yaml`, `Dockerfile`.

The Lakuna visualizer — a Bun + React + WebGL app that renders the arXiv atlas — is
packaged into a Docker image (`elc0c0/lakuna-visualizer:latest`) and deployed to the
**[Akash Network](https://akash.network/)** decentralized cloud via a standard SDL
manifest:

- The `web` service exposes container port `3000` as global port `80`.
- Compute profile: **1 vCPU / 4Gi RAM / 15Gi storage**, bid-priced in `uAKT` on the
  `dcloud` datacenter placement.
- It runs **offline-safe by default** (`LLM_BACKEND=offline`, `ZERO_EXA_ENABLED=false`),
  so a public deployment costs nothing beyond compute.

Secrets are deliberately **kept out of the committed `deploy.yaml`**;
`deploy.local.yaml` is the untracked variant used to inject live LLM backends
(Anthropic / OpenRouter) and a Zero session for real research runs.

Deploy with the Akash CLI or Console:

```bash
# build & push the visualizer image, then:
provider-services tx deployment create deploy.yaml --from <key>
# ...accept a bid, then create the lease and send the manifest.
```

---

## Directory layout

```
lakuna/
├── run.py                  # Master CLI (ingest / discuss / brainstorm / research / codegen / nexla)
├── Makefile                # Shorthand commands
├── requirements.txt        # Combined Python dependencies
│
├── deploy.yaml             # Akash SDL manifest (visualizer)
├── deploy.local.yaml       # Untracked-secrets Akash variant for live LLM runs
├── Dockerfile              # Builds the elc0c0/lakuna-visualizer image
│
├── papers/                 # Input PDFs (4 pre-loaded test papers)
│
├── data/
│   ├── raw_json/           # Raw S2ORC JSON output from Grobid
│   ├── cleaned_json/       # Cleaned JSONs consumed by discuss + codegen
│   │   └── BERT_cleaned.json   # Pre-processed BERT (ready to use immediately)
│   └── nexla/arxiv_atlas/  # JSONL metadata batches from `nexla arxiv-atlas`
│
├── outputs/                # Generated code repos land here
│
├── ingestion/              # PDF → S2ORC JSON (s2orc-doc2json)
│   ├── doc2json/           # Core conversion library
│   ├── nexla/              # Nexla source/sink transport (client, cli, config, pipeline)
│   ├── arxiv_atlas.py      # arXiv metadata → Nexla-friendly JSONL
│   └── scripts/            # setup_grobid.sh, ingest_pdf.sh
│
├── paper2code/             # JSON → code generation pipeline
│
├── agentswarm/             # Expert agent Q&A over papers
│   ├── cli.py, orchestrator.py, expert.py
│   ├── retriever.py, blackboard.py, llm.py, paper_loader.py
│   └── zero_exa.py         # Zero.xyz Exa live-search integration
│
└── visualizer/             # Bun + React + WebGL arXiv-atlas viewer (deployed to Akash)
```

---

## Quick start

### 1. Install dependencies

```bash
pip install -r requirements.txt
pip install -e ingestion/        # installs doc2json package
# Optional, only for Nexla source/sink transport:
pip install nexla-cli
```

### 2. Set API key(s)

```bash
export OPENROUTER_API_KEY="sk-or-..."   # required for discuss + codegen
# OR for OpenAI directly:
export OPENAI_API_KEY="sk-..."
```

### 3. Discuss a paper (no ingestion needed — BERT is pre-loaded)

```bash
python run.py discuss "What is masked language modeling?"
```

Or with Make:
```bash
make discuss QUESTION="What is masked language modeling?"
```

### 4. Ingest a new PDF

Requires Docker. Pull the image once:
```bash
make setup-grobid
# or: sudo docker pull grobid/grobid:0.9.0-crf
```

Start Grobid in a separate terminal (keep it running while ingesting):
```bash
make start-grobid
# or: sudo docker run --rm --init --ulimit core=0 -p 8070:8070 grobid/grobid:0.9.0-crf
```

Then ingest any PDF:
```bash
python run.py ingest papers/bert.pdf
# or
make ingest PAPER=bert
```

Outputs:
- `data/raw_json/bert.json`
- `data/cleaned_json/bert_cleaned.json`

### 5. Generate a code repo from a paper

```bash
python run.py codegen data/cleaned_json/bert_cleaned.json
# or
make codegen JSON=data/cleaned_json/bert_cleaned.json
```

With a local vLLM backend instead of OpenRouter:
```bash
python run.py codegen data/cleaned_json/bert_cleaned.json --local
make codegen-local JSON=data/cleaned_json/bert_cleaned.json
```

Generated repo lands in `outputs/<paper_name>_repo/`.

### 6. Autonomous research loop (with optional Zero live evidence)

The `research` command runs an autoresearch-style agent swarm that iteratively edits
and re-scores a model. Add live Exa evidence through Zero by opting in explicitly —
no Zero call or payment occurs without `--zero-exa`:

```bash
# Install and authenticate the official Zero runner once:
npm install -g @zeroxyz/cli
zero auth login
zero auth whoami

python3 run.py research research_problems/mnist_fcnn \
  --run-command "python3 train.py --metrics-out logs/latest_metrics.json" \
  --zero-exa \
  --zero-exa-max-results 4 \
  --zero-exa-max-pay 0.02
```

The visualizer uses the same integration when `ZERO_EXA_ENABLED=true`. Optional
controls: `ZERO_EXA_MAX_RESULTS`, `ZERO_EXA_MAX_PAY_USD`, `ZERO_EXA_TIMEOUT_SECONDS`.
Keep `ZERO_SESSION_TOKEN` and all other credentials out of `deploy.yaml` and source
control; inject them only through your runtime's secret/environment configuration.

---

## Command reference

### `python run.py ingest <PDF> [-o OUTPUT_DIR]`

Converts a PDF to a cleaned JSON file ready for `discuss` or `codegen`.

| Arg | Description |
|-----|-------------|
| `pdf` | Path to input PDF |
| `-o / --output` | Output dir (default: `data/cleaned_json/`) |

### `python run.py nexla <COMMAND>`

Wraps the Grobid ingestion pipeline with Nexla transport. Mutating Nexla commands
default to dry-run; pass `--live` to activate sources/sinks for real.

```bash
python run.py nexla status --json
python run.py nexla pull <source_id> -o papers/
python run.py nexla pull --local-dir ./incoming_pdfs -o papers/
python run.py nexla push data/cleaned_json/attention_is_all_you_need_cleaned.json <sink_id>
python run.py nexla ingest <source_id> <sink_id>
python run.py nexla ingest <sink_id> --local-dir ./incoming_pdfs
python run.py nexla arxiv-atlas --max-results 500 --batch-size 100 --sink-id <sink_id>
```

Nexla is the source/sink transport layer only; PDFs are still parsed by the existing
Grobid + doc2json flow. `--local-dir` is a local-only dry-run/testing fallback; it does
not upload PDFs into the Nexla dashboard. To make PDFs appear in Nexla, upload them to
a Nexla File Upload source in the UI, then run `python run.py nexla ingest <source_id>
<sink_id> --live` with the source and destination IDs from Nexla.

For atlas-scale arXiv ingestion, prefer `nexla arxiv-atlas`. It fetches current arXiv
metadata, writes compact JSONL batches under `data/nexla/arxiv_atlas/`, and optionally
pushes those batches to a Nexla destination — storing paper metadata and PDF URLs in
Nexla efficiently without bulk-downloading every PDF.

### `python run.py discuss "<QUESTION>" [--papers FILE ...]`

Runs a moderated panel of LLM paper-expert agents that answer questions grounded in
evidence from the papers.

| Arg | Description |
|-----|-------------|
| `question` | The question to ask |
| `--papers` | One or more `*_cleaned.json` files (default: BERT) |
| `--max-agents` | Max experts per question (default: 5) |
| `--top-k` | Evidence chunks per expert (default: 4) |
| `--critique-rounds` | Rounds of cross-critique (default: 1) |
| `--model` | OpenRouter model override |

### `python run.py research <PROBLEM_DIR> [--zero-exa ...]`

Autoresearch-style loop that improves a model in a problem folder, optionally pulling
live web evidence through Zero. See "Autonomous research loop" above.

### `python run.py codegen <CLEANED_JSON> [--name NAME] [--model MODEL] [--local]`

Runs the full paper→code generation pipeline: planning → analysis → coding.

| Arg | Description |
|-----|-------------|
| `cleaned_json` | Path to `*_cleaned.json` |
| `--name` | Output name (default: JSON stem) |
| `--model` | Model ID override |
| `--local` | Use local vLLM backend (DeepSeek-Coder) |

---

## How each component works

### ingestion (s2orc-doc2json)
Sends the PDF to a **Grobid** server running in Docker (`grobid/grobid:0.9.0-crf`,
port 8070), which parses it into TEI-XML. The `doc2json` library converts TEI-XML into
a structured **S2ORC JSON** with body text, sections, citations, figures, and
equations. `0_pdf_process.py` strips noisy metadata to produce a **cleaned JSON** for
downstream use. **Nexla** optionally moves those PDFs and JSONs in and out.

### agentswarm
Each `*_cleaned.json` becomes one **PaperExpertAgent**. When you ask a question:
1. Agents score relevance to the question (BM25 keyword matching).
2. Selected agents retrieve top-k evidence chunks and compose answers grounded only in
   their paper — plus, when enabled, live **Zero/Exa** web evidence.
3. Agents critique each other's claims.
4. An orchestrator synthesizes a final answer with consensus points, disagreements,
   and citations.

### paper2code
A four-stage LLM pipeline:
1. **Planning** — LLM reads the paper and generates an overview, software design, and
   task list.
2. **Config extraction** — hyperparameters are pulled into `config.yaml`.
3. **Analysis** — each file in the task list gets detailed logic specs.
4. **Coding** — LLM generates each file with full context from prior files and specs.

### visualizer
A Bun + React + WebGL app that renders the arXiv atlas from parquet/Arrow data and
optionally drives the research backend. It is the artifact **deployed to Akash**.

---

## Environment variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | discuss, codegen, research | OpenRouter API key |
| `OPENAI_API_KEY` | codegen (OpenAI path) | OpenAI API key |
| `GROBID_DIR` | ingest | Grobid install path (default: `~/grobid-0.7.3`) |
| `NEXLA_API_URL` | nexla | Nexla API URL |
| `NEXLA_SERVICE_KEY` | nexla | Service key used by `nexla-cli login` |
| `NEXLA_TOKEN` | nexla | Optional pre-existing Nexla session token |
| `NEXLA_MONITORING_URL` | nexla | Optional Nexla monitoring endpoint |
| `ZERO_EXA_ENABLED` | research, visualizer | Set `true` to enable paid Zero/Exa search |
| `ZERO_EXA_MAX_RESULTS` | research, visualizer | Max Exa results per call |
| `ZERO_EXA_MAX_PAY_USD` | research, visualizer | Hard per-call spend cap (default `0.02`) |
| `ZERO_EXA_TIMEOUT_SECONDS` | research, visualizer | Per-call timeout |
| `ZERO_SESSION_TOKEN` | research, visualizer | Zero session (inject at runtime, never commit) |
| `LLM_BACKEND` | visualizer | `offline` (default), `anthropic`, or `openrouter` |
