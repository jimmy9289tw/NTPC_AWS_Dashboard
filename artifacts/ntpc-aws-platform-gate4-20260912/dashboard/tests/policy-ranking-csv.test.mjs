import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  const [headers, ...values] = rows.filter((item) => item.some((value) => value !== ""));
  return values.map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index] ?? ""])));
}

test("district ranking CSV covers 29 districts, five years, four age bands and three sexes", async () => {
  const rows = parseCsv(await readFile(new URL("../data/policy-ranking/01_新北市29行政區青年指標排名.csv", import.meta.url), "utf8"));
  assert.equal(rows.length, 29 * 5 * 4 * 3);
  assert.equal(new Set(rows.map((row) => row.新北市行政區)).size, 29);
  assert.equal(new Set(rows.map((row) => row.民國年度)).size, 5);
  assert.equal(new Set(rows.map((row) => row.年齡層)).size, 4);
  assert.equal(new Set(rows.map((row) => row.性別)).size, 3);
  assert.equal("行政區服務人次" in rows[0], false);
  assert.ok(rows.every((row) => row.來源查核日期 === "2026-09-07"));
  assert.ok(rows.every((row) => row.政策分析可用性 !== "" && row.政策分析限制 !== ""));
});

test("citywide ranking CSV publishes only 18-35 youth wage rows and keeps missing values governed", async () => {
  const rows = parseCsv(await readFile(new URL("../data/policy-ranking/02_新北市全市青年指標年度與結構排名.csv", import.meta.url), "utf8"));
  const salary = rows.filter((row) => row.指標名稱 === "青年各行業全年總薪資平均數");
  assert.equal(salary.length, 19);
  assert.deepEqual([...new Set(salary.map((row) => row.年齡層))], ["18–35歲"]);
  assert.equal(salary.filter((row) => row.數值 !== "").length, 17);
  assert.equal(salary.filter((row) => row.數值 === "").length, 2);
  assert.ok(salary.filter((row) => row.數值 !== "").every((row) => Number(row.同類排名) >= 1 && Number(row.同類排名) <= 17));
  assert.ok(salary.filter((row) => row.數值 !== "").every((row) => row.同類項目數 === "17"));
  assert.ok(salary.some((row) => row.同類分位帶 === "前20%"));
  assert.ok(salary.some((row) => row.同類分位帶 === "後20%"));
  assert.ok(salary.every((row) => row.資料身分 === "模型估計值" || row.資料身分 === "資料缺口"));
  assert.ok(salary.every((row) => /113年薪資模型以114年全年齡行業人數/.test(row.限制說明)));
  const allSalaryRows = rows.filter((row) => row.資料主題.includes("薪資"));
  assert.ok(allSalaryRows.length > 0);
  assert.ok(allSalaryRows.every((row) => row.年齡層 === "18–35歲"));
  assert.equal(rows.some((row) => row.資料主題 === "114年工作場域薪資背景"), false);
});
