import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Keep page-specific controls beside the workspace title. */
export function TeacherPageToolbar({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(document.getElementById("teacher-page-tools")); }, []);
  return target ? createPortal(children, target) : null;
}
