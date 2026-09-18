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
* [x] Fixed DynamoDB handling of nullable audit fields
* [x] Added backward compatibility for existing audit rows containing `"None"` strings
* [x] Added Mangum dependency
* [x] Added `backend/lambda_handler.py`
* [x] Added API Gateway stage-path handling for Lambda
* [x] FastAPI application successfully compiles and runs on Lambda

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
* [x] Added Bedrock invocation IAM permissions
* [x] Added Nova cross-region inference-profile permissions
* [x] Added least-privilege S3/DynamoDB policies
* [x] Added CloudWatch Lambda log group
* [x] Added CloudWatch metric filters
* [x] SAM template validation passed
* [x] SAM build passed with Python 3.12
* [x] `flowforge-staging` stack deployed successfully in `ap-south-1`

### C6 - Lambda Runtime

* [x] Lambda entrypoint added using Mangum
* [x] FastAPI `/health` local smoke test passed
* [x] API Gateway v2 -> Mangum -> FastAPI local Lambda simulation passed
* [x] Deployed Lambda `/health` endpoint returned HTTP 200
* [x] Deployed workflow creation endpoint returned HTTP 200
* [x] Deployed workflow retrieval endpoint returned HTTP 200
* [x] Deployed workflow state transition succeeded
* [x] Deployed document-upload endpoint returned HTTP 200
* [x] Deployed audit endpoint returned HTTP 200 after DynamoDB null-handling fix

### C7 - Observability

* [x] CloudWatch Lambda log group defined
* [x] CloudWatch log retention configured for 7 days
* [x] Structured application-event logging added
* [x] CloudWatch metric filters for workflow completion, execution events, and errors
* [x] Verified deployed Lambda logs in CloudWatch
* [x] Verified `workflow_execution_event` logs
* [x] Verified `document_processed` log event
* [x] Used CloudWatch traceback to diagnose deployed audit-read failure

### C8 - CI/CD

* [x] `samconfig.example.toml` committed (`samconfig.toml` stays gitignored)
* [x] Existing `.github/workflows/ci.yml` preserved
* [x] Added `.github/workflows/cd.yml` staging deployment workflow
* [x] CD triggers on push/merge to `main` plus manual `workflow_dispatch`
* [x] Pull requests remain covered by CI
* [x] CD uses Python 3.12 and AWS SAM CLI
* [x] CD runs `sam validate --lint`
* [x] CD runs `sam build`
* [x] CD runs `sam deploy`
* [x] Deploys stack `flowforge-staging` in `ap-south-1`
* [x] Deploy parameters passed explicitly by the workflow
* [x] No AWS access keys or long-lived AWS credentials stored in GitHub
* [x] GitHub OIDC authentication configured
* [x] IAM deployment role configured for the GitHub `staging` environment
* [x] `AWS_DEPLOY_ROLE_ARN` configured as a GitHub environment secret
* [x] `concurrency: cd-staging` prevents overlapping deployments
* [x] Multiple staging deployments successfully executed from GitHub Actions
* [x] CI successfully validated subsequent fixes before deployment

## Bedrock / LLM Integration

* [x] Replaced retired Anthropic model configuration with Amazon Nova 2 Lite
* [x] Added support for the Bedrock Converse API
* [x] Configured Nova cross-region inference profile:
  `global.amazon.nova-2-lite-v1:0`
* [x] Updated IAM permissions for the inference profile and Nova foundation model
* [x] Verified the Nova configuration reached the deployed Lambda
* [x] Confirmed AWS currently rejects Bedrock invocation with
  `ValidationException: Operation not allowed`
* [x] Isolated the Bedrock failure as an AWS account/model-authorization issue rather than an application deployment issue
* [x] Added independent `MOCK_LLM` configuration
* [x] Kept `DEMO_MODE=false` while using the mock LLM
* [x] Verified staging can use Mock LLM while continuing to use real AWS S3, Textract, DynamoDB, Lambda, API Gateway, and CloudWatch

## Document Infrastructure Verification

* [x] S3 lifecycle deletion configured
* [x] Created a fictional non-sensitive proof-of-income test image
* [x] Uploaded the test document through the deployed API
* [x] Real S3 object-store path exercised
* [x] Real Textract `DetectDocumentText` path exercised
* [x] Document classified as `proof_of_income`
* [x] Document record persisted in DynamoDB
* [x] Document audit events persisted in DynamoDB
* [x] Audit events successfully retrieved through the deployed API
* [x] CloudWatch logged the `document_processed` event

### Live Test Result

Workflow:

`wf_a5e87fe80712`

Document:

`doc_0be60fba7953`

Classification:

`proof_of_income`

Confidence:

`0.75`

The deployed document endpoint returned:

`"message": "Document processed"`

## Validation

* [x] Backend tests passed: 53 tests
* [x] Ruff lint passed
* [x] Local Lambda handler returned HTTP 200
* [x] SAM template validation passed (`sam validate --lint`)
* [x] SAM build completed successfully
* [x] `git diff --check` passed for deployment fixes
* [x] CI workflow passed
* [x] CD workflow passed
* [x] Deployed staging stack verified in AWS
* [x] API Gateway verified
* [x] Lambda verified
* [x] DynamoDB workflow persistence verified
* [x] DynamoDB document persistence verified
* [x] DynamoDB audit persistence and retrieval verified
* [x] S3 upload verified
* [x] Textract processing verified
* [x] CloudWatch logging verified

## Current Status

Person C infrastructure and document-pipeline work is complete for the hackathon staging environment.

The deployed FlowForge staging environment has been verified end to end using:

API Gateway -> Lambda -> DynamoDB -> S3 -> Textract -> Mock LLM -> DynamoDB -> CloudWatch.

Bedrock integration is implemented and deployed using Amazon Nova 2 Lite with the cross-region inference profile, but live model invocation is currently blocked by AWS account-level authorization with:

`ValidationException: Operation not allowed`

To avoid blocking infrastructure verification, staging uses:

`DEMO_MODE=false`

and:

`MOCK_LLM=true`

This keeps the AWS infrastructure real while mocking only the LLM layer.

## Cleanup After Demo

When the hackathon/demo is complete:

* [ ] Empty the staging S3 bucket if it still contains uploaded test documents
* [ ] Delete the `flowforge-staging` CloudFormation stack when it is no longer needed
* [ ] Remove temporary/debug GitHub workflow files and branches if still present
* [ ] Re-enable live Bedrock by setting `MOCK_LLM=false` once AWS model authorization is available
