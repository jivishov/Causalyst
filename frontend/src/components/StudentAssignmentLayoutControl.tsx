import { useState } from "react";
import { Columns2, Rows2 } from "lucide-react";

type AssignmentLayout = "side-by-side" | "vertical";
const preferenceKey = "explain.student.assignment-layout";

export function useStudentAssignmentLayout() {
  const [layout, setLayout] = useState<AssignmentLayout>(() => {
    try {
      return window.localStorage.getItem(preferenceKey) === "vertical" ? "vertical" : "side-by-side";
    } catch {
      return "side-by-side";
    }
  });

  function chooseLayout(next: AssignmentLayout) {
    setLayout(next);
    // The view still works when browser settings prevent saving preferences.
    try {
      window.localStorage.setItem(preferenceKey, next);
    } catch {
      // Keep the selection for this workspace.
    }
  }

  return [layout, chooseLayout] as const;
}

export function StudentAssignmentLayoutControl({ layout, onChange }: {
  layout: AssignmentLayout;
  onChange: (layout: AssignmentLayout) => void;
}) {
  return (
    <div className="student-assignment-layout-control" role="group" aria-label="Assignment layout">
      <span className="student-assignment-layout-label">Layout</span>
      <button type="button" aria-pressed={layout === "side-by-side"} onClick={() => onChange("side-by-side")} title="Place cards side by side when there is enough screen space">
        <Columns2 size={16} aria-hidden="true" /> Side by side
      </button>
      <button type="button" aria-pressed={layout === "vertical"} onClick={() => onChange("vertical")} title="Stack cards vertically with larger text">
        <Rows2 size={16} aria-hidden="true" /> Vertical
      </button>
    </div>
  );
}
