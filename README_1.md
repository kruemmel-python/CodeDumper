# CodeDumper

**Enterprise-grade local code dump generator for LLM-assisted code review, audits, architecture analysis, and secure repository handoff.**

CodeDumper converts project ZIP archives into structured, LLM-ready Markdown, XML, or JSON dumps. It is designed for developers, security teams, consultants, and engineering organizations that need precise control over what code is shared with humans or large language models.

The application runs locally in the browser or as a hardened Electron desktop app. No LLM call is made during dump generation. Token counts and costs are offline estimates only.

---

## Why CodeDumper exists

Large language models are useful for code review, migration planning, refactoring, security analysis, and architecture understanding. However, sending an entire repository directly to an LLM is usually inefficient and risky.

Typical problems include:

- oversized prompts that exceed context windows
- accidental inclusion of `node_modules`, build output, lockfiles, reports, generated assets, or datasets
- leakage of `.env` files, API keys, tokens, SSH keys, or cloud credentials
- prompt-injection content hidden in comments, documentation, or third-party code
- poor file ordering that makes the repository harder for an LLM to understand
- browser freezes while processing large ZIP files
- unsafe ZIP handling, including path traversal and decompression-bomb risks

CodeDumper solves these problems by producing curated, filtered, token-aware, security-scanned code dumps.

---

## Core capabilities

### LLM Code Review Mode

The default enterprise workflow is **LLM Code Review Mode**. It is language-agnostic and optimized for repositories of many technology stacks, not only React or JavaScript.

It prioritizes:

- source code
- tests
- manifests
- runtime and build configuration
- architecture documentation
- security boundaries
- framework entry points

It automatically removes or deprioritizes:

- dependency directories
- lockfiles
- build artifacts
- release packages
- reports
- generated data
- vendored code
- minified bundles
- sourcemaps
- logs
- binaries
- local secret files

Supported ecosystems include, among others:

- JavaScript / TypeScript / React / Vue / Svelte / Astro / Node.js
- Python / FastAPI / Django / Flask / Streamlit
- Rust
- Go
- Java / Kotlin / Scala
- .NET / C#
- C / C++
- Swift
- PHP
- Ruby
- Dart
- Elixir / Erlang
- Clojure
- Haskell / OCaml

---

## Feature overview

### Local ZIP inspection

CodeDumper inspects uploaded ZIP archives locally. It reads the archive structure, builds a file tree, applies safety limits, and lets the user select or exclude files before generating a dump.

### Interactive file tree

A visual tree selector provides fine-grained control over included and excluded files. Directory selections cascade to children, allowing fast cleanup of large repositories.

### Native ignore-file support

CodeDumper automatically detects and applies ignore rules from:

- `.gitignore`
- `.dockerignore`

Negated ignore rules using `!pattern` are supported.

### Smart stack detection

The scanner detects common project types from repository files and applies appropriate filtering logic. Examples:

- `package.json` + Vite config → Node / Vite / frontend project
- `pyproject.toml` or `requirements.txt` → Python project
- `Cargo.toml` → Rust crate
- `pom.xml` → Java / Maven project
- `.csproj` or `.sln` → .NET project

### Repository map generation

Generated dumps include a repository map at the top. This gives humans and LLMs an immediate overview of the included project structure before the file contents begin.


### Local LLM Panel for LM Studio, Ollama and OpenAI-compatible local servers

The web UI includes a visible **Local LLM Panel** in the output area after a dump has been generated.

Typical LM Studio workflow:

1. Start LM Studio.
2. Load and start a local model.
3. Enable the local server in LM Studio.
4. In CodeDumper, open the **Local LLM Panel**.
5. Select **OpenAI-compatible / LM Studio**.
6. Set the API endpoint to:

```text
http://localhost:1234/v1/chat/completions
```

7. Click **Load models** or enter the running model name manually.
8. Review or customize the system prompt and review prompt.
9. Click **Send dump to Local LLM**.

For Ollama, use one of these endpoints:

```text
http://localhost:11434/api/chat
http://localhost:11434/api/generate
```

The panel supports streaming responses and keeps the workflow local as long as the configured endpoint points to `localhost`, `127.0.0.1`, or another trusted internal server.

### Token counting and cost estimation

CodeDumper estimates token usage and optional API cost before export.

The UI explicitly states that no LLM/API call was made. Token and cost values are offline estimates intended for planning context-window and API-budget usage.

### Multiple export formats

Supported output formats:

- Markdown
- XML
- JSON

Markdown is suitable for general LLM workflows. XML and JSON are useful for structured prompting pipelines and automated processing.

### Chunked export

Large repositories can be split into multiple output parts using a configurable token limit per file. This helps fit dumps into smaller context windows.

### Semantic chunking

Instead of splitting files purely linearly, CodeDumper can group related files together. It prefers keeping files from the same directory, matching base names, and test/spec companions in the same chunk where possible.

Example:

```text
Button.tsx
Button.test.tsx
Button.css
```

are more likely to stay together in the same export part.

### Diff / Review Focus Mode

For pull-request-style workflows, CodeDumper can focus the dump on changed files and nearby companions.

Users may provide:

- a comma-separated list of changed paths
- newline-separated changed paths
- unified diff headers
- uploaded `.diff` or `.patch` files

The dump is then narrowed to the most relevant review files plus related tests or companions.

### Code condensation

Optional code condensation reduces token footprint by removing low-value whitespace and comments. This is useful when repository size is more important than preserving every comment.

Because comments can contain architectural or security context, this feature is optional.

### Syntax-aware condensation and skeleton mode

CodeDumper includes a safer condensation path that avoids destructive regex-based comment stripping for supported workflows. It can preserve code structure while reducing prompt size.

The optional skeleton mode extracts compact structural context such as:

- classes
- functions
- exported symbols
- interfaces and types
- route or module boundaries where detectable

This is useful when a model needs architectural context without every implementation detail.

### Token and file explorer

The output view includes a token/file explorer that helps identify which folders or files dominate the generated context.

This makes it easier to remove accidental high-token areas such as:

- fixtures
- generated assets
- large JSON files
- reports
- vendored code
- test snapshots

Large token contributors can be excluded directly from the explorer workflow.

### Virtualized preview

Large generated dumps are previewed with a virtualized read-only output view to avoid UI freezes caused by very large textareas.

### Web Worker processing

ZIP processing, decoding, filtering, scanning, token counting, and dump assembly run inside a Web Worker. The React UI remains responsive and the job can be cancelled.

### Push to Local LLM

CodeDumper can optionally send the generated dump to a local LLM-compatible endpoint such as Ollama or LM Studio.

This keeps the workflow local-first while removing the need to copy very large Markdown blocks manually.

Typical local endpoints include:

```text
http://localhost:11434
http://127.0.0.1:1234
```

This feature is explicitly intended for local/private model workflows. It is separate from the default dump generation flow, which still performs no LLM/API call.

### LM Studio browser compatibility

When the Web UI talks to LM Studio from `http://localhost:3000`, the browser may perform a CORS preflight for JSON `POST` requests. PowerShell or curl can succeed while the browser fails because they do not enforce CORS.

CodeDumper therefore tries two transports for OpenAI-compatible LM Studio endpoints:

1. standard `application/json` streaming request
2. no-preflight `text/plain;charset=UTF-8` JSON request for LM Studio/browser compatibility

Use the LM Studio base URL, for example:

```text
http://192.168.178.62:1234
```

CodeDumper resolves it internally to:

```text
http://192.168.178.62:1234/v1/chat/completions
```

Keep **CORS aktivieren** and **Im lokalen Netzwerk bereitstellen** enabled in LM Studio, then restart the local server.

### Custom enterprise rules

Organizations can define custom security and prompt-injection rules as JSON. This allows teams to detect internal credential formats, proprietary token prefixes, or organization-specific LLM manipulation patterns.

Example rule use cases:

- `CORP_API_TKN_*`
- internal bearer-token formats
- customer-specific environment variable names
- prohibited prompt-injection phrases
- compliance-specific redaction markers

---

## Security features

CodeDumper is built for workflows where the output may later be shared with an LLM, reviewer, vendor, or customer. Security checks are therefore part of the core pipeline.

### No API key leakage

The frontend does not embed server-side API keys. There is no static injection of environment secrets into the browser bundle.

### No LLM call during generation

CodeDumper does not send project contents to OpenAI, Anthropic, Google, or any other model provider during dump creation. All processing is local.

### Secret and credential scanning

CodeDumper scans decoded text for common sensitive values and redacts them before export.

Detection includes:

- AWS access keys
- OpenAI-style keys
- GitHub tokens
- Google API keys
- private key blocks
- bearer tokens
- generic secret assignments
- high-entropy token-like strings

Redactions are reported in the UI warning panel.

### Shannon-entropy detection

In addition to fixed regex rules, CodeDumper can flag high-entropy Base64-, hex-, and token-like strings. This helps catch custom credentials and organization-specific secrets that do not match standard patterns.

### Prompt-injection detection

CodeDumper scans files for common indirect prompt-injection phrases, such as attempts to override system instructions or manipulate downstream LLM behavior.

Possible actions:

- warn
- redact
- skip affected file

This is useful when analyzing third-party repositories or untrusted ZIP archives.

### Zip Slip protection

Archive paths are normalized and sanitized before they are displayed or exported. Absolute paths, traversal segments, and unsafe path forms are removed or rejected.

### ZIP bomb and decompression protection

CodeDumper applies layered protections:

- archive-level size limits
- per-file size limits
- file-count limits
- path-length limits
- compression-ratio checks
- guarded extraction
- running byte counters
- Worker watchdog termination

Selected extraction paths use guarded streaming via `fflate` to reduce memory-exhaustion risk compared with buffering entire files blindly.

### Glob ReDoS protection

User-provided include and exclude patterns are validated and bounded to reduce regular-expression denial-of-service risks caused by pathological glob patterns.

### Hardened Electron configuration

The Electron build is configured with a hardened browser environment:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- denied permission requests
- navigation restrictions
- external window restrictions
- Content Security Policy headers

### ReDoS hardening

CodeDumper validates custom glob and regex-like rule inputs, applies scan limits, and avoids unbounded high-risk text scans where possible. Long lines and minified files are constrained before sensitive pattern matching is performed.

### Encoding and obfuscation hardening

Before prompt-injection and secret checks, text can be normalized using Unicode NFKC. This reduces bypasses based on unusual Unicode forms.

The scanner also performs heuristic checks for suspicious Base64-encoded strings and scans decoded candidates for secrets or prompt-injection phrases.

### Symlink and nested-archive protection

ZIP symlink entries are dropped to avoid unsafe path semantics in browser, desktop, and CLI workflows.

Nested ZIP-like files are detected through magic bytes and treated as non-recursive archive payloads. CodeDumper does not recursively unpack archive-in-archive content by default.

---

## Architecture

CodeDumper is structured around a browser-first React frontend and a processing core that can be reused by desktop and CLI workflows.

```text
.
├── src/
│   ├── components/          # UI components
│   ├── services/            # ZIP processing, filtering, tokenization, scanning
│   ├── workers/             # Web Worker entry points
│   └── App.tsx              # Main application shell
├── electron/                # Hardened Electron main/preload code
├── cli/                     # Headless CLI entry point
├── .github/actions/         # GitHub Action definition
├── .github/workflows/       # CI example workflow
├── package.json
├── vite.config.ts
└── tsconfig.json
```

The core pipeline is approximately:

```text
ZIP upload
  → archive inspection
  → path normalization
  → ignore-rule loading
  → stack detection
  → file tree selection
  → LLM Code Review filtering
  → guarded extraction
  → text decoding
  → Unicode normalization
  → secret scanning
  → high-entropy scanning
  → prompt-injection scanning
  → custom enterprise rules
  → optional condensation / skeletonization
  → token estimation
  → semantic chunking
  → Markdown/XML/JSON composition
  → token explorer / preview / download / local LLM handoff
```

---

## Installation

### Requirements

- Node.js 20 LTS recommended
- npm 10+
- Windows, macOS, or Linux

Electron installation requires access to Electron release downloads during normal package installation.

### Install dependencies

```bash
npm install
```

If package installation fails because of environment-specific Electron download restrictions, web-only verification can be performed with:

```bash
npm install --ignore-scripts
```

---

## Development

### Start the web app

```bash
npm run dev
```

### Build the web app

```bash
npm run build:web
```

### Type-check

```bash
npx tsc --noEmit
```

### Start Electron development mode

```bash
npm run electron:dev
```

### Build desktop package

```bash
npm run electron:build
```

---

## CLI usage

CodeDumper includes a headless CLI for automation and CI pipelines.

Basic usage:

```bash
npm run cli -- project.zip codedump.md
```

With token chunking:

```bash
npm run cli -- project.zip codedump.md --max-tokens 120000
```

With review focus paths:

```bash
npm run cli -- project.zip codedump.md --focus src/auth.ts,src/auth.test.ts
```

With a newline-separated or diff-derived focus list:

```bash
npm run cli -- project.zip codedump.md --focus-file changed-files.txt
```

With a patch file:

```bash
npm run cli -- project.zip codedump.md --focus-from-patch pr-123.patch
```

With custom enterprise rules:

```bash
npm run cli -- project.zip codedump.md --custom-rules rules.json
```

With skeleton condensation:

```bash
npm run cli -- project.zip codedump.md --ast-mode skeleton
```

Recommended CI mode:

```bash
npm run cli -- repository.zip codedump.md --llm-code-review --semantic-chunking --scan-secrets --scan-prompt-injection
```

---

## GitHub Action usage

The repository includes a local GitHub Action and workflow template for producing LLM-ready review artifacts in CI.

Example workflow behavior:

1. checkout repository
2. package repository as ZIP
3. run CodeDumper CLI
4. upload generated dump as workflow artifact

Typical usage:

```yaml
name: CodeDump Review Artifact

on:
  pull_request:
  workflow_dispatch:

jobs:
  codedump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - run: zip -r repository.zip . -x "node_modules/*" "dist/*" ".git/*"

      - run: npm run cli -- repository.zip codedump.md --llm-code-review --max-tokens 120000

      - uses: actions/upload-artifact@v4
        with:
          name: llm-code-review-dump
          path: codedump.md
```

---


### LM Studio on localhost or LAN

The Local LLM Panel accepts either a server base URL or a full chat-completions endpoint.

Examples:

```text
http://localhost:1234
http://localhost:1234/v1/chat/completions
http://192.168.178.62:1234
http://192.168.178.62:1234/v1/chat/completions
```

For LM Studio:

1. Start the LM Studio local server.
2. Load a model in LM Studio.
3. Enable LAN access / bind to all interfaces if CodeDumper runs on another device.
4. Allow port `1234` in the firewall.
5. In CodeDumper, choose **OpenAI-compatible / LM Studio**.
6. Click **Load models** or enter the exact running model name manually.
7. Send the dump.

If the browser shows `Failed to fetch`, the problem is usually one of these:

- the LM Studio server is not running
- the URL is missing the correct host or port
- the server is bound only to `localhost`, but CodeDumper is using a LAN IP
- the firewall blocks port `1234`
- the server rejects browser CORS requests

A quick check is to open this URL directly in the browser:

```text
http://192.168.178.62:1234/v1/models
```

If that works in a browser tab but the panel still cannot fetch it, use the Electron app or enable CORS support in the local server.

---

## Recommended LLM workflow

For a full repository review:

1. Enable **LLM Code Review Mode**.
2. Keep secret scanning enabled.
3. Keep prompt-injection scanning enabled for untrusted repositories.
4. Exclude generated data, reports, binaries, and lockfiles.
5. Use semantic chunking when the output exceeds the target model context window.
6. Review warnings before sending any dump to an external system.

For pull-request review:

1. Enable **Diff / Review Focus Mode**.
2. Provide changed file paths or a unified diff.
3. Include nearby tests and companions.
4. Generate a compact review dump.
5. Send only the focused dump to the LLM.

---

## What should not be included in an LLM code dump

CodeDumper is intentionally aggressive about excluding low-value or risky material.

Usually exclude:

```text
node_modules/**
dist/**
build/**
release/**
coverage/**
reports/**
data/**
.git/**
*.lock
package-lock.json
yarn.lock
pnpm-lock.yaml
*.map
*.log
*.min.js
*.pem
*.key
.env
.env.*
```

Usually include:

```text
src/**
app/**
lib/**
server/**
client/**
components/**
services/**
routes/**
controllers/**
models/**
tests/**
__tests__/**
*.test.*
*.spec.*
package.json
pyproject.toml
requirements.txt
Cargo.toml
go.mod
pom.xml
build.gradle
*.csproj
*.sln
README.md
ARCHITECTURE.md
SECURITY.md
```

---

## Privacy model

CodeDumper is a local processing tool. By design:

- uploaded ZIP files are processed locally
- no LLM provider is contacted
- no project data is uploaded by the app during dump generation
- token and cost estimates are calculated offline
- users remain responsible for where they later paste, upload, or send the generated dump

---

## Limitations

CodeDumper reduces risk, but it cannot guarantee that every sensitive value or malicious instruction will be detected.

Known limitations:

- entropy scanning can produce false positives
- prompt-injection phrase matching can miss novel attacks
- entropy scanning can redact harmless high-randomness identifiers
- prompt-injection phrase matching can miss novel attacks
- code condensation may remove comments that are semantically useful
- skeleton mode is structural and may omit implementation details required for deep debugging
- semantic chunking is heuristic and not a full dependency graph for every language
- local LLM handoff depends on the local model server and its context-window limits
- archive parsing is hardened but adversarial file formats are inherently risky
- generated dumps should still be reviewed before being shared externally

---

## Enterprise hardening checklist

Before using CodeDumper in a regulated or high-sensitivity environment:

- run dependency audit in your own supply-chain environment
- pin Node.js and npm versions in CI
- review Electron build and signing configuration
- enforce internal allowlists for export destinations
- keep secret scanning enabled by default
- keep prompt-injection scanning enabled for third-party code
- set conservative token and size limits
- store generated dumps as sensitive artifacts
- avoid sending proprietary code to external LLM providers unless approved by policy

---

## Scripts

Common scripts:

```bash
npm run dev
npm run build:web
npm run electron:dev
npm run electron:build
npm run cli -- project.zip codedump.md
npx tsc --noEmit
```

---

## Technology stack

- React
- TypeScript
- Vite
- Electron
- Web Workers
- `fflate`
- `js-tiktoken`
- `minimatch`
- Tailwind CSS
- local LLM compatible HTTP APIs

---

## Roadmap

Potential next improvements:

- full AST-based condensation using Tree-sitter
- language-specific dependency graph extraction
- SARIF export for security findings
- policy profiles for regulated environments
- organization-wide ignore-rule templates
- signed desktop releases
- deterministic dump manifests and checksums
- full Tree-sitter WASM grammar integration for more languages
- language-specific dependency graph extraction
- SARIF export for security findings
- policy profiles for regulated environments
- organization-wide ignore-rule templates
- signed desktop releases
- deterministic dump manifests and checksums
- optional local-only embedding index for repository navigation

---

## License

Add your license here, for example:

```text
MIT License
```

---

## Project status

CodeDumper is designed as a professional local-first tool for secure, token-aware, LLM-ready repository export. It is suitable for developer workflows, internal review automation, and enterprise evaluation, provided that generated artifacts are handled according to the organization’s data-protection policies.

