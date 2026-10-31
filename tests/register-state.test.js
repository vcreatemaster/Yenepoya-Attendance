import test from "node:test";
import assert from "node:assert/strict";
import {
  editReducer,
  countMarks,
  parseAttendancePaste,
} from "../src/register-state.js";

const loaded = (marks = {}) => editReducer({}, { type: "load", marks });
test("repeated status selection is a no-op and undo restores the saved baseline", () => {
  const initial = loaded({ 1: "A" });
  assert.equal(
    editReducer(initial, { type: "edit", changes: { 1: "A" } }),
    initial,
  );
  const edited = editReducer(initial, {
    type: "edit",
    changes: { 1: "P", 2: "L" },
  });
  assert.equal(edited.dirty, true);
  const undone = editReducer(edited, { type: "undo" });
  assert.deepEqual(undone.marks, { 1: "A" });
  assert.equal(undone.dirty, false);
  assert.deepEqual(initial.marks, { 1: "A" });
});

test("batch changes undo together and a successful save resets undo history", () => {
  const filled = editReducer(loaded({ 1: "A" }), {
    type: "edit",
    changes: { 2: "P", 3: "P" },
  });
  assert.deepEqual(filled.marks, { 1: "A", 2: "P", 3: "P" });
  assert.deepEqual(editReducer(filled, { type: "undo" }).marks, { 1: "A" });
  const saved = editReducer(filled, { type: "load", marks: filled.marks });
  assert.equal(saved.dirty, false);
  assert.equal(editReducer(saved, { type: "undo" }), saved);
});

test("clearing a previously blank mark restores clean state", () => {
  const edited = editReducer(loaded(), { type: "edit", changes: { 1: "P" } });
  assert.equal(
    editReducer(edited, { type: "edit", changes: { 1: "" } }).dirty,
    false,
  );
});

test("counts cover the full roster and exclude stale student IDs", () => {
  assert.deepEqual(
    countMarks(
      [1, 2, 3, 4, 5, 6].map((id) => ({ id })),
      {
        1: "P",
        2: "A",
        3: "L",
        4: "N",
        5: "",
        99: "P",
      },
    ),
    { P: 1, A: 1, L: 1, N: 1, unmarked: 2 },
  );
});

test("paste preserves blank rows and normalizes Excel line endings", () => {
  assert.deepEqual(parseAttendancePaste("\r\np\r\n\r\n a \r\nl\r\nn\r\n", 6), [
    "",
    "P",
    "",
    "A",
    "L",
    "N",
  ]);
});

test("paste refuses extra columns, invalid values and row overflow without truncating", () => {
  assert.throws(() => parseAttendancePaste("P\tA", 2), /Multiple columns/);
  assert.throws(() => parseAttendancePaste("P\nAbsent", 2), /Only P/);
  assert.throws(() => parseAttendancePaste("P\nA\nL", 2), /exceeds/);
  assert.throws(() => parseAttendancePaste("", 2), /empty/);
});
