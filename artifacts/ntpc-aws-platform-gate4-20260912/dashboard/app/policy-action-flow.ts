import type { PolicyContext } from "./policy-narrative";
import type { IntegratedPolicyCase } from "./policy-synthesis";
import { policyPrograms, programKpis, type ProgramOption } from "./policy-program-options";

// The selected issue owns its action state. An unrelated priority issue must
// not enable pilots for a monitoring or missing-data issue.
export function policyActionFlow(context: PolicyContext, item: IntegratedPolicyCase, selectedProgramId = "") {
  const programs = policyPrograms(context, item);
  const mode = item.state === "已觸發" ? "priority" : item.state === "無法判定" ? "missing" : "monitor";
  if (mode === "priority") {
    const program = programs.find(p => p.id === selectedProgramId) ?? programs[0];
    return { mode, programs, program, kpis: programKpis(program), timing: "初步建議6個月、2場次；實際規模另訂" } as const;
  }
  const program: ProgramOption & { mechanism: string; suitableFor: string; preparation: string } = {
    id: mode === "missing" ? "collect" : "current",
    title: mode === "missing" ? "補齊同條件資料" : "維持現行措施",
    action: mode === "missing"
      ? `先整理${item.topic}的同年度、同年齡資料及來源，取得可比較數值後重新分類。`
      : `維持現有服務安排，按原口徑追蹤${item.topic}；整理現行方案的使用量與需求回饋。`,
    outcome: mode === "missing" ? "建立可比較的資料基準。" : `掌握${item.topic}的變化與現行措施使用情形。`,
    sourceIds: [], metric: mode === "missing" ? "待補資料取得情形" : item.topic + "年度變化",
    formula: mode === "missing" ? "逐項記錄已取得／待更新的年度、年齡、性別及來源。" : item.chart.method,
    frequency: "依官方資料發布更新", agencies: item.agencies,
    mechanism: mode === "missing" ? "資料整理" : "持續監測",
    suitableFor: "", preparation: "彙整承辦窗口、資料來源與更新日期。",
  };
  const kpis = mode === "missing"
    ? [{ metric: program.metric, formula: program.formula, source: "原資料來源與承辦紀錄", frequency: program.frequency }]
    : [{ metric: program.metric, formula: program.formula, source: item.chart.sources.map(s => s.name).join("、"), frequency: program.frequency },
      { metric: "現行措施使用量與需求回饋", formula: "按現行方案分列報名、到場或諮詢人次，彙整使用者自願回饋。", source: "既有方案服務紀錄", frequency: "依方案原有彙整週期" }];
  return { mode, programs, program, kpis, timing: "依既有服務及資料更新週期；未設定試辦場次" } as const;
}
