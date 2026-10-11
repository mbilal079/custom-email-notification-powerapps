#!/usr/bin/env node
// Post-build fixes for the Email Hub forms. Run after build-model-app.js (idempotent):
//  - field labels: a column created in the same build can get its logical name as the form label
//    (e.g. "mb_brandcolor"); those are replaced with the column's display name
//  - Email Settings: inserts the Design studio (web resource mb_designstudio.html) at the top of the
//    Email Design tab; the form script mb_emailsetting.js connects it to the record
//
// Usage: node scripts/finalize-forms.js https://yourorg.crm.dynamics.com
"use strict";
const crypto = require("crypto");
const { dv } = require("./lib/dv");

const TABLES = ["mb_emailsetting", "mb_emailsignature", "mb_emailtemplate", "mb_recipientlist", "mb_recipientlistmember",
  "mb_emailmessage", "mb_emaildelivery", "mb_notificationrule"];
const STUDIO_ROWS = 26; // ~ 26 x 26px form rows: room for the controls and the preview

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function studioSection() {
  const id = () => crypto.randomUUID();
  const control = `<control id="WebResource_mb_designstudio" classid="{9FDF5F91-88B1-47f4-AD53-C11EFC01A01D}"><parameters>` +
    `<Url>mb_designstudio.html</Url><PassParameters>false</PassParameters><Security>false</Security><Scrolling>auto</Scrolling>` +
    `<Border>false</Border><ShowOnMobileClient>true</ShowOnMobileClient></parameters></control>`;
  return `<section id="{${id()}}" name="sec_studio" showlabel="false" showbar="false" visible="true" columns="1">` +
    `<labels><label description="Design studio" languagecode="1033" /></labels><rows>` +
    `<row><cell id="{${id()}}" showlabel="false" visible="true" colspan="1" rowspan="${STUDIO_ROWS}">` +
    `<labels><label description="Design studio" languagecode="1033" /></labels>${control}</cell></row>` +
    "<row />".repeat(STUDIO_ROWS - 1) + "</rows></section>";
}

(async () => {
  const env = process.argv[2];
  const published = [];
  for (const table of TABLES) {
    const attrs = (await dv(env, "GET", `EntityDefinitions(LogicalName='${table}')/Attributes?$select=LogicalName,DisplayName`)).data.value;
    const label = {};
    for (const a of attrs) {
      const l = a.DisplayName && a.DisplayName.UserLocalizedLabel && a.DisplayName.UserLocalizedLabel.Label;
      if (l) { label[a.LogicalName] = l; }
    }
    const forms = (await dv(env, "GET", `systemforms?$select=formid,name,formxml&$filter=objecttypecode eq '${table}' and (type eq 2 or type eq 7)`)).data.value;
    for (const f of forms) {
      let xml = f.formxml;
      let fixed = 0;
      xml = xml.replace(/<cell\b[^>]*>(?:(?!<\/cell>)[\s\S])*?<\/cell>/g, (cell) => {
        const field = (cell.match(/datafieldname="([^"]+)"/) || [])[1];
        if (!field || !label[field]) { return cell; }
        return cell.replace(new RegExp(`<label description="${field}" languagecode="(\\d+)" />`), (m, lc) => { fixed++; return `<label description="${esc(label[field])}" languagecode="${lc}" />`; });
      });
      let studio = false;
      if (table === "mb_emailsetting" && !xml.includes("WebResource_mb_designstudio")) {
        const tab = xml.indexOf('name="tab_design"');
        const at = tab < 0 ? -1 : xml.indexOf("<sections>", tab);
        if (at > 0) { xml = xml.slice(0, at + "<sections>".length) + studioSection() + xml.slice(at + "<sections>".length); studio = true; }
      }
      if (fixed || studio) {
        await dv(env, "PATCH", `systemforms(${f.formid})`, { formxml: xml });
        published.push(table);
        console.log(`${table} / ${f.name}: ${fixed} label(s) fixed${studio ? ", Design studio added" : ""}`);
      }
    }
  }
  const unique = [...new Set(published)];
  if (unique.length) {
    await dv(env, "POST", "PublishXml", { ParameterXml: `<importexportxml><entities>${unique.map((t) => `<entity>${t}</entity>`).join("")}</entities></importexportxml>` });
    console.log(`published ${unique.join(", ")}`);
  } else {
    console.log("forms are up to date");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
