#!/usr/bin/env node
// Post-build fix for the "Email Hub Overview" dashboard:
//  - gives every tile a real height (rowspan + spacer rows; the builder emits rowspan="1", which collapses tiles)
//  - binds list tiles to the solution's own views by name (the builder can pick a platform view with a similar name)
// Idempotent. Usage: node scripts/fix-dashboard.js https://yourorg.crm.dynamics.com
"use strict";
const { dv } = require("./lib/dv");

const DASHBOARD = "Email Hub Overview";
const CHART_ROWS = 12;
const LIST_ROWS = 14;
// tile label -> [table, view name] for list tiles
const LIST_VIEWS = {
  "My Email Messages": ["mb_emailmessage", "My Messages"],
  "My Messages": ["mb_emailmessage", "My Messages"],
  "Failed Deliveries": ["mb_emaildelivery", "Failed Deliveries"],
  "Queued and Sending": ["mb_emailmessage", "Queued and Sending"]
};

(async () => {
  const env = process.argv[2];
  const form = (await dv(env, "GET", `systemforms?$select=formid,formxml&$filter=type eq 0 and name eq '${DASHBOARD}'`)).data.value[0];
  if (!form) throw new Error(`dashboard '${DASHBOARD}' not found`);
  let xml = form.formxml.replace(/<row\s*\/>/g, ""); // drop old spacers so the fix can be re-run

  for (const [label, [table, view]] of Object.entries(LIST_VIEWS)) {
    const v = (await dv(env, "GET", `savedqueries?$select=savedqueryid&$filter=returnedtypecode eq '${table}' and name eq '${view}' and querytype eq 0`)).data.value[0];
    if (!v) continue;
    const cell = new RegExp(`(<label description="${label}"[\\s\\S]*?<ViewId>)[^<]+(</ViewId>)`);
    xml = xml.replace(cell, `$1${v.savedqueryid}$2`).replace(`<label description="${label}"`, `<label description="${view}"`);
  }

  // Each <row> holds two tiles; height = tallest tile in the row.
  xml = xml.replace(/<row>([\s\S]*?)<\/row>/g, (m, cells) => {
    const span = /<ChartGridMode>Grid<\/ChartGridMode>/.test(cells) ? LIST_ROWS : CHART_ROWS;
    const fixed = cells.replace(/rowspan="\d+"/g, `rowspan="${span}"`);
    return `<row>${fixed}</row>` + "<row />".repeat(span - 1);
  });

  await dv(env, "PATCH", `systemforms(${form.formid})`, { formxml: xml });
  await dv(env, "POST", "PublishXml", { ParameterXml: `<importexportxml><dashboards><dashboard>{${form.formid}}</dashboard></dashboards></importexportxml>` });
  console.log("dashboard layout fixed and published");
})().catch((e) => { console.error(e.message); process.exit(1); });
