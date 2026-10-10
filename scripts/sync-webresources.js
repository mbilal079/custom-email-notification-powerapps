#!/usr/bin/env node
// Pushes the content of app/webresources/* to the matching web resources (the app-builder only creates web
// resources; it does not update existing ones) and publishes the changed ones.
//
// Usage: node scripts/sync-webresources.js https://yourorg.crm.dynamics.com
"use strict";
const fs = require("fs");
const path = require("path");
const { dv } = require("./lib/dv");

(async () => {
  const env = process.argv[2];
  const appDir = path.join(__dirname, "..", "app");
  const spec = JSON.parse(fs.readFileSync(path.join(appDir, "app-spec.json"), "utf8"));
  const changed = [];
  for (const wr of spec.webResources.filter((w) => w.contentPath)) {
    const content = fs.readFileSync(path.join(appDir, wr.contentPath)).toString("base64");
    const r = await dv(env, "GET", `webresourceset?$select=webresourceid,content&$filter=name eq '${wr.name}'`);
    const row = r.data.value[0];
    if (!row) { console.log(`missing (run the app build first): ${wr.name}`); continue; }
    if (row.content === content) { continue; }
    await dv(env, "PATCH", `webresourceset(${row.webresourceid})`, { content });
    changed.push(row.webresourceid);
    console.log(`updated ${wr.name}`);
  }
  if (changed.length) {
    const xml = `<importexportxml><webresources>${changed.map((id) => `<webresource>{${id}}</webresource>`).join("")}</webresources></importexportxml>`;
    await dv(env, "POST", "PublishXml", { ParameterXml: xml });
    console.log(`published ${changed.length} web resource(s)`);
  } else {
    console.log("web resources are up to date");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
