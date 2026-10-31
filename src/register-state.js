export const attendanceLabels = {
  P: "Present",
  A: "Absent",
  L: "Late",
  N: "Not enrolled",
};
export function countMarks(students, marks) {
  const counts = { P: 0, A: 0, L: 0, N: 0, unmarked: 0 };
  for (const student of students) counts[marks[student.id] || "unmarked"]++;
  return counts;
}
const sameMarks = (a, b) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (id) => (a[id] || "") === (b[id] || ""),
  );
export function editReducer(state, action) {
  if (action.type === "load")
    return {
      marks: action.marks,
      baseline: action.marks,
      history: [],
      dirty: false,
    };
  if (action.type === "undo") {
    if (!state.history.length) return state;
    const marks = state.history.at(-1);
    return {
      ...state,
      marks,
      history: state.history.slice(0, -1),
      dirty: !sameMarks(marks, state.baseline),
    };
  }
  if (action.type === "edit") {
    const marks = { ...state.marks, ...action.changes };
    if (sameMarks(marks, state.marks)) return state;
    return {
      ...state,
      marks,
      history: [...state.history.slice(-39), state.marks],
      dirty: !sameMarks(marks, state.baseline),
    };
  }
  return state;
}
export function parseAttendancePaste(text, remainingRows) {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!normalized) throw new Error("The clipboard is empty.");
  if (normalized.includes("\t"))
    throw new Error(
      "Paste one attendance column at a time. Multiple columns are not accepted.",
    );
  const values = normalized.split("\n").map((v) => v.trim().toUpperCase());
  if (values.some((v) => v && !(v in attendanceLabels)))
    throw new Error("Only P, A, L, N, or blank cells are accepted.");
  if (values.length > remainingRows)
    throw new Error(
      "The pasted column exceeds the remaining visible students. Nothing has been changed.",
    );
  return values;
}
