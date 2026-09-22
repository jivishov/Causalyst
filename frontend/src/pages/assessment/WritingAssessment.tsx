import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
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
      <PdfImageUploader onFile={setFile} acceptedMime={acceptedMime} maxBytes={maxBytes} />
      <RubricFeedback feedback={null} rubric={assessment.rubric} />
      <button
        className="primary-button submit-button"
        disabled={!file || disabled}
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
        <Send size={18} /> Submit written work
      </button>
    </div>
  );
}
