#!/usr/bin/env node
// Reads the option values of the Choice columns the delivery flow depends on and writes
// flows/choice-values.json. Option values come from the publisher's option value prefix, so they are
// identical in every environment the solution is imported into; this file is safe to commit.
//
// Usage: node scripts/fetch-choice-values.js https://yourorg.crm.dynamics.com
"use strict";
const fs = require("fs");
const path = require("path");
const { dv } = require("./lib/dv");

const COLUMNS = {
  mb_emailmessage: ["mb_status", "mb_recipienttype", "mb_deliverymode", "mb_importance"],
  mb_emailsetting: ["mb_sendmode", "mb_deliverychannel", "mb_emaillayout"],
  mb_recipientlistmember: ["mb_membertype"],
  mb_emaildelivery: ["mb_deliverystatus", "mb_channel"],
  mb_notificationrule: ["mb_triggerevent", "mb_deliverymode"]
};

(async () => {
  const env = process.argv[2];
  const out = {};
  for (const [table, cols] of Object.entries(COLUMNS)) {
    out[table] = {};
    for (const col of cols) {
      const r = await dv(env, "GET",
        `EntityDefinitions(LogicalName='${table}')/Attributes(LogicalName='${col}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`);
      out[table][col] = {};
      for (const o of r.data.OptionSet.Options) {
        out[table][col][o.Label.UserLocalizedLabel.Label] = o.Value;
      }
    }
  }
  const sets = {};
  for (const table of Object.keys(COLUMNS).concat(["mb_emailsignature", "systemuser", "contact"])) {
    const r = await dv(env, "GET", `EntityDefinitions(LogicalName='${table}')?$select=EntitySetName`);
    sets[table] = r.data.EntitySetName;
  }
  out.entitySets = sets;
  const nav = {};
  for (const [table, rels] of Object.entries({ mb_emaildelivery: ["mb_emailmessageid"], mb_recipientlistmember: ["mb_userid", "mb_contactid"] })) {
    const r = await dv(env, "GET", `EntityDefinitions(LogicalName='${table}')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName`);
    for (const rel of r.data.value) {
      if (rels.includes(rel.ReferencingAttribute)) { nav[`${table}.${rel.ReferencingAttribute}`] = rel.ReferencingEntityNavigationPropertyName; }
    }
  }
  out.navigationProperties = nav;
  const file = path.join(__dirname, "..", "flows", "choice-values.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
