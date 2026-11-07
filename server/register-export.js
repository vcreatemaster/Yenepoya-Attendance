import ExcelJS from "exceljs";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { today } from "./db.js";

const logoPath = fileURLToPath(
  new URL("../src/assets/yenepoya-logo.svg", import.meta.url),
);
let logo;
const monthLabel = (month) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
const fill = (argb) => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});
const border = { style: "thin", color: { argb: "FFBCC8D5" } };

export async function registerWorkbook(db, subject, selectedMonth) {
  const cls = db
    .prepare(
      `SELECT cl.*,c.code AS course,u.name AS advisor FROM classes cl
    JOIN courses c ON c.id=cl.course_id LEFT JOIN users u ON u.id=cl.advisor_id WHERE cl.id=?`,
    )
    .get(subject.class_id);
  const teacher = subject.teacher_id
    ? db.prepare("SELECT name FROM users WHERE id=?").get(subject.teacher_id)
        ?.name
    : null;
  const sessions = db
    .prepare(
      "SELECT * FROM teaching_sessions WHERE subject_id=? ORDER BY date,period",
    )
    .all(subject.id)
    .filter((s) => !selectedMonth || s.date.startsWith(selectedMonth));
  const students = db
    .prepare("SELECT * FROM students WHERE class_id=? ORDER BY name")
    .all(subject.class_id);
  const marks = new Map(
    db
      .prepare(
        `SELECT m.* FROM marks m JOIN teaching_sessions t ON t.id=m.session_id WHERE t.subject_id=?`,
      )
      .all(subject.id)
      .map((m) => [`${m.session_id}:${m.student_id}`, m.status]),
  );
  const months = selectedMonth
    ? [selectedMonth]
    : [...new Set(sessions.map((s) => s.date.slice(0, 7)))];
  if (!months.length) months.push(null);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yenepoya University";
  wb.calcProperties.fullCalcOnLoad = true;
  // Excel embeds PNG images reliably; retain the original SVG proportions and colours.
  logo ||= sharp(logoPath)
    .resize({ width: 1476 })
    .png()
    .toBuffer()
    .catch((error) => {
      logo = null;
      throw error;
    });
  const imageId = wb.addImage({ buffer: await logo, extension: "png" });
  for (const month of months) {
    const periods = sessions.filter((s) => !month || s.date.startsWith(month));
    const sheet = wb.addWorksheet(month ? monthLabel(month) : "Register", {
      views: [{ state: "frozen", xSplit: 4, ySplit: 16, showGridLines: false }],
      pageSetup: {
        orientation: "landscape",
        paperSize: periods.length > 16 ? 8 : 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.3,
          bottom: 0.3,
          header: 0.15,
          footer: 0.15,
        },
      },
    });
    const attendedCol = 5 + periods.length,
      percentageCol = attendedCol + 1;
    const lastCol = sheet.getColumn(percentageCol).letter;
    const firstStudent = 17,
      lastStudent = 16 + students.length;
    [6, 14, 17, 40].forEach((width, i) => {
      sheet.getColumn(i + 1).width = width;
    });
    periods.forEach((_, i) => {
      sheet.getColumn(i + 5).width = 4.5;
    });
    sheet.getColumn(attendedCol).width = 12;
    sheet.getColumn(percentageCol).width = 9;
    for (let row = 1; row <= 7; row++) sheet.getRow(row).height = 18;
    sheet.addImage(imageId, {
      tl: { col: 0.15, row: 0.5 },
      ext: { width: 470, height: (470 * 302.4) / 1476 },
      editAs: "absolute",
    });
    const metadata = [
      [
        "CLASS :",
        `${cls.course} '${cls.section}' · Admission ${cls.admission_year} · Semester ${subject.semester}`,
      ],
      ["MONTH :", month ? monthLabel(month) : "No sessions scheduled"],
      ["CLASS ADVISOR :", cls.advisor || "Unassigned"],
      ["SUBJECT :", subject.name],
      ["SUBJECT TEACHER :", teacher || "Unassigned"],
    ];
    metadata.forEach(([label, value], i) => {
      const row = i + 9;
      sheet.mergeCells(row, 1, row, 2);
      sheet.mergeCells(row, 3, row, percentageCol);
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 3).value = value;
      sheet.getRow(row).height = 25;
      for (const col of [1, 3]) {
        const cell = sheet.getCell(row, col);
        cell.font = { name: "Arial", size: 11, bold: col === 1 };
        cell.alignment = { vertical: "middle", wrapText: true };
      }
    });
    sheet.getRow(15).values = [
      "Sl. No.",
      "Campus ID",
      "Reg. No.",
      "Name",
      ...periods.map((s) => Number(s.date.slice(-2))),
      "No. of classes",
      "%",
    ];
    sheet.getRow(15).height = 32;
    // Calculation flags are hidden, leaving only day numbers visible in the date header.
    sheet.getRow(16).hidden = true;
    const eligible = periods.map(
      (s) => ["submitted", "imported"].includes(s.state) && s.date <= today(),
    );
    periods.forEach((s, i) => {
      sheet.getCell(16, i + 5).value = eligible[i] ? 1 : 0;
      sheet.getCell(15, i + 5).note =
        `${s.date} · Period ${s.period} · ${s.state}. ${eligible[i] ? "Recorded marks count towards attendance." : "Excluded from attendance totals."}`;
    });
    const lastSessionCol = periods.length
      ? sheet.getColumn(attendedCol - 1).letter
      : null;
    students.forEach((s, i) => {
      const row = firstStudent + i;
      const values = periods.map((t) => marks.get(`${t.id}:${s.id}`) || "");
      sheet.getRow(row).values = [
        i + 1,
        s.campus_id,
        s.registration_number || "",
        s.name,
        ...values,
      ];
      sheet.getRow(row).height = 28;
      sheet.getCell(row, 2).numFmt = "@";
      sheet.getCell(row, 3).numFmt = "@";
      const total = values.filter(
        (v, k) => eligible[k] && ["P", "A", "L"].includes(v),
      ).length;
      const attended = values.filter(
        (v, k) => eligible[k] && ["P", "L"].includes(v),
      ).length;
      if (periods.length) {
        const range = `E${row}:${lastSessionCol}${row}`,
          flags = `$E$16:$${lastSessionCol}$16`;
        const count = (statuses) =>
          `SUMPRODUCT(${flags},${statuses.map((v) => `(${range}="${v}")`).join("+")})`;
        sheet.getCell(row, attendedCol).value = {
          formula: count(["P", "L"]),
          result: attended,
        };
        sheet.getCell(row, percentageCol).value = {
          formula: `IFERROR(${sheet.getCell(row, attendedCol).address}/${count(["P", "A", "L"])},"")`,
          result: total ? attended / total : "",
        };
      } else {
        sheet.getCell(row, attendedCol).value = 0;
        sheet.getCell(row, percentageCol).value = "";
      }
      sheet.getCell(row, percentageCol).numFmt = "0.0%";
    });
    for (let row = 15; row <= Math.max(lastStudent, 15); row++) {
      if (row === 16) continue;
      for (let col = 1; col <= percentageCol; col++) {
        const cell = sheet.getCell(row, col);
        cell.font = {
          name: "Arial",
          size: 10,
          bold: row === 15,
          color: { argb: "FF172D45" },
        };
        cell.border = {
          top: border,
          left: border,
          bottom: border,
          right: border,
        };
        cell.alignment = {
          horizontal: row > 15 && col === 4 ? "left" : "center",
          vertical: "middle",
          wrapText: true,
        };
        if (row === 15) cell.fill = fill("FFE4EDF8");
        if (row >= 17 && col >= 5 && col < attendedCol) {
          if (cell.value === "P" || cell.value === "L")
            cell.font.color = { argb: "FF17633B" };
          if (cell.value === "A") {
            cell.font.color = { argb: "FFA12622" };
            cell.fill = fill("FFFFEFED");
          }
          if (!eligible[col - 5]) cell.font.color = { argb: "FF69788B" };
        }
      }
    }
    const footerRow = Math.max(lastStudent + 2, 18);
    ["Total present / late", "Total absent"].forEach((label, i) => {
      const row = footerRow + i;
      sheet.mergeCells(row, 1, row, 4);
      sheet.getCell(row, 1).value = label;
      sheet.getRow(row).height = 24;
      periods.forEach((s, k) => {
        const col = k + 5,
          letter = sheet.getColumn(col).letter;
        const statuses = i === 0 ? ["P", "L"] : ["A"];
        const value = students.filter((st) =>
          statuses.includes(marks.get(`${s.id}:${st.id}`)),
        ).length;
        sheet.getCell(row, col).value = students.length
          ? {
              formula: `IF(${letter}$16=1,${statuses.map((v) => `COUNTIF(${letter}${firstStudent}:${letter}${lastStudent},"${v}")`).join("+")},"")`,
              result: eligible[k] ? value : "",
            }
          : "";
      });
      sheet.getRow(row).eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: "Arial", size: 10, bold: true };
        cell.fill = fill("FFF1F5FA");
        cell.alignment = {
          vertical: "middle",
          horizontal: cell.col <= 4 ? "left" : "center",
        };
      });
    });
    sheet.mergeCells(footerRow + 3, 1, footerRow + 3, percentageCol);
    sheet.getCell(footerRow + 3, 1).value =
      "P: Present · A: Absent · L: Late · Legacy N: Not enrolled (read-only). Only recorded attendance counts; drafts, future/cancelled sessions, N and blanks are excluded. Repeated day numbers are separate periods (see cell notes).";
    sheet.getCell(footerRow + 3, 1).font = {
      name: "Arial",
      size: 9,
      color: { argb: "FF526174" },
    };
    sheet.getCell(footerRow + 3, 1).alignment = {
      wrapText: true,
      vertical: "middle",
    };
    sheet.getRow(footerRow + 3).height = 40;
    sheet.pageSetup.printTitlesRow = "1:15";
    sheet.pageSetup.printArea = `A1:${lastCol}${footerRow + 3}`;
    sheet.headerFooter.oddFooter = "&L YENEPOYA UNIVERSITY&R Page &P of &N";
  }
  return wb.xlsx.writeBuffer();
}
