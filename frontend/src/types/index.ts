/**
 * TypeScript mirror of the FlowForge backend contract
 * (`backend/app/models/api.py`, `workflow.py`, `document.py`, `audit.py`).
 * Field names are snake_case to match the JSON wire format produced by Pydantic.
 */

export type StateType =
  | "automatic"
  | "user_input"
  | "document_required"
  | "human_approval"
  | "validation"
  | "execution"
  | "terminal";

export type StateStatus = "pending" | "active" | "completed" | "warning" | "blocked" | "failed";

export type WorkflowStatus = "in_progress" | "completed" | "cancelled" | "failed" | "generation_failed";

export type ValidationStatus = "pass" | "needs_review" | "block";

export type ValidationSeverity = "info" | "warning" | "error";

export type AuditEventType =
  | "workflow_created"
  | "workflow_generated"
  | "state_activated"
  | "state_transition"
  | "document_uploaded"
  | "field_extracted"
  | "human_approval"
  | "execution"
  | "workflow_completed"
  | "workflow_failed";

export interface Transition {
  target: string;
  condition: string;
}

export interface WorkflowState {
  id: string;
  label: string;
  type: StateType;
  description: string;
  required_data: string[];
  required_documents: string[];
  transitions: Transition[];
  confidence_threshold?: number;
  status: StateStatus;
}

export interface WorkflowDefinition {
  workflow_id: string;
  goal: string;
  initial_state: string;
  terminal_states: string[];
  states: WorkflowState[];
}

export interface Progress {
  completed: number;
  total: number;
  ratio: number;
}

export interface ExtractedField {
  value: string;
  confidence: number;
  source_text: string;
}

export interface ValidationIssue {
  severity: ValidationSeverity;
  field: string;
  message: string;
  evidence?: string[];
  suggestion?: string;
}

export interface ValidationResult {
  status: ValidationStatus;
  confidence: number;
  issues: ValidationIssue[];
  suggestions: string[];
  checked_documents: string[];
}

export interface SubmissionReceipt {
  confirmation_id: string;
  documents?: string[];
  submitted_at?: string;
  simulated?: boolean;
  [key: string]: unknown;
}

export interface WorkflowDetail {
  workflow_id: string;
  status: WorkflowStatus;
  goal: string;
  current_state: string | null;
  last_message?: string | null;
  needs?: string | null;
  progress: Progress;
  states: WorkflowState[];
  collected_documents: string[];
  validation?: ValidationResult | null;
  /** Execution receipt, present once the execution state has run. */
  submission?: SubmissionReceipt | null;
}

export interface AdvanceRequest {
  user_input?: Record<string, unknown>;
  approval?: boolean;
  acknowledge?: boolean;
  confirm?: boolean;
  document_id?: string;
}

export interface AdvanceResponse extends WorkflowDetail {
  message?: string | null;
  completed: boolean;
  events: AuditEvent[];
}

export interface AuditEvent {
  event_id?: string;
  timestamp: string;
  workflow_id: string;
  event_type: AuditEventType;
  from_state?: string | null;
  to_state?: string | null;
  confidence?: number | null;
  details: Record<string, unknown>;
}

export interface DocumentUploadResult {
  document_id: string;
  filename: string;
  classification?: string | null;
  confidence?: number | null;
  extracted_fields: Record<string, ExtractedField>;
  validation_status?: string | null;
  issues: ValidationIssue[];
  message: string;
}

export interface CreateWorkflowResult {
  workflow_id: string;
  status: WorkflowStatus;
  workflow: WorkflowDefinition;
}

export interface AuditResponse {
  workflow_id: string;
  events: AuditEvent[];
}

export const STATE_TYPE_LABELS: Record<StateType, string> = {
  automatic: "Automatic",
  user_input: "User input",
  document_required: "Document",
  human_approval: "Approval",
  validation: "Validation",
  execution: "Execution",
  terminal: "Terminal",
};

export const DOC_LABELS: Record<string, string> = {
  academic_transcript: "Academic transcript",
  government_id: "Government ID",
  proof_of_income: "Proof of income",
  personal_essay: "Personal essay",
  enrollment_verification: "Enrollment verification",
};

export const NEEDS_LABELS: Record<string, string> = {
  document_upload: "Documents needed",
  user_input: "Input needed",
  approval: "Approval needed",
  action: "Action needed",
};

export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  generation_failed: "Planning failed",
};