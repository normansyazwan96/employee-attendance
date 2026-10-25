import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PayrollStatementView } from "./payroll-statements.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const INK = rgb(0.09, 0.08, 0.13);
const MUTED = rgb(0.38, 0.4, 0.47);
const BRAND = rgb(0.33, 0.2, 0.65);
const LIGHT = rgb(0.94, 0.94, 0.97);
const GREEN = rgb(0.08, 0.48, 0.33);
const RED = rgb(0.72, 0.13, 0.2);

function printable(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}

function fitText(value: string, font: PDFFont, size: number, maxWidth: number): string {
  const text = printable(value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened}...`;
}

export async function generatePayrollStatementPdf(statement: PayrollStatementView, language: "en" | "ms"): Promise<{ data: Uint8Array; fileName: string; contentType: string }> {
  const ms = language === "ms";
  const labels = ms ? {
    title: "Penyata pengiraan gaji", employee: "Pekerja", employeeNumber: "Nombor pekerja", period: "Tempoh gaji", item: "Butiran", amount: "Amaun", gross: "Gaji kasar", deductions: "Potongan pengiraan", employerContributions: "Caruman majikan", adjustmentEarnings: "Pendapatan pelarasan diluluskan", adjustmentDeductions: "Potongan pelarasan diluluskan", final: "Jumlah dikira akhir", note: "Dokumen ini ialah rekod pengiraan dan bukan bukti pembayaran.", generated: "Dijana", page: "Halaman", calculation: "Versi pengiraan",
  } : {
    title: "Payroll calculation statement", employee: "Employee", employeeNumber: "Employee number", period: "Pay period", item: "Description", amount: "Amount", gross: "Gross pay", deductions: "Calculated deductions", employerContributions: "Employer contributions", adjustmentEarnings: "Approved adjustment earnings", adjustmentDeductions: "Approved adjustment deductions", final: "Final calculated amount", note: "This document is a calculation record and is not proof of payment.", generated: "Generated", page: "Page", calculation: "Calculation version",
  };
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const money = (sen: number): string => `RM ${(sen / 100).toFixed(2)}`;
  const generatedAt = new Date();
  pdf.setTitle(`${labels.title} - ${statement.employee.firstName} ${statement.employee.lastName}`);
  pdf.setSubject(`${statement.period.name} payroll calculation record`);
  pdf.setAuthor("attend+");
  pdf.setCreator("attend+");
  pdf.setCreationDate(generatedAt);

  const pages: PDFPage[] = [];
  function addPage(): { page: PDFPage; y: number } {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 74, width: PAGE_WIDTH, height: 74, color: INK });
    page.drawText("attend+", { x: MARGIN, y: PAGE_HEIGHT - 43, size: 20, font: bold, color: rgb(1, 1, 1) });
    page.drawText(printable(labels.title), { x: MARGIN, y: PAGE_HEIGHT - 61, size: 9, font: regular, color: rgb(0.82, 0.82, 0.88) });
    return { page, y: PAGE_HEIGHT - 106 };
  }

  let { page, y } = addPage();
  page.drawText(fitText(statement.organizationName, bold, 15, PAGE_WIDTH - MARGIN * 2), { x: MARGIN, y, size: 15, font: bold, color: INK });
  y -= 27;
  const name = `${statement.employee.firstName} ${statement.employee.lastName}`;
  const employeeReference = statement.employee.employeeNumber ?? statement.employee.username;
  const meta = [
    [labels.employee, name],
    [labels.employeeNumber, employeeReference],
    [labels.period, `${statement.period.name} (${statement.period.startDate} - ${statement.period.endDate})`],
    [labels.calculation, `${statement.calculation.version} / ${statement.calculation.rulePackVersion}`],
  ];
  for (const [label, value] of meta) {
    page.drawText(printable(label), { x: MARGIN, y, size: 8, font: bold, color: MUTED });
    page.drawText(fitText(value, regular, 10, PAGE_WIDTH - MARGIN * 2 - 130), { x: MARGIN + 130, y: y - 1, size: 10, font: regular, color: INK });
    y -= 20;
  }
  y -= 10;

  function tableHeader(): void {
    page.drawRectangle({ x: MARGIN, y: y - 5, width: PAGE_WIDTH - MARGIN * 2, height: 24, color: LIGHT });
    page.drawText(printable(labels.item), { x: MARGIN + 8, y: y + 3, size: 9, font: bold, color: INK });
    const amountWidth = bold.widthOfTextAtSize(labels.amount, 9);
    page.drawText(printable(labels.amount), { x: PAGE_WIDTH - MARGIN - 8 - amountWidth, y: y + 3, size: 9, font: bold, color: INK });
    y -= 24;
  }
  tableHeader();

  const approvedAdjustments = statement.adjustments.filter((item) => item.status === "APPROVED");
  const rows = [
    ...statement.calculation.lines.map((line) => ({ name: line.name, amountSen: line.amountSen, tone: line.direction === "DEDUCTION" ? "deduction" as const : line.direction === "EMPLOYER_CONTRIBUTION" ? "employer" as const : "normal" as const, detail: line.code })),
    ...approvedAdjustments.map((item) => ({ name: item.name, amountSen: item.amountSen, tone: item.direction === "DEDUCTION" ? "deduction" as const : "normal" as const, detail: `${item.code}: ${item.reason}` })),
  ];
  for (const row of rows) {
    if (y < 118) {
      ({ page, y } = addPage());
      tableHeader();
    }
    page.drawText(fitText(row.name, regular, 9.5, PAGE_WIDTH - MARGIN * 2 - 150), { x: MARGIN + 8, y, size: 9.5, font: regular, color: INK });
    const amount = `${row.tone === "deduction" ? "-" : ""}${money(row.amountSen)}`;
    const amountWidth = bold.widthOfTextAtSize(amount, 9.5);
    page.drawText(amount, { x: PAGE_WIDTH - MARGIN - 8 - amountWidth, y, size: 9.5, font: bold, color: row.tone === "deduction" ? RED : row.tone === "employer" ? BRAND : INK });
    y -= 14;
    page.drawText(fitText(row.detail, regular, 7.5, PAGE_WIDTH - MARGIN * 2 - 24), { x: MARGIN + 8, y, size: 7.5, font: regular, color: MUTED });
    y -= 13;
    page.drawLine({ start: { x: MARGIN, y: y + 5 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 5 }, thickness: 0.5, color: LIGHT });
  }

  if (y < 202) ({ page, y } = addPage());
  y -= 10;
  const summaries: Array<[string, number, "normal" | "deduction" | "final"]> = [
    [labels.gross, statement.calculation.grossPaySen, "normal"],
    [labels.deductions, statement.calculation.totalDeductionsSen, "deduction"],
    [labels.employerContributions, statement.calculation.employerContributionsSen, "normal"],
    [labels.adjustmentEarnings, statement.adjustmentEarningsSen, "normal"],
    [labels.adjustmentDeductions, statement.adjustmentDeductionsSen, "deduction"],
    [labels.final, statement.finalCalculatedPaySen, "final"],
  ];
  for (const [label, amountSen, tone] of summaries) {
    if (tone === "final") page.drawRectangle({ x: MARGIN, y: y - 8, width: PAGE_WIDTH - MARGIN * 2, height: 30, color: rgb(0.94, 0.92, 0.99) });
    page.drawText(printable(label), { x: MARGIN + 8, y, size: tone === "final" ? 11 : 9.5, font: tone === "final" ? bold : regular, color: tone === "final" ? BRAND : INK });
    const amount = `${tone === "deduction" ? "-" : ""}${money(amountSen)}`;
    const amountWidth = bold.widthOfTextAtSize(amount, tone === "final" ? 11 : 9.5);
    page.drawText(amount, { x: PAGE_WIDTH - MARGIN - 8 - amountWidth, y, size: tone === "final" ? 11 : 9.5, font: bold, color: tone === "deduction" ? RED : tone === "final" ? BRAND : GREEN });
    y -= tone === "final" ? 34 : 22;
  }
  y -= 8;
  page.drawText(printable(labels.note), { x: MARGIN, y, size: 8.5, font: bold, color: MUTED });
  page.drawText(`${printable(labels.generated)}: ${generatedAt.toISOString()}  |  ID: ${printable(statement.id)}`, { x: MARGIN, y: y - 16, size: 7.5, font: regular, color: MUTED });

  pages.forEach((current, index) => {
    const footer = `${printable(labels.page)} ${index + 1} / ${pages.length}`;
    current.drawLine({ start: { x: MARGIN, y: 36 }, end: { x: PAGE_WIDTH - MARGIN, y: 36 }, thickness: 0.5, color: LIGHT });
    current.drawText(footer, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(footer, 7.5), y: 23, size: 7.5, font: regular, color: MUTED });
  });

  const safePeriod = statement.period.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "payroll";
  const safeEmployee = employeeReference.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "employee";
  return { data: await pdf.save(), fileName: `${safePeriod}-${safeEmployee}-statement.pdf`, contentType: "application/pdf" };
}
