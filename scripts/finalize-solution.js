#!/usr/bin/env node
// Adds components the app-builder leaves outside the solution (modern command bar buttons on
// mb_emailmessage) to EmailNotificationHub, then lists the solution's components for a final check.
//
// Usage: node scripts/finalize-solution.js https://yourorg.crm.dynamics.com
"use strict";
const { dv } = require("./lib/dv");

const SOLUTION = "EmailNotificationHub";

(async () => {
  const env = process.argv[2];
  const def = await dv(env, "GET", "solutioncomponentdefinitions?$select=solutioncomponenttype,primaryentityname&$filter=primaryentityname eq 'appaction'");
  if (!def.data.value.length) { throw new Error("appaction component type not found in this environment"); }
  const appActionType = def.data.value[0].solutioncomponenttype;

  const actions = await dv(env, "GET", "appactions?$select=appactionid,name,buttonlabeltext&$filter=contextvalue eq 'mb_emailmessage'");
  for (const a of actions.data.value) {
    await dv(env, "POST", "AddSolutionComponent", {
      ComponentId: a.appactionid, ComponentType: appActionType, SolutionUniqueName: SOLUTION,
      AddRequiredComponents: false, DoNotIncludeSubcomponents: false
    });
    console.log(`added command "${a.buttonlabeltext || a.name}" to ${SOLUTION}`);
  }

  const sol = await dv(env, "GET", `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION}'`);
  const comps = await dv(env, "GET", `solutioncomponents?$select=componenttype&$filter=_solutionid_value eq ${sol.data.value[0].solutionid}`);
  const counts = {};
  for (const c of comps.data.value) {
    const label = c["componenttype@OData.Community.Display.V1.FormattedValue"] || String(c.componenttype);
    counts[label] = (counts[label] || 0) + 1;
  }
  console.log("solution components:", counts);
})().catch((e) => { console.error(e.message); process.exit(1); });
