import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { TeacherAssessment, TeacherAssignment, TeacherCourse } from "@alt-assessment/shared";
import {
  archiveTeacherAssessment,
  archiveTeacherAssignment,
  archiveTeacherCourse,
  createTeacherAssessment,
  createTeacherAssignment,
  createTeacherCourse,
  listTeacherAssessments,
  listTeacherAssignments,
  listTeacherCourses,
  unarchiveTeacherAssessment,
  unarchiveTeacherAssignment,
  unarchiveTeacherCourse,
  updateTeacherAssessment,
  updateTeacherAssignment,
  updateTeacherCourse
} from "../../lib/api";

export const TEACHER_SELECTED_COURSE_KEY = "alt-assessment.teacher-selected-course-id";

interface TeacherWorkspaceDataContextValue {
  error: string | null;
  setError: (next: string | null) => void;
  courses: TeacherCourse[];
  selectedCourseId: string;
  selectedCourse: TeacherCourse | null;
  setSelectedCourseId: (courseId: string) => void;
  includeArchivedCourses: boolean;
  setIncludeArchivedCourses: (next: boolean) => void;
  loadingCourses: boolean;
  refreshCourses: () => Promise<void>;
  createCourse: (input: { code: string; name: string; section?: string; term?: string }) => Promise<TeacherCourse>;
  updateCourseById: (courseId: string, input: { code?: string; name?: string; section?: string | null; term?: string | null }) => Promise<TeacherCourse>;
  setCourseArchived: (course: TeacherCourse, archived: boolean) => Promise<void>;
  assessments: TeacherAssessment[];
  includeArchivedAssessments: boolean;
  setIncludeArchivedAssessments: (next: boolean) => void;
  loadingAssessments: boolean;
  refreshAssessments: () => Promise<void>;
  createAssessment: (input: {
    type: TeacherAssessment["type"];
    title: string;
    prompt: string;
    expectedAnswer?: string | null;
    rubric: TeacherAssessment["rubric"];
    config?: Record<string, unknown>;
  }) => Promise<TeacherAssessment>;
  updateAssessmentById: (assessmentId: string, input: {
    type?: TeacherAssessment["type"];
    title?: string;
    prompt?: string;
    expectedAnswer?: string | null;
    rubric?: TeacherAssessment["rubric"];
    config?: Record<string, unknown>;
  }) => Promise<TeacherAssessment>;
  setAssessmentArchived: (assessment: TeacherAssessment, archived: boolean) => Promise<void>;
  assignments: TeacherAssignment[];
  includeArchivedAssignments: boolean;
  setIncludeArchivedAssignments: (next: boolean) => void;
  loadingAssignments: boolean;
  refreshAssignments: () => Promise<void>;
  createAssignment: (input: {
    assessmentId: string;
    courseId: string;
    opensAt?: string | null;
    dueAt?: string | null;
  }) => Promise<TeacherAssignment>;
  updateAssignmentById: (assignmentId: string, input: {
    assessmentId?: string;
    courseId?: string;
    opensAt?: string | null;
    dueAt?: string | null;
  }) => Promise<TeacherAssignment>;
  setAssignmentArchived: (assignment: TeacherAssignment, archived: boolean) => Promise<void>;
}

const TeacherWorkspaceDataContext = createContext<TeacherWorkspaceDataContextValue | null>(null);

export function TeacherWorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [includeArchivedCourses, setIncludeArchivedCourses] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [selectedCourseIdState, setSelectedCourseIdState] = useState<string>(() => readTeacherSelectedCourseId());

  const [assessments, setAssessments] = useState<TeacherAssessment[]>([]);
  const [includeArchivedAssessments, setIncludeArchivedAssessments] = useState(false);
  const [loadingAssessments, setLoadingAssessments] = useState(false);

  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [includeArchivedAssignments, setIncludeArchivedAssignments] = useState(false);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  useEffect(() => {
    refreshCourses().catch((err) => setError(err instanceof Error ? err.message : "Could not load courses"));
  }, [includeArchivedCourses]);

  useEffect(() => {
    refreshAssessments().catch((err) => setError(err instanceof Error ? err.message : "Could not load assessments"));
  }, [includeArchivedAssessments]);

  useEffect(() => {
    refreshAssignments().catch((err) => setError(err instanceof Error ? err.message : "Could not load assignments"));
  }, [includeArchivedAssignments]);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseIdState) ?? null,
    [courses, selectedCourseIdState]
  );

  function setSelectedCourseId(courseId: string) {
    setSelectedCourseIdState(courseId);
    writeTeacherSelectedCourseId(courseId);
  }

  async function refreshCourses(preferredCourseId = selectedCourseIdState) {
    setLoadingCourses(true);
    try {
      const next = await listTeacherCourses(includeArchivedCourses);
      const nextCourses = next.courses;
      setCourses(nextCourses);
      const resolvedCourseId = resolveTeacherSelectedCourseId(nextCourses, preferredCourseId);
      setSelectedCourseId(resolvedCourseId);
    } finally {
      setLoadingCourses(false);
    }
  }

  async function refreshAssessments() {
    setLoadingAssessments(true);
    try {
      const next = await listTeacherAssessments(includeArchivedAssessments);
      setAssessments(next.assessments);
    } finally {
      setLoadingAssessments(false);
    }
  }

  async function refreshAssignments() {
    setLoadingAssignments(true);
    try {
      const next = await listTeacherAssignments({ includeArchived: includeArchivedAssignments });
      setAssignments(next.assignments);
    } finally {
      setLoadingAssignments(false);
    }
  }

  async function createCourse(input: { code: string; name: string; section?: string; term?: string }) {
    const saved = await createTeacherCourse(input);
    setSelectedCourseId(saved.course.id);
    await refreshCourses(saved.course.id);
    return saved.course;
  }

  async function updateCourseById(courseId: string, input: { code?: string; name?: string; section?: string | null; term?: string | null }) {
    const saved = await updateTeacherCourse(courseId, input);
    await refreshCourses(courseId);
    return saved.course;
  }

  async function setCourseArchived(course: TeacherCourse, archived: boolean) {
    if (archived) {
      await archiveTeacherCourse(course.id);
    } else {
      await unarchiveTeacherCourse(course.id);
    }
    await refreshCourses();
  }

  async function createAssessment(input: {
    type: TeacherAssessment["type"];
    title: string;
    prompt: string;
    expectedAnswer?: string | null;
    rubric: TeacherAssessment["rubric"];
    config?: Record<string, unknown>;
  }) {
    const created = await createTeacherAssessment(input);
    await refreshAssessments();
    await refreshAssignments();
    return created.assessment;
  }

  async function updateAssessmentById(assessmentId: string, input: {
    type?: TeacherAssessment["type"];
    title?: string;
    prompt?: string;
    expectedAnswer?: string | null;
    rubric?: TeacherAssessment["rubric"];
    config?: Record<string, unknown>;
  }) {
    const updated = await updateTeacherAssessment(assessmentId, input);
    await refreshAssessments();
    await refreshAssignments();
    return updated.assessment;
  }

  async function setAssessmentArchived(assessment: TeacherAssessment, archived: boolean) {
    if (archived) {
      await archiveTeacherAssessment(assessment.id);
    } else {
      await unarchiveTeacherAssessment(assessment.id);
    }
    await refreshAssessments();
    await refreshAssignments();
  }

  async function createAssignment(input: {
    assessmentId: string;
    courseId: string;
    opensAt?: string | null;
    dueAt?: string | null;
  }) {
    const created = await createTeacherAssignment(input);
    await refreshAssignments();
    return created.assignment;
  }

  async function updateAssignmentById(assignmentId: string, input: {
    assessmentId?: string;
    courseId?: string;
    opensAt?: string | null;
    dueAt?: string | null;
  }) {
    const updated = await updateTeacherAssignment(assignmentId, input);
    await refreshAssignments();
    return updated.assignment;
  }

  async function setAssignmentArchived(assignment: TeacherAssignment, archived: boolean) {
    if (archived) {
      await archiveTeacherAssignment(assignment.id);
    } else {
      await unarchiveTeacherAssignment(assignment.id);
    }
    await refreshAssignments();
  }

  return (
    <TeacherWorkspaceDataContext.Provider value={{
      error,
      setError,
      courses,
      selectedCourseId: selectedCourseIdState,
      selectedCourse,
      setSelectedCourseId,
      includeArchivedCourses,
      setIncludeArchivedCourses,
      loadingCourses,
      refreshCourses,
      createCourse,
      updateCourseById,
      setCourseArchived,
      assessments,
      includeArchivedAssessments,
      setIncludeArchivedAssessments,
      loadingAssessments,
      refreshAssessments,
      createAssessment,
      updateAssessmentById,
      setAssessmentArchived,
      assignments,
      includeArchivedAssignments,
      setIncludeArchivedAssignments,
      loadingAssignments,
      refreshAssignments,
      createAssignment,
      updateAssignmentById,
      setAssignmentArchived
    }}>
      {children}
    </TeacherWorkspaceDataContext.Provider>
  );
}

export function useTeacherWorkspaceData() {
  const context = useContext(TeacherWorkspaceDataContext);
  if (!context) {
    throw new Error("useTeacherWorkspaceData must be used within TeacherWorkspaceDataProvider");
  }
  return context;
}

export function resolveTeacherSelectedCourseId(courses: Array<{ id: string }>, preferredCourseId: string): string {
  if (courses.length === 0) return "";
  const ids = new Set(courses.map((course) => course.id));
  if (preferredCourseId && ids.has(preferredCourseId)) {
    return preferredCourseId;
  }
  return courses[0].id;
}

function readTeacherSelectedCourseId(): string {
  try {
    return localStorage.getItem(TEACHER_SELECTED_COURSE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeTeacherSelectedCourseId(courseId: string): void {
  try {
    if (courseId) {
      localStorage.setItem(TEACHER_SELECTED_COURSE_KEY, courseId);
    } else {
      localStorage.removeItem(TEACHER_SELECTED_COURSE_KEY);
    }
  } catch {
    // Ignore persistence failures; runtime state still works.
  }
}
