# Teacher AI prompts

Teachers can read the prefilled system and user prompts and edit each active AI step for Simulation, Writing, Voice Message, and Live Voice assessments.

- **AI settings → Prompt defaults:** choose an assessment type and save reusable defaults.
- **Assessments → AI prompts:** override individual steps for an assessment. The assessment and its prompts save together. The assessment and rubric assistant also uses these prompts, including unsaved edits in the current editor.
- **Assignments → AI prompts:** override individual steps for a class assignment before creating or saving it. Two assignments of the same assessment type can use different prompts independently.

Each field inherits separately: Explain default → teacher default for the type → assessment override → class assignment override. Reset removes the override and restores inheritance. Creating an assignment does not copy inherited text into an override, so later changes to a default reach assignments that still inherit it.

The AI step selector includes the steps used by that assessment type: speech recognition, live conversation, provisional grading, simulation readiness, sketch generation, simulation HTML/refinement, and the teacher draft assistant where applicable. Simulation submissions continue to use the existing teacher grading workflow.

## Templates and saved work

Use the listed `{{variables}}` in the user prompt to insert assignment context and student evidence. Values are JSON encoded and substituted once; template-like text inside a student answer stays ordinary evidence. Required evidence and attached files are included even if a template omits them. Place evidence variables in the user prompt; system prompts contain instructions.

Only missing required fields are appended automatically, so a large simulation or transcript already present in the template is not repeated. For audio transcription, `{{assessmentPrompt}}` supplies the assignment question; `{{context}}` contains that same question without answer keys or rubric guidance. The unchanged transcription defaults preserve automatic speech recognition.

Teachers can change instructional behavior while the app retains the required response structure, rubric identifiers and point limits, and simulation sandbox restrictions. Live conversations do not receive the expected answer. Speech recognition and image generation combine the two templates because those APIs accept a single instruction prompt. Unmodified speech recognition preserves the existing request without an optional provider prompt.

Changes apply at the next AI action, including existing drafts. Running requests and queued simulation jobs retain the prompts captured when they started. Changing prompts does not rewrite saved student work, the frozen question/rubric, existing artifacts, or previously recorded grades. A teacher can explicitly run another AI action to use the updated prompts.

The assessment and assignment editors temporarily disable changes and editor-switching controls while saving. The assessment editor does the same while its AI draft assistant runs. This prevents a pending response from clearing a newly opened draft.

## Access and deployment

Prompt overrides live in `private.teacher_ai_prompts`. Browsers cannot access the table or prompt RPCs directly; teacher Worker routes verify ownership. Student API responses never include the templates. Assessment/assignment saves and their prompt overrides are atomic and reject stale revisions; a rejected save keeps the editor draft.

Apply `20261008040019_teacher_assignment_prompts.sql` before deploying the Worker and frontend. The migration extends the existing attempt AI-context read with current prompt layers, avoiding an additional lookup for every student AI action. Provider credentials and frozen model settings continue to use their existing private storage.

Regression coverage includes field inheritance, isolation between assignments and teachers, updates reaching existing attempts, frozen-work preservation, stale-save rollback, actual provider request payloads, desktop/mobile editors, and required authentication.
