import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("customers");

const rows = [
  ["customer_id", "customer_tier", "last_order_status", "open_ticket_count", "refund_amount", "reason", "demo_note"],
  ["C-1042", "premium", "late_delivery", 1, 75, "late_delivery", "Safe baseline row: should ALLOW"],
  ["C-1042", "retention_experiment", "service_failure", 1, 480, "service_failure", "Risky row: new enum should require approval"],
  ["C-1042", "retention_experiment", "service_failure", 1, 40, "service_failure_followup", "After conditional approval under $50: should ALLOW"],
  ["C-2048", "standard", "delivered", 0, 20, "goodwill", "Extra normal customer"],
  ["C-9001", "enterprise", "open_escalation", 2, 250, "vip_escalation", "High value customer for optional demos"]
];

sheet.getRange("A1:G6").values = rows;

sheet.getRange("A1:G1").format.fill = { color: "#172033" };
sheet.getRange("A1:G1").format.font = { color: "#FFFFFF", bold: true };
sheet.getRange("A1:G6").format.borders = { preset: "all", style: "thin", color: "#D9E1EA" };
sheet.getRange("A1:G6").format.wrapText = true;
sheet.getRange("A:G").format.columnWidthPx = 155;
sheet.getRange("E:E").format.columnWidthPx = 110;
sheet.getRange("G:G").format.columnWidthPx = 280;
sheet.getRange("A1:G1").format.rowHeightPx = 28;
sheet.freezePanes.freezeRows(1);

sheet.getRange("I1:L1").merge();
sheet.getRange("I1:L1").values = [["TrustGate demo instructions"]];
sheet.getRange("I1:L1").format.fill = { color: "#EEF5FF" };
sheet.getRange("I1:L1").format.font = { bold: true, color: "#172033" };
sheet.getRange("I3:L8").values = [
  ["Step", "What to do", "Expected TrustGate result", "Why"],
  [1, "Sync this sheet with Fivetran", "fivetran_rest_live evidence", "Proves real partner data supply-chain evidence"],
  [2, "Use row 2", "ALLOW", "Known enum premium and small refund"],
  [3, "Use row 3", "APPROVAL_REQUIRED", "New enum retention_experiment is outside contract v1"],
  [4, "Conditional approve under $50", "Scoped approval created", "Shows graceful degradation"],
  [5, "Use row 4", "ALLOW", "Same risky enum, but amount is inside scoped approval"]
];
sheet.getRange("I3:L3").format.fill = { color: "#172033" };
sheet.getRange("I3:L3").format.font = { color: "#FFFFFF", bold: true };
sheet.getRange("I3:L8").format.borders = { preset: "all", style: "thin", color: "#D9E1EA" };
sheet.getRange("I:L").format.columnWidthPx = 190;
sheet.getRange("J:J").format.columnWidthPx = 260;
sheet.getRange("L:L").format.columnWidthPx = 320;
sheet.getRange("I1:L8").format.wrapText = true;

const outputDir = "outputs/trustgate_demo_sheet";
await fs.mkdir(outputDir, { recursive: true });

const inspect = await workbook.inspect({
  kind: "table",
  range: "customers!A1:G6",
  include: "values",
  tableMaxRows: 8,
  tableMaxCols: 8
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan"
});
console.log(errors.ndjson);

const preview = await workbook.render({ sheetName: "customers", range: "A1:L10", scale: 1 });
await fs.writeFile(`${outputDir}/TrustGate_Customers_Google_Sheets_preview.png`, new Uint8Array(await preview.arrayBuffer()));

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(`${outputDir}/TrustGate_Customers_Google_Sheets.xlsx`);
