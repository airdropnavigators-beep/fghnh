# FlowForge

**From intent to execution.**

> FlowForge converts natural-language goals into validated, executable workflows and guides users through those workflows using AI-powered document intelligence and human-in-the-loop approval.

## The core concept

```
Natural Language Goal
        |
        v
Workflow Planning LLM
        |
        v
Structured Workflow JSON
        |
        v
JSON Schema Validation
        |
        v
Deterministic State Machine
        |
        +---- Document Processing
        |
        +---- Validation
        |
        +---- User Input
        |
        +---- Human Approval
        |
        +---- Simulated Execution
        |
        v
Workflow Completion
```

**The LLM plans. The state machine executes. The human stays in control.**

## Quick start

### Backend (local, demo mode — no AWS needed)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp ../.env.example .env        # DEMO_MODE=true
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`, type a goal such as:

> I want to apply for the Merit Excellence Scholarship.

The UI starts in **offline demo** mode (a deterministic in-browser mock). To drive the
real backend, start it as above and either flip the **Offline demo / Live API** switch
in the header, open `http://localhost:5173/?api=live`, or set `VITE_USE_MOCK=false`
(see `frontend/.env.example`). The dev server proxies `/api` to `127.0.0.1:8000`.

Quality gates: `npm run lint`, `npm test`, `npm run build` (`tsc --noEmit && vite build`).

## Demo mode

`DEMO_MODE=true` (the default local config) runs the entire path against:

- a pre-generated, schema-valid workflow
- deterministic mock document extraction
- simulated submission

The real **Amazon Bedrock**, **S3**, **Textract**, **DynamoDB** and **Lambda** implementations
exist behind the same interfaces and are used when AWS credentials are available
(`DEMO_MODE=false`). See `docs/ai-architecture.md` and `docs/architecture.md`.

## What is in the repo

- `frontend/` — React + TypeScript + Vite + Tailwind + React Flow application
- `backend/` — FastAPI application; business logic is isolated from HTTP and AWS
- `infrastructure/` — AWS SAM template for serverless deployment
- `evaluation/` — ground-truth datasets and evaluation scripts
- `docs/` — architecture, AI, workflow-engine, API and evaluation notes

## Definition of done

The project is complete when this full path works end to end:

```
User enters goal -> Workflow generated -> Workflow validated -> Graph rendered
-> State machine starts -> Document uploaded -> Document classified
-> Fields extracted -> Requirements validated -> Conflict detected
-> User reviews -> Human approves -> Submission simulated
-> Workflow completed -> Audit trail available
```

## License

MIT — see `LICENSE`.