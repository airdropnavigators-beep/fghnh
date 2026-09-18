# PERSON C - PROGRESS

Owner: Ruthvik
Scope: Documents + AWS Infrastructure

## Completed

### Existing Document Work

* [x] S3 object-store adapter already implemented
* [x] Textract document processor already implemented
* [x] MIME-type and file-size validation already implemented
* [x] Document processing pipeline already implemented
* [x] Synthetic evaluation documents already available
* [x] Evaluation runner and ground-truth dataset already available

### AWS Runtime Preparation

* [x] Added separate `AWS_REGION` configuration for S3, DynamoDB, and Textract
* [x] Kept `BEDROCK_REGION` independent for Bedrock model access
* [x] Fixed DynamoDB item serialization/deserialization
* [x] Added Mangum dependency
* [x] Added `backend/lambda_handler.py`
* [x] FastAPI application successfully compiles for Lambda

### C5 - SAM / CloudFormation

* [x] Created `infrastructure/template.yaml`
* [x] Added API Gateway HTTP API
* [x] Added FastAPI Lambda
* [x] Added private encrypted S3 bucket
* [x] Added S3 document-retention lifecycle rule
* [x] Added Workflows DynamoDB table
* [x] Added Documents DynamoDB table
* [x] Added Audit DynamoDB table
* [x] Added Textract IAM permission
* [x] Added Bedrock `InvokeModel` IAM permission
* [x] Added least-privilege S3/DynamoDB policies
* [x] Added CloudWatch Lambda log group
* [x] SAM template validation passed
* [x] SAM build passed with Python 3.12

### C6 - Lambda Runtime

* [x] Lambda entrypoint added using Mangum
* [x] FastAPI `/health` local smoke test passed
* [x] API Gateway v2 -> Mangum -> FastAPI local Lambda simulation passed
* [ ] AWS Lambda smoke test after deployment

## In Progress

### C7 - Observability
- [x] CloudWatch Lambda log group defined
- [x] Structured application-event logging
- [x] CloudWatch metric filters for workflow completion/errors

### C8 - CI/CD

* [x] `samconfig.example.toml` committed (`samconfig.toml` stays gitignored)
* [x] Existing `.github/workflows/ci.yml` preserved unchanged
* [x] Added `.github/workflows/cd.yml` staging deployment workflow
* [x] CD triggers on push/merge to `main` only (plus manual `workflow_dispatch`);
      pull requests are excluded and remain covered by CI
* [x] CD uses Python 3.12, installs the AWS SAM CLI, then runs
      `sam validate --lint`, `sam build`, `sam deploy`
* [x] Deploys stack `flowforge-staging` in `ap-south-1`
* [x] Deploy parameters passed explicitly on the CLI, because
      `infrastructure/samconfig.toml` is gitignored and absent on the runner
* [x] No AWS access keys or secrets in the repository; authentication uses
      GitHub OIDC (`id-token: write`) assuming `secrets.AWS_DEPLOY_ROLE_ARN`
* [x] `concurrency: cd-staging` prevents overlapping deployments of the same stack
* [ ] Staging deployment executed (deliberately NOT run from a local machine)

#### CD prerequisites (one-time, to be configured in GitHub/AWS before first run)

* [x] Create GitHub environment `staging`
* [x] Create an IAM role trusting the GitHub OIDC provider
      (`token.actions.githubusercontent.com`) scoped to this repository's `staging` environment
* [x] Store that role's ARN as the environment secret `AWS_DEPLOY_ROLE_ARN`
      (ARN only; no AWS access keys stored)

## Remaining Document Tasks

* [x] S3 lifecycle deletion configured in infrastructure
* [ ] Live Textract smoke test with fictional PDF

## Validation

* [x] Backend tests passed: 53 tests
* [x] Ruff lint passed
* [x] Local Lambda handler returned HTTP 200
* [x] SAM template validation passed (`sam validate --lint`)
* [x] SAM build completed successfully
* [x] `ci.yml` and `cd.yml` parse as valid YAML with the expected jobs/triggers
* [ ] Deployed staging stack verified in AWS - pending, no deployment has been run

## Current Focus

CI/CD preparation is complete and committed-ready. The staging deployment pipeline
is defined but has never been executed: no deployment has been made from a local
machine, and no AWS credentials were used. The first `flowforge-staging` deploy will
happen only when the OIDC role and `AWS_DEPLOY_ROLE_ARN` secret are in place and a
merge to `main` occurs (or the workflow is manually dispatched).
