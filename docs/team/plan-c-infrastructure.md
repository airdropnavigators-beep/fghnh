# PLAN — PERSON C · DOCUMENTS + INFRASTRUCTURE

**Scope (spec §38):** S3, Textract, document ingestion, file validation, document
processing adapters, AWS SAM/CloudFormation, Lambda deployment, IAM, CloudWatch,
test documents, evaluation dataset, CI/CD.

Status legend: `[x] done`, `[/] in progress`, `[ ] pending`, `[~] blocked/stuck`.

---

## C1 · Document interfaces + adapters (already scaffolded behind interfaces)
- [x] `app/documents/processor.py` — `DocumentObjectStore` + `DocumentProcessor` protocols
- [x] `MockObjectStore` / `MockDocumentProcessor` — deterministic fictional content, demo + tests
- [x] `S3ObjectStore` — private bucket, `AES256` server-side encryption, generated object keys
- [x] `TextractProcessor` — real `detect_document_text`
- [x] `generate_object_key(workflow_id, filename)` — collision-safe `uploads/{wf}/{uuid}_{name}`
- [x] File guards: size limit (env `MAX_DOCUMENT_SIZE_MB`), MIME allow-list
      (env `ALLOWED_MIME_TYPES`) enforced in `app/api/routes.py`
- [ ] Add object retention/deletion job note (demo: delete after short retention)

## C2 · Document pipeline service (owner C + A touchpoints)
- [x] `app/services/document_service.py`: upload → store → extract text → classify →
      extract fields → persist (per-doc audit events)
- [x] Cross-document validation aggregation lives in the workflow `validation` state
      (`_validation_handler`) — reads all classified docs
- [ ] Live Textract smoke test with a real PDF (needs creds)

## C3 · Test documents (`evaluation/test_documents`, spec §33)
- [x] Generate fictional docs: `transcript_valid`, `transcript_gpa_conflict`,
      `transcript_missing_name`, `government_id_valid`, `government_id_name_mismatch`,
      `income_certificate_expired` (PDFs, no real personal data)
- [x] Keep them parseable by both the mock processor and Textract (real text, not scans)

## C4 · Evaluation dataset + metrics (`evaluation/`, spec §32, §43)
- [x] `evaluation/ground_truth/` — known answers per document (classification + fields + conflicts)
- [x] `evaluation/run_evaluation.py` — measures:
      workflow-gen validity (>95% target), classification (>90%), field extraction (>85%),
      conflict detection (>80%), generation latency (<5s), doc-processing latency (<10s)
- [x] `evaluation/results/` — only measured numbers, never fabricated
- [x] `docs/evaluation.md` — how to run + how results map to claims

## C5 · SAM / CloudFormation (`infrastructure/`, spec §7/§9)
- [ ] `template.yaml`: API Gateway + Lambda (FastAPI→Lambda adapter) + Bedrock permissions
      + S3 bucket (private, block public access) + DynamoDB tables (Workflows, Documents, AuditLog)
      + Textract permission + CloudWatch Logs
- [ ] `samconfig.toml` (per-env deployment config)
- [ ] Local Lambda event handler: adapt `main:app` → `lambda_handler` for API Gateway proxy
- [ ] IAM: least privilege; no public bucket; no hard-coded secrets

## C6 · Lambda entrypoint + runtime
- [ ] `backend/lambda_handler.py` wrapping the ASGI app (mangum or manual)
- [ ] Ensure business logic is HTTP-layer independent (already true: FastAPI routes are thin)
- [ ] Packaged deps (layer or container image) documented

## C7 · Observability
- [ ] CloudWatch log groups per function; structured log line per event
- [ ] Metric filter: workflow-completed, execution events, errors

## C8 · CI/CD
- [x] GitHub Actions: backend tests (`pytest` + `ruff`) on PR → develop
- [x] Frontend build/lint job on PR → develop
- [ ] Deploy job: `sam build && sam deploy` on merge to main (staging/env tags)
- [~] `.github/workflows/ci.yml` ✅ + `cd.yml` pending (blocked on SAM template)

---

**Owner notes / risks**
- Everything runs in `DEMO_MODE` without AWS; the real adapters must not break local dev.
- Key files already touched by A: `processor.py`, `mock_processor.py`, `aws_processor.py`,
  `document_service.py`, `knowledge/scholarship_process.json` (required-doc categories).
- The document categories vocabulary is shared with the workflow schema:
  `academic_transcript, government_id, proof_of_income, recommendation_letter,
  personal_essay, enrollment_verification, other`. Keep in sync.