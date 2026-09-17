# FlowForge API Reference

> Generated from the live OpenAPI schema by `backend/scripts/generate_api_reference.py`. Do not edit by hand.

From intent to execution. The LLM plans, the state machine executes, the human stays in control.

**Version:** `0.1.0`

## Endpoints

| Method | Path | Summary | Operation |
| --- | --- | --- | --- |
| `POST` | `/workflows` | Create Workflow | [details](#post-workflows) |
| `GET` | `/workflows/{workflow_id}` | Get Workflow | [details](#get-workflowsworkflow_id) |
| `POST` | `/workflows/{workflow_id}/advance` | Advance | [details](#post-workflowsworkflow_idadvance) |
| `POST` | `/workflows/{workflow_id}/documents` | Upload Document | [details](#post-workflowsworkflow_iddocuments) |
| `GET` | `/workflows/{workflow_id}/audit` | List Audit | [details](#get-workflowsworkflow_idaudit) |
| `GET` | `/health` | Health | [details](#get-health) |
| `GET` | `/` | Root | [details](#get-) |

### `POST /workflows`

**Create Workflow**

**Request body** (`application/json`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `goal` | string | yes | Natural-language goal the workflow should accomplish. |

**Responses**

| Status | Description | Body |
| --- | --- | --- |
| `200` | Successful Response | `CreateWorkflowResponse` |
| `422` | Validation Error | `HTTPValidationError` |

### `GET /workflows/{workflow_id}`

**Get Workflow**

**Parameters**

| Name | In | Required | Type |
| --- | --- | --- | --- |
| `workflow_id` | path | yes | string |

**Responses**

| Status | Description | Body |
| --- | --- | --- |
| `200` | Successful Response | `WorkflowDetailResponse` |
| `422` | Validation Error | `HTTPValidationError` |

### `POST /workflows/{workflow_id}/advance`

**Advance**

**Parameters**

| Name | In | Required | Type |
| --- | --- | --- | --- |
| `workflow_id` | path | yes | string |

**Request body** (`application/json`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `user_input` | object | no | Values for the current user_input state, keyed by required_data field. |
| `approval` | boolean \| null | no | Explicit approve/deny decision for the current human_approval state. |
| `acknowledge` | boolean \| null | no | Acknowledge a warning gate (e.g. a low-confidence validation issue). |
| `confirm` | boolean \| null | no | Generic confirmation for user_confirmed transitions. |
| `document_id` | string \| null | no | Optional reference to a specific uploaded document. |

**Responses**

| Status | Description | Body |
| --- | --- | --- |
| `200` | Successful Response | `AdvanceWorkflowResponse` |
| `422` | Validation Error | `HTTPValidationError` |

### `POST /workflows/{workflow_id}/documents`

**Upload Document**

**Parameters**

| Name | In | Required | Type |
| --- | --- | --- | --- |
| `workflow_id` | path | yes | string |

**Request body** (`multipart/form-data`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes |  |

**Responses**

| Status | Description | Body |
| --- | --- | --- |
| `200` | Successful Response | `DocumentUploadResponse` |
| `422` | Validation Error | `HTTPValidationError` |

### `GET /workflows/{workflow_id}/audit`

**List Audit**

**Parameters**

| Name | In | Required | Type |
| --- | --- | --- | --- |
| `workflow_id` | path | yes | string |

**Responses**

| Status | Description | Body |
| --- | --- | --- |
| `200` | Successful Response | `AuditListResponse` |
| `422` | Validation Error | `HTTPValidationError` |

### `GET /health`

**Health**

**Responses**

| Status | Description | Body |
| --- | --- | --- |
| `200` | Successful Response | object |

### `GET /`

**Root**

**Responses**

| Status | Description | Body |
| --- | --- | --- |
| `200` | Successful Response | object |

## Schemas

### `AdvanceWorkflowRequest`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `user_input` | object | no | Values for the current user_input state, keyed by required_data field. |
| `approval` | boolean \| null | no | Explicit approve/deny decision for the current human_approval state. |
| `acknowledge` | boolean \| null | no | Acknowledge a warning gate (e.g. a low-confidence validation issue). |
| `confirm` | boolean \| null | no | Generic confirmation for user_confirmed transitions. |
| `document_id` | string \| null | no | Optional reference to a specific uploaded document. |

### `AdvanceWorkflowResponse`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `workflow_id` | string | yes |  |
| `status` | `WorkflowStatus` | yes |  |
| `goal` | string | yes |  |
| `current_state` | string \| null | no | id of the active state. |
| `last_message` | string \| null | no | Human-readable assistant message for the current state. |
| `needs` | string \| null | no | Normalized gate label: user_input \| document_upload \| approval \| action. |
| `progress` | `WorkflowProgress` | yes |  |
| `states` | array<object> | yes | Serialized state nodes for the graph view. |
| `collected_documents` | array<string> | no | Classifications of documents received so far. |
| `validation` | object \| null | no | Latest cross-document validation result, if any. |
| `message` | string \| null | no | Status message for this step. |
| `completed` | boolean | no | True once a terminal state is reached. |
| `events` | array<object> | no | Audit events emitted by this step. |

### `AuditListResponse`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `workflow_id` | string | yes |  |
| `events` | array<object> | no |  |

### `Body_upload_document_workflows__workflow_id__documents_post`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes |  |

### `CreateWorkflowRequest`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `goal` | string | yes | Natural-language goal the workflow should accomplish. |

### `CreateWorkflowResponse`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `workflow_id` | string | yes | Server-assigned workflow identifier. |
| `status` | `WorkflowStatus` | yes |  |
| `workflow` | object | yes | The validated workflow definition (see docs/workflow-engine.md). |

### `DocumentUploadResponse`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `document_id` | string | yes |  |
| `filename` | string | yes |  |
| `classification` | string \| null | no | Detected document category. |
| `confidence` | number \| null | no | Classification confidence in [0, 1]. |
| `extracted_fields` | object | no | Extracted fields, each with value/confidence/source_text. |
| `validation_status` | string \| null | no | Per-document status: pass \| needs_review \| block. |
| `issues` | array<object> | no |  |
| `message` | string | no |  |

### `HTTPValidationError`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `detail` | array<`ValidationError`> | no |  |

### `ValidationError`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `loc` | array<string \| integer> | yes |  |
| `msg` | string | yes |  |
| `type` | string | yes |  |
| `input` | any | no |  |
| `ctx` | object | no |  |

### `WorkflowDetailResponse`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `workflow_id` | string | yes |  |
| `status` | `WorkflowStatus` | yes |  |
| `goal` | string | yes |  |
| `current_state` | string \| null | no | id of the active state. |
| `last_message` | string \| null | no | Human-readable assistant message for the current state. |
| `needs` | string \| null | no | Normalized gate label: user_input \| document_upload \| approval \| action. |
| `progress` | `WorkflowProgress` | yes |  |
| `states` | array<object> | yes | Serialized state nodes for the graph view. |
| `collected_documents` | array<string> | no | Classifications of documents received so far. |
| `validation` | object \| null | no | Latest cross-document validation result, if any. |

### `WorkflowProgress`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `completed` | integer | yes | Number of states completed. |
| `total` | integer | yes | Total number of states in the workflow. |
| `ratio` | number | yes | completed / total. |

### `WorkflowStatus`

Values: `created`, `in_progress`, `blocked`, `generation_failed`, `completed`, `failed`, `cancelled`
