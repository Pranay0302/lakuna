# Nexla source + sink ingestion — Design

**Date:** 2026-07-17
**Status:** Approved for planning
**Component:** `ingestion/` (new `ingestion/nexla/` module) + `run.py` (`nexla` subcommand group)

## 1. Purpose

Add Nexla data-integration capabilities to the paper-ingestion pipeline so papers can be
**pulled from a remote Nexla source** and cleaned JSON can be **published to a Nexla sink**,
wrapping — not replacing — the existing Grobid pipeline.

Nexla is a data-transport / integration platform (sources → nexsets → sinks, connected by
flows, 700+ connectors). It does **not** parse PDFs into structured text; that remains
Grobid's job. Nexla is therefore the transport layer around the existing pipeline.

## 2. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Nexla role | **Both** — source (pull PDFs in) **and** sink (publish cleaned JSON out) |
| Live access | Service key provided; build **live-capable** with **graceful degradation** when binary/token/URL absent |
| Command surface | New **`nexla` subcommand group** in `run.py` (mirrors nexla-cli verb style) |
| Integration mechanism | **Shell out to the real `nexla-cli`** binary via subprocess (`--output json`, stable exit codes) |
| Instance URL | express.dev endpoint: `https://dev-api-express-code.nexla.com/` |
| Dry-run | **Default ON** for mutating commands; `--live` / `--no-dry-run` to execute |
| Local fallback | Keep a labeled `--local-dir` stand-in source so the flow is demonstrable without Nexla |

Credentials live in `.env` (gitignored): `NEXLA_SERVICE_KEY`, `NEXLA_API_URL`, optional
`NEXLA_MONITORING_URL`. The service key is exchanged for a session token via
`nexla-cli login --service-key "$NEXLA_SERVICE_KEY"`.

## 3. Command surface (`run.py nexla ...`)

| Command | Behaviour |
|---|---|
| `run.py nexla ingest <source_id> <sink_id>` | Full flow: pull PDFs from source → run Grobid pipeline per PDF → push each cleaned JSON to sink |
| `run.py nexla pull <source_id> [-o papers/]` | Fetch source files into a local dir |
| `run.py nexla pull --local-dir <path> [-o papers/]` | Local stand-in "source" (no Nexla account needed) |
| `run.py nexla push <cleaned.json> <sink_id>` | Publish one cleaned JSON to a sink |
| `run.py nexla status` | Diagnostics: resolved env, binary presence, auth reachability |

Global flags on all mutating commands: `--dry-run` (default **on**) / `--live`
(alias `--no-dry-run`), and `--json` for machine-readable output.

## 4. Module architecture (`ingestion/nexla/`)

Small, single-purpose units. Each has one clear responsibility, a defined interface, and is
independently testable.

- **`config.py`** — resolves `NEXLA_API_URL`, `NEXLA_SERVICE_KEY`/`NEXLA_TOKEN`, optional
  `NEXLA_MONITORING_URL` from env/`.env`. Single place that validates presence and returns
  friendly guidance. Depends on: `os.environ` only.
- **`errors.py`** — typed exceptions mapped from nexla-cli's documented exit codes:
  `NexlaError` (base, exit 1), `NexlaInputError` (2), `NexlaConfigError` (3),
  `NexlaAuthError` (4), `NexlaNotFoundError` (5), `NexlaUpstreamError` (6),
  `NexlaCliNotInstalled` (binary missing → install hint). Each carries the exit code so the
  CLI layer can re-emit it.
- **`client.py` — `NexlaClient`** — the **only** unit that shells out to `nexla-cli`.
  - `run(args: list[str], *, dry_run: bool) -> dict|list|None`: locates the binary
    (`shutil.which`), ensures a session token (login with service key if needed), injects
    `--output json` and `--dry-run` when applicable, executes via an **injectable runner
    seam**, maps exit codes → typed exceptions, parses JSON stdout.
  - Convenience methods used by the pipeline only: `login()`, `source_get(id)`,
    `source_activate(id)`, `flow_status(id)`, `sink_get(id)`, `sink_create(...)`,
    `sink_activate(id)`, `nexset_get(id)`.
  - Depends on: `config`, `errors`, subprocess (behind the seam).
- **`pipeline.py`** — orchestration functions `pull()`, `push()`, `ingest()`. Pure
  orchestration over a `NexlaClient` (interface) + the existing `ingest_pdf.sh` for the
  Grobid step. Knows nothing about argparse or subprocess details.
- **`cli.py`** — argparse wiring for the `nexla` group. `run.py` gains a thin `cmd_nexla`
  that delegates here, matching how `discuss` delegates to `agentswarm.cli`.

## 5. Data flow

```
pull(source_id):
    client.source_activate(source_id)      # trigger ingestion (skipped on --dry-run)
    poll client.flow_status(...) until done
    download file payloads  → papers/*.pdf  # isolated download step
    (or, --local-dir: copy local *.pdf → papers/)

ingest(source_id, sink_id):
    pdfs = pull(source_id)
    for pdf in pdfs:
        bash ingestion/scripts/ingest_pdf.sh <pdf>   # existing Grobid → cleaned JSON
        push(cleaned_json, sink_id)

push(cleaned_json, sink_id):
    client.sink_get(sink_id) or sink_create(...)
    send records from cleaned_json           # isolated upload step
    client.sink_activate(sink_id)
```

**Live-validation note:** the `download file payloads` and `send records` steps depend on
Nexla's exact file-transfer wire semantics, which cannot be verified without exercising a
live instance. They are built as clearly-isolated functions against the documented CLI
commands and **default to `--dry-run`**, so they can be validated against the real instance
and adjusted without touching the rest of the code. Command construction, exit-code
handling, and orchestration sequencing are fully testable now.

## 6. Error handling & graceful degradation

- Missing `nexla-cli` binary → `NexlaCliNotInstalled` with `pip install nexla-cli` hint (exit 3).
- Missing token/URL → `NexlaConfigError` pointing at `nexla-cli login --service-key ...` (exit 3).
- nexla-cli non-zero exit → mapped exception; `cmd_nexla` prints a friendly message and
  **returns the same exit code** so scripts/agents can branch on it.
- `nexla status` never raises — it reports what is / isn't available.

## 7. Configuration

Documented in `.env`, `README.md`, and `DOCUMENTATION.md`:

| Variable | Purpose |
|---|---|
| `NEXLA_SERVICE_KEY` | Service key, exchanged for a token via `nexla-cli login` |
| `NEXLA_API_URL` | Instance URL (default express.dev endpoint) |
| `NEXLA_MONITORING_URL` | Optional monitoring endpoint |

`requirements.txt`: `nexla-cli` noted as an **optional** extra (installed separately;
the existing local pipeline does not require it).

## 8. Testing (TDD)

No live Nexla, Docker, or Grobid required for the suite.

- **`NexlaClient`**: inject a fake runner → assert command construction, `--dry-run`
  injection, exit-code → exception mapping, JSON parsing, binary-missing handling.
- **`pipeline`**: fake `NexlaClient` + mocked Grobid step → assert pull → Grobid → push
  sequencing and per-PDF invocation; assert `--dry-run` short-circuits mutations.
- **`config`**: missing/partial env → correct typed errors and messages.
- **`--local-dir`**: local folder of PDFs flows through `ingest` end-to-end with a fake client.

## 9. Out of scope (YAGNI)

- Wrapping the full 700+ connector catalog.
- Nexla MCP toolset/gateway and `nexla-cli skill install`.
- Non-PDF data types / arbitrary nexset transforms.
- Replacing or modifying Grobid parsing.

## 10. Files touched

New:
- `ingestion/nexla/__init__.py`
- `ingestion/nexla/config.py`
- `ingestion/nexla/errors.py`
- `ingestion/nexla/client.py`
- `ingestion/nexla/pipeline.py`
- `ingestion/nexla/cli.py`
- `tests/nexla/` (client, pipeline, config tests)

Modified:
- `run.py` — add `nexla` subparser + `cmd_nexla` dispatch
- `.env` — Nexla vars (done)
- `README.md`, `DOCUMENTATION.md` — Nexla ingestion docs
- `requirements.txt` — optional `nexla-cli` note
