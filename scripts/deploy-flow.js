#!/usr/bin/env node
// Creates (or updates) the solution's connection references and the Email Hub cloud flows in Dataverse,
// inside the EmailNotificationHub solution. Idempotent.
//
// Usage:
//   node scripts/deploy-flow.js <envUrl> [--dataverse-connection <id>] [--outlook-connection <id>] [--activate]
//
// Connection ids are environment-specific and are only ever passed on the command line - never committed.
"use strict";
const fs = require("fs");
const path = require("path");
const { dv } = require("./lib/dv");

const SOLUTION = "EmailNotificationHub";
// Fixed ids so re-deploys update the same flows.
const FLOWS = [
  { id: "3b7e5f2a-9c4d-4e61-8a5f-6d2b1c0e9f47", name: "Email Hub - Send via Outlook", file: "EmailHub-SendViaOutlook.json",
    description: "Sends the deliveries the Email Hub plug-in prepared for the Office 365 Outlook channel (own or shared mailbox)." },
  { id: "8c2d4e6f-1a3b-4c5d-9e7f-0b1a2c3d4e5f", name: "Email Hub - Release Scheduled Messages", file: "EmailHub-ReleaseScheduledMessages.json",
    description: "Every 15 minutes, re-queues Scheduled email messages whose Send After time has passed." }
];
const REFERENCES = [
  { logical: "mb_emailhubdataverse", display: "Email Hub - Dataverse", api: "shared_commondataserviceforapps", arg: "--dataverse-connection",
    description: "Reads email messages, settings, lists and writes the delivery log." },
  { logical: "mb_emailhuboutlook", display: "Email Hub - Office 365 Outlook", api: "shared_office365", arg: "--outlook-connection",
    description: "Sends the emails (own mailbox or shared mailbox)." }
];

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const env = process.argv[2];
  const sol = { "MSCRM.SolutionUniqueName": SOLUTION };

  for (const ref of REFERENCES) {
    const connectionid = argValue(ref.arg);
    const existing = await dv(env, "GET", `connectionreferences?$select=connectionreferenceid,connectionid&$filter=connectionreferencelogicalname eq '${ref.logical}'`);
    const body = {
      connectionreferencedisplayname: ref.display,
      connectorid: `/providers/Microsoft.PowerApps/apis/${ref.api}`,
      description: ref.description,
      ...(connectionid ? { connectionid } : {})
    };
    if (existing.data.value.length) {
      await dv(env, "PATCH", `connectionreferences(${existing.data.value[0].connectionreferenceid})`, body, sol);
      console.log(`updated connection reference ${ref.logical}${connectionid ? " (connection bound)" : ""}`);
    } else {
      await dv(env, "POST", "connectionreferences", { connectionreferencelogicalname: ref.logical, ...body }, sol);
      console.log(`created connection reference ${ref.logical}${connectionid ? " (connection bound)" : ""}`);
    }
  }

  for (const f of FLOWS) {
    const clientdata = fs.readFileSync(path.join(__dirname, "..", "flows", f.file), "utf8");
    const flow = { name: f.name, description: f.description, clientdata: JSON.stringify(JSON.parse(clientdata)) };
    let exists = true;
    try { await dv(env, "GET", `workflows(${f.id})?$select=statecode`); } catch (e) { if (e.status === 404) { exists = false; } else { throw e; } }
    if (exists) {
      // A flow must be off to change its definition.
      await dv(env, "PATCH", `workflows(${f.id})`, { statecode: 0, statuscode: 1 }, sol).catch(() => {});
      await dv(env, "PATCH", `workflows(${f.id})`, flow, sol);
      console.log(`updated flow "${f.name}"`);
    } else {
      await dv(env, "POST", "workflows", { workflowid: f.id, category: 5, type: 1, primaryentity: "none", ...flow }, sol);
      console.log(`created flow "${f.name}"`);
    }
    if (process.argv.includes("--activate")) {
      await dv(env, "PATCH", `workflows(${f.id})`, { statecode: 1, statuscode: 2 });
      console.log(`  turned on`);
    }
  }
  if (!process.argv.includes("--activate")) {
    console.log("flows left off - bind the connection references, then turn them on (or re-run with --activate)");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
