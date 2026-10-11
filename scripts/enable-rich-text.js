#!/usr/bin/env node
// Binds the model-driven Rich Text Editor control to the HTML columns on the Email Hub main forms,
// then publishes. Idempotent (a form whose field already has the control is left as is).
//
// Usage: node scripts/enable-rich-text.js https://yourorg.crm.dynamics.com
"use strict";
const crypto = require("crypto");
const { dv } = require("./lib/dv");

const TARGETS = {
  mb_emailmessage: ["mb_body"],
  mb_emailtemplate: ["mb_body", "mb_footer"],
  mb_emailsignature: ["mb_signaturehtml"],
  mb_emailsetting: ["mb_globalfooter"]
};
const MEMO_CLASSID = "{E0DECE4B-6FC8-4a8f-A065-082708572369}";
const RTE = "MscrmControls.RichTextEditor.RichTextEditorControl";

function description(uniqueId, field) {
  const params = `<parameters><datafieldname>${field}</datafieldname></parameters>`;
  return `<controlDescription forControl="${uniqueId}">` +
    `<customControl id="${MEMO_CLASSID}">${params}</customControl>` +
    [0, 1, 2].map((f) => `<customControl formFactor="${f}" name="${RTE}">${params}</customControl>`).join("") +
    "</controlDescription>";
}

(async () => {
  const env = process.argv[2];
  const touched = [];
  for (const [table, fields] of Object.entries(TARGETS)) {
    const forms = await dv(env, "GET", `systemforms?$select=formid,name,formxml&$filter=objecttypecode eq '${table}' and type eq 2`);
    for (const form of forms.data.value) {
      let xml = form.formxml;
      let changed = false;
      for (const field of fields) {
        const re = new RegExp(`<control\\b[^>]*datafieldname="${field}"[^>]*/?>`, "i");
        const m = xml.match(re);
        if (!m) { continue; }
        let control = m[0];
        let uid = (control.match(/uniqueid="([^"]+)"/i) || [])[1];
        if (!uid) {
          uid = `{${crypto.randomUUID()}}`;
          control = control.replace(/<control\b/i, `<control uniqueid="${uid}"`);
          xml = xml.replace(m[0], control);
        }
        if (xml.includes(`forControl="${uid}"`)) { continue; }
        const desc = description(uid, field);
        if (/<controlDescriptions>/i.test(xml)) {
          xml = xml.replace(/<\/controlDescriptions>/i, `${desc}</controlDescriptions>`);
        } else if (/<DisplayConditions\b/i.test(xml)) {
          xml = xml.replace(/<DisplayConditions\b/i, `<controlDescriptions>${desc}</controlDescriptions><DisplayConditions`);
        } else {
          xml = xml.replace(/<\/form>\s*$/i, `<controlDescriptions>${desc}</controlDescriptions></form>`);
        }
        changed = true;
      }
      if (changed) {
        await dv(env, "PATCH", `systemforms(${form.formid})`, { formxml: xml });
        console.log(`rich text editor enabled on ${table} form "${form.name}"`);
        touched.push(table);
      }
    }
  }
  if (touched.length) {
    const entities = [...new Set(touched)].map((t) => `<entity>${t}</entity>`).join("");
    await dv(env, "POST", "PublishXml", { ParameterXml: `<importexportxml><entities>${entities}</entities></importexportxml>` });
    console.log("published");
  } else {
    console.log("nothing to change");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
