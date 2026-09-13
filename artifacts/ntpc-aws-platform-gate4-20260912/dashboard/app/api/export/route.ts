import { NextRequest, NextResponse } from "next/server";
import { buildSelectionRows, selectionRequiredFields, validateExportSelection } from "../../export-selection";
import { exportTopic } from "../../export-catalogue";
import { geographyLabel } from "../../dashboard-data";
import type { JointEducationMarriagePayload } from "../../joint-education-marriage";
import { dashboardData, type AgeBand, type Sex } from "../../dashboard-data";
import {
  buildDashboardExportRows,
  codeBookToCsv,
  exportCodeBook,
  rowsToCsv,
  universeLabels,
  type ExportUniverse,
} from "../../export-contract";

type ExportRequest = {
  selection?: unknown;
  kind?: "summary" | "data" | "codebook";
  universe?: ExportUniverse;
  year?: number;
  ageBand?: AgeBand;
  sex?: Sex;
  district?: string;
  fields?: string[];
};

const universes = new Set<ExportUniverse>(["registered", "labor", "wage"]);
const fieldCodes = new Set(exportCodeBook.map((field) => field.fieldCode));
const requiredFieldCodes = exportCodeBook.filter((field) => field.required).map((field) => field.fieldCode);

function csvResponse(filename: string, csv: string) {
  return new Response(csv, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

function invalid(message: string) {
  return NextResponse.json({ error: { code: "INVALID_EXPORT_REQUEST", message } }, { status: 400 });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("x-ntpc-access-role") !== "decision") {
    return NextResponse.json(
      { error: { code: "ACCESS_DENIED", message: "此功能限決策內網授權帳號使用。" } },
      { status: 403 },
    );
  }

  let input: ExportRequest;
  try {
    input = await request.json() as ExportRequest;
  } catch {
    return invalid("匯出條件格式錯誤。");
  }

  if (input.kind === "codebook") return csvResponse("新北青年儀表板_Code_Book.csv", codeBookToCsv());
  if (input.selection !== undefined) {
    let selection;
    try { selection = validateExportSelection(input.selection); } catch (error) { return invalid(error instanceof Error ? error.message : "篩選條件有誤。"); }
    if (input.kind !== "summary" && input.kind !== "data") return invalid("請指定預覽或下載。");
    try {
      const rows = await buildSelectionRows(selection, async district => {
        const geo = dashboardData.geographies.find(row => geographyLabel(row.name) === district)!;
        const path = district === "新北市" ? "/data/joint-education-marriage.json" : `/data/joint-education-marriage-districts/${geo.code}.json`;
        const response = await fetch(new URL(path, request.url));
        if (!response.ok) throw Error("交叉資料暫時無法載入，請稍後再試。");
        const payload = await response.json() as JointEducationMarriagePayload;
        if (geographyLabel(payload.meta.geography) !== district || !Array.isArray(payload.records)) throw Error("交叉資料地區與篩選條件不符。");
        return payload;
      });
      const topic = exportTopic(selection.topic)!;
      const requested = Array.isArray(input.fields) ? input.fields.filter(field => fieldCodes.has(field)) : [];
      const fields = [...new Set([...requiredFieldCodes, ...selectionRequiredFields(selection.topic), ...requested])];
      if (input.kind === "summary") return NextResponse.json({ count: rows.length, available: rows.filter(row => row.value != null).length, missing: rows.filter(row => row.value == null).length, preview: rows.slice(0, 8), fields, selection }, { headers: { "cache-control": "private, no-store" } });
      if (!rows.length) return invalid("目前條件沒有資料，請調整篩選範圍。");
      return csvResponse(`新北青年_${topic.label}_${selection.years.join("-")}年.csv`, rowsToCsv(rows, fields));
    } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "資料暫時無法讀取。" } }, { status: 502, headers: { "cache-control": "private, no-store" } }); }
  }
  if (!dashboardData.meta.years.includes(Number(input.year))) return invalid("年度不在可匯出範圍。");
  if (!dashboardData.meta.ageBands.includes(input.ageBand as AgeBand)) return invalid("年齡級距不在可匯出範圍。");
  if (!dashboardData.meta.sexes.includes(input.sex as Sex)) return invalid("性別不在可匯出範圍。");
  const district = typeof input.district === "string" && input.district.trim() ? input.district.trim() : "新北市";
  const rowsByUniverse = buildDashboardExportRows({
    year: Number(input.year),
    ageBand: input.ageBand as AgeBand,
    sex: input.sex as Sex,
    district,
  });

  if (input.kind === "summary") {
    return NextResponse.json({
      counts: Object.fromEntries(Object.entries(rowsByUniverse).map(([universe, rows]) => [universe, rows.length])),
    }, { headers: { "cache-control": "private, no-store" } });
  }
  if (input.kind !== "data" || !input.universe || !universes.has(input.universe)) return invalid("請指定一個有效母體。");
  const requestedFields = Array.isArray(input.fields) ? input.fields.filter((field) => fieldCodes.has(field)) : [];
  const selectedFields = [...new Set([...requiredFieldCodes, ...requestedFields])];
  const filename = `新北青年_${universeLabels[input.universe]}_${input.year}年_${input.ageBand}.csv`;
  return csvResponse(filename, rowsToCsv(rowsByUniverse[input.universe], selectedFields));
}
