#!/usr/bin/env node
// Uploads plugins/EmailHub.Plugins (Release build) and registers its plug-in types and steps inside the
// EmailNotificationHub solution. Idempotent: existing assembly/types/steps are updated, not duplicated.
//
// Usage: node scripts/register-plugins.js https://yourorg.crm.dynamics.com [--fresh]
//
// --fresh unregisters the assembly (steps, types, assembly) first and registers it again, then re-saves active
// Notification Rules so their trigger steps are recreated. Use it when an in-place update does not take effect:
// Dataverse async hosts can keep running a cached copy of the previous build. Failed messages end with
// "[engine x.y.z.w]", which shows the build that processed them.
"use strict";
const fs = require("fs");
const path = require("path");
const { dv } = require("./lib/dv");

const SOLUTION = { "MSCRM.SolutionUniqueName": "EmailNotificationHub" };
const DLL = path.join(__dirname, "..", "plugins", "EmailHub.Plugins", "bin", "Release", "net462", "EmailHub.Plugins.dll");
const ASSEMBLY = "EmailHub.Plugins";
// Keep in step with <AssemblyVersion> in the csproj; bump the revision (last part) for in-place updates.
const VERSION = (fs.readFileSync(path.join(__dirname, "..", "plugins", "EmailHub.Plugins", "EmailHub.Plugins.csproj"), "utf8").match(/<AssemblyVersion>([^<]+)</) || [, "1.0.0.0"])[1];
const TYPES = ["ProcessEmailMessage", "SendDelivery", "FinalizeDelivery", "NotificationRuleManager", "NotificationRuleTrigger"];
const RULE_FIELDS = "mb_name,mb_isactive,mb_tablename,mb_triggerevent,mb_watchedcolumns,mb_emailcolumns,mb_lookupcolumns,mb_templateid," +
  "mb_sendtoowner,mb_sendtocreator,mb_recipientlistid,mb_additionaladdresses,statecode";

// stage: 20 pre-operation, 40 post-operation; mode: 0 sync, 1 async
const STEPS = [
  { type: "ProcessEmailMessage", message: "Create", table: "mb_emailmessage", stage: 40, mode: 1, name: "Email Hub: prepare queued message (create)" },
  { type: "ProcessEmailMessage", message: "Update", table: "mb_emailmessage", stage: 40, mode: 1, filter: "mb_status", name: "Email Hub: prepare queued message (update)" },
  { type: "SendDelivery", message: "Create", table: "mb_emaildelivery", stage: 40, mode: 1, name: "Email Hub: send delivery (Dataverse channel)" },
  { type: "FinalizeDelivery", message: "Update", table: "mb_emaildelivery", stage: 40, mode: 1, filter: "mb_deliverystatus", name: "Email Hub: settle delivery and message" },
  { type: "NotificationRuleManager", message: "Create", table: "mb_notificationrule", stage: 40, mode: 0, name: "Email Hub: register rule (create)" },
  { type: "NotificationRuleManager", message: "Update", table: "mb_notificationrule", stage: 40, mode: 0, filter: RULE_FIELDS, name: "Email Hub: register rule (update)" },
  { type: "NotificationRuleManager", message: "Delete", table: "mb_notificationrule", stage: 20, mode: 0, name: "Email Hub: unregister rule (delete)" }
];

const one = async (env, query) => (await dv(env, "GET", query)).data.value[0];

(async () => {
  const env = process.argv[2];
  const fresh = process.argv.includes("--fresh");
  if (!fs.existsSync(DLL)) { throw new Error(`Build the plug-in first: dotnet build plugins/EmailHub.Plugins -c Release (${DLL} not found)`); }
  const content = fs.readFileSync(DLL).toString("base64");

  let asm = await one(env, `pluginassemblies?$select=pluginassemblyid&$filter=name eq '${ASSEMBLY}'`);
  let activeRules = [];
  if (asm && fresh) {
    activeRules = (await dv(env, "GET", "mb_notificationrules?$select=mb_notificationruleid&$filter=mb_isactive eq true and statecode eq 0")).data.value;
    const types = (await dv(env, "GET", `plugintypes?$select=plugintypeid&$filter=_pluginassemblyid_value eq ${asm.pluginassemblyid}`)).data.value;
    for (const t of types) {
      const steps = (await dv(env, "GET", `sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid&$filter=_plugintypeid_value eq ${t.plugintypeid}`)).data.value;
      for (const st of steps) { await dv(env, "DELETE", `sdkmessageprocessingsteps(${st.sdkmessageprocessingstepid})`); }
      await dv(env, "DELETE", `plugintypes(${t.plugintypeid})`);
    }
    await dv(env, "DELETE", `pluginassemblies(${asm.pluginassemblyid})`);
    asm = null;
    console.log("unregistered previous assembly");
  }
  const asmBody = { name: ASSEMBLY, content, isolationmode: 2, sourcetype: 0, culture: "neutral", version: VERSION, description: "Email Notification Hub engine" };
  if (asm) {
    await dv(env, "PATCH", `pluginassemblies(${asm.pluginassemblyid})`, { content, version: VERSION }, SOLUTION);
    console.log("updated assembly");
  } else {
    const r = await dv(env, "POST", "pluginassemblies", asmBody, { ...SOLUTION, Prefer: "return=representation" });
    asm = r.data;
    console.log("created assembly");
  }

  const typeIds = {};
  for (const t of TYPES) {
    const typename = `EmailHub.Plugins.${t}`;
    let pt = await one(env, `plugintypes?$select=plugintypeid&$filter=typename eq '${typename}'`);
    if (!pt) {
      const r = await dv(env, "POST", "plugintypes", {
        typename, name: typename, friendlyname: t, description: `Email Notification Hub - ${t}`,
        "pluginassemblyid@odata.bind": `/pluginassemblies(${asm.pluginassemblyid})`
      }, { ...SOLUTION, Prefer: "return=representation" });
      pt = r.data;
      console.log(`created type ${t}`);
    }
    typeIds[t] = pt.plugintypeid;
  }

  for (const s of STEPS) {
    const msg = await one(env, `sdkmessages?$select=sdkmessageid&$filter=name eq '${s.message}'`);
    const filter = await one(env, `sdkmessagefilters?$select=sdkmessagefilterid&$filter=_sdkmessageid_value eq ${msg.sdkmessageid} and primaryobjecttypecode eq '${s.table}'`);
    const body = {
      name: s.name, description: s.name, stage: s.stage, mode: s.mode, rank: 1, supporteddeployment: 0,
      asyncautodelete: s.mode === 1,
      filteringattributes: s.filter || null,
      "plugintypeid@odata.bind": `/plugintypes(${typeIds[s.type]})`,
      "sdkmessageid@odata.bind": `/sdkmessages(${msg.sdkmessageid})`,
      "sdkmessagefilterid@odata.bind": `/sdkmessagefilters(${filter.sdkmessagefilterid})`
    };
    const existing = await one(env, `sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid&$filter=name eq '${s.name.replace(/'/g, "''")}'`);
    if (existing) {
      await dv(env, "PATCH", `sdkmessageprocessingsteps(${existing.sdkmessageprocessingstepid})`, body, SOLUTION);
      console.log(`updated step: ${s.name}`);
    } else {
      await dv(env, "POST", "sdkmessageprocessingsteps", body, SOLUTION);
      console.log(`created step: ${s.name}`);
    }
  }

  // Re-save active rules so NotificationRuleManager registers their trigger steps against the new types.
  for (const r of activeRules) {
    await dv(env, "PATCH", `mb_notificationrules(${r.mb_notificationruleid})`, { mb_isactive: true });
    console.log(`re-armed rule ${r.mb_notificationruleid}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
