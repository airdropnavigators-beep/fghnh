# Evaluation

How FlowForge is measured, how to reproduce the numbers, and what the numbers do
(and do not) claim.

## TL;DR

- Run `backend/.venv/Scripts/python.exe evaluation/run_evaluation.py` from the repo root.
- The default run evaluates the deterministic **DEMO_MODE** pipeline
  (`MockLLMProvider` + `MockDocumentProcessor`) against `evaluation/ground_truth/documents.json`.
- `--provider bedrock` evaluates the live AWS adapters when credentials are configured.
- Measured results are written to `evaluation/results/` (gitignored) as JSON — never hand-edited.

## Dataset

| Artifact | Path |
| --- | --- |
| Test documents (PDF, selectable text) | `evaluation/test_documents/` |
| Generator (stdlib-only, deterministic) | `evaluation/generate_test_documents.py` |
| Ground truth (classification, fields, conflicts) | `evaluation/ground_truth/documents.json` |
| Harness | `evaluation/run_evaluation.py` |

Generate the corpus (content comes from `MockDocumentProcessor.extract_text`, so the
PDFs and the mock pipeline share one source of truth):

```powershell
backend\.venv\Scripts\python.exe evaluation\generate_test_documents.py
```

The nine documents cover the documented variants: valid / GPA-conflict /
missing-name transcript, valid / name-mismatch government ID, valid / expired income
certificate, enrollment verification, and personal essay. All content is fictional;
no real personal data is used.

## Metrics

| Metric | Definition | Target |
| --- | --- | --- |
| Workflow generation validity | Share of generated workflows that pass the schema validator (`schema_validator.validate`) | > 95% |
| Classification accuracy | Correct document category over the dataset | > 90% |
| Field extraction accuracy | Correct field values (incl. expected-absent fields) over the dataset | > 85% |
| Conflict detection accuracy | Validation status (`pass` / `needs_review` / `block`) matches the labelled scenario | > 80% |
| Workflow generation latency | Mean wall-clock time per `WorkflowGenerator.generate` call | < 5 s |
| Document processing latency | Mean wall-clock time per store→extract→classify→extract-fields pass | < 10 s |

## Reproduce

```powershell
# deterministic demo path (no AWS)
backend\.venv\Scripts\python.exe evaluation\run_evaluation.py

# fail the process if any metric misses its target (for CI-style gates)
backend\.venv\Scripts\python.exe evaluation\run_evaluation.py --strict

# live AWS adapters (requires Bedrock + Textract credentials)
backend\.venv\Scripts\python.exe evaluation\run_evaluation.py --provider bedrock
```

## Measured — DEMO_MODE (mock provider)

Latest run (`mock`, 2026-09-17):

| Metric | Value | Target | Samples | Result |
| --- | --- | --- | --- | --- |
| Workflow generation validity | 100.0% | 95% | 12 | PASS |
| Classification accuracy | 100.0% | 90% | 9 | PASS |
| Field extraction accuracy | 100.0% | 85% | 26 | PASS |
| Conflict detection accuracy | 100.0% | 80% | 3 | PASS |
| Workflow generation latency | 0.07 ms mean (p95 0.12 ms) | 5000 ms | 12 | PASS |
| Document processing latency | 0.05 ms mean (p95 0.08 ms) | 10000 ms | 9 | PASS |

These are real, reproduced numbers for the deterministic demo path. They describe
the behaviour of the controlled mock components, **not** a foundation model.

## What the numbers do and do not claim

- **Do:** show the end-to-end pipeline, contract types, validation gating, and the
  deterministic fallback behave as specified, and provide a reproducible baseline.
- **Do not:** claim Bedrock/Textract accuracy, real-world generalization, or any
  result on non-fictional data. Run `--provider bedrock` with credentials for that.
- The mock classification bug where `income_certificate_valid.pdf` was read as an ID
  (substring `id` inside `valid`) was caught by this harness; the token-based fix in
  `mock_processor.py` is covered by `backend/tests/test_ai.py`.
