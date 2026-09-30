import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoaderCircle, Send } from "lucide-react";
import type { AssessmentSummary } from "@alt-assessment/shared";
import { PdfImageUploader } from "../../components/PdfImageUploader";
import { RubricFeedback } from "../../components/RubricFeedback";
import { gradeWriting, reserveUpload, uploadArtifact } from "../../lib/api";
import { resolveWritingAcceptedMime, resolveWritingMaxBytes } from "../../lib/uploadPolicy";

export function WritingAssessment({ assessment, disabled, onSubmit }: {
  assessment: AssessmentSummary;
  disabled: boolean;
  onSubmit: (task: (attemptId: string) => Promise<void>) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const acceptedMime = resolveWritingAcceptedMime(assessment.config);
  const maxBytes = resolveWritingMaxBytes(assessment.config);

  return (
    <div className="workspace-grid">
      <div className="assessment-response">
        <PdfImageUploader onFile={setFile} acceptedMime={acceptedMime} maxBytes={maxBytes} />
        <button
          className="primary-button submit-button"
          disabled={!file || disabled}
          aria-busy={disabled}
          type="button"
          onClick={() => onSubmit(async (attemptId) => {
            if (!file) return;
            const upload = await reserveUpload({
              attemptId,
              kind: "writing",
              mimeType: file.type || "application/octet-stream",
              filename: file.name,
              byteSize: file.size
            });
            await uploadArtifact(upload, file);
            await gradeWriting({ attemptId, artifactId: upload.artifactId });
            navigate(`/attempt/${attemptId}`);
          })}
        >
          {disabled ? <LoaderCircle size={18} className="student-action-spinner" aria-hidden="true" /> : <Send size={18} />} {disabled ? "Submitting written work..." : "Submit written work"}
        </button>
      </div>
      <RubricFeedback feedback={null} rubric={assessment.rubric} />
    </div>
  );
}
