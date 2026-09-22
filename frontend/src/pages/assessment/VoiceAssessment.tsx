import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import type { AssessmentSummary } from "@alt-assessment/shared";
import { AudioRecorder, type RecordingResult } from "../../components/AudioRecorder";
import { RubricFeedback } from "../../components/RubricFeedback";
import { gradeVoice, reserveUpload, uploadArtifact } from "../../lib/api";
import { formatBytes, resolveAudioMaxBytes, resolveVoiceMaxRecordingSec } from "../../lib/uploadPolicy";

export function VoiceAssessment({ assessment, disabled, onSubmit }: {
  assessment: AssessmentSummary;
  disabled: boolean;
  onSubmit: (task: (attemptId: string) => Promise<void>) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [recording, setRecording] = useState<RecordingResult | null>(null);
  const maxRecordingSec = resolveVoiceMaxRecordingSec(assessment.config);
  const maxAudioBytes = resolveAudioMaxBytes(assessment.config);

  return (
    <div className="workspace-grid">
      <AudioRecorder onReady={setRecording} maxSeconds={maxRecordingSec} />
      <RubricFeedback feedback={null} rubric={assessment.rubric} />
      <button
        className="primary-button submit-button"
        disabled={!recording || disabled}
        type="button"
        onClick={() => onSubmit(async (attemptId) => {
          if (!recording) return;
          if (recording.blob.size > maxAudioBytes) {
            throw new Error(`Recording exceeds max size of ${formatBytes(maxAudioBytes)}. Retake a shorter answer.`);
          }
          const upload = await reserveUpload({
            attemptId,
            kind: "audio",
            mimeType: recording.blob.type || "audio/webm",
            filename: "voice-response.webm",
            byteSize: recording.blob.size
          });
          await uploadArtifact(upload, recording.blob);
          await gradeVoice({ attemptId, artifactId: upload.artifactId, browserTranscript: recording.transcript });
          navigate(`/attempt/${attemptId}`);
        })}
      >
        <Send size={18} /> Submit voice response
      </button>
    </div>
  );
}
