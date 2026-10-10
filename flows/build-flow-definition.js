#!/usr/bin/env node
// Generates the "Email Hub - Process Email Message" cloud flow definition (Power Automate / Logic Apps
// workflow JSON) from flows/choice-values.json. Output: flows/EmailHub-ProcessEmailMessage.json
//
// Usage: node flows/build-flow-definition.js
"use strict";
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "choice-values.json"), "utf8"));
const STATUS = cfg.mb_emailmessage.mb_status;
const SEND_TO = cfg.mb_emailmessage.mb_recipienttype;
const MODE = cfg.mb_emailmessage.mb_deliverymode;
const SEND_FROM = cfg.mb_emailsetting.mb_sendmode;
const MEMBER = cfg.mb_recipientlistmember.mb_membertype;
const DELIVERY = cfg.mb_emaildelivery.mb_deliverystatus;
const SETS = cfg.entitySets;
const NAV = cfg.navigationProperties;

const DV = "shared_commondataserviceforapps";
const O365 = "shared_office365";
const CONNECTION_REFERENCES = {
  [DV]: "mb_emailhubdataverse",
  [O365]: "mb_emailhuboutlook"
};

// ---------- small builders ----------
const auth = "@parameters('$authentication')";
function host(conn, op) { return { connectionName: conn, operationId: op, apiId: `/providers/Microsoft.PowerApps/apis/${conn}` }; }
function dvOp(op, parameters, runAfter, extra) {
  return { type: "OpenApiConnection", inputs: { host: host(DV, op), parameters, authentication: auth }, runAfter: runAfter || {}, ...(extra || {}) };
}
function after(name, statuses) { return name ? { [name]: statuses || ["Succeeded"] } : {}; }
function chain(actions) {
  // actions: [[name, action], ...] -> sequential runAfter, first one keeps its own runAfter
  const out = {};
  let prev = null;
  for (const [name, a] of actions) {
    if (prev && (!a.runAfter || Object.keys(a.runAfter).length === 0)) { a.runAfter = after(prev); }
    if (!a.runAfter) { a.runAfter = {}; }
    out[name] = a;
    prev = name;
  }
  return out;
}
function compose(inputs, runAfter) { return { type: "Compose", inputs, runAfter: runAfter || {} }; }
function setVar(name, value) { return { type: "SetVariable", inputs: { name, value } }; }
function appendArr(name, value) { return { type: "AppendToArrayVariable", inputs: { name, value } }; }
function appendStr(name, value) { return { type: "AppendToStringVariable", inputs: { name, value } }; }
function incr(name, value) { return { type: "IncrementVariable", inputs: { name, value: value === undefined ? 1 : value } }; }
function cond(expression, actions, elseActions, runAfter) {
  return { type: "If", expression, actions: actions || {}, else: { actions: elseActions || {} }, runAfter: runAfter || {} };
}
function forEach(items, actions, sequential, runAfter) {
  return { type: "Foreach", foreach: items, actions, runAfter: runAfter || {},
    ...(sequential ? { runtimeConfiguration: { concurrency: { repetitions: 1 } } } : {}) };
}
const ANY = ["Succeeded", "Failed", "Skipped", "TimedOut"];
function scope(actions, runAfter) { return { type: "Scope", actions, runAfter: runAfter || {} }; }

// ---------- shared expressions ----------
const msg = (f) => `outputs('Get_Message')?['body/${f}']`;
const S = (f) => `outputs('Settings')?['${f}']`;
const messageId = "triggerOutputs()?['body/mb_emailmessageid']";
const ownerBind = `concat(if(equals(${msg("_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname")},'team'),'/teams(','/systemusers('),${msg("_ownerid_value")},')')`;
const isShared = `equals(${S("sendMode")}, ${SEND_FROM["Shared Mailbox"]})`;

// Token replacement. r = recipient object expression, or null (single email: recipient tokens are blank).
function tokens(source, r) {
  const rv = (k) => (r ? `coalesce(${r}?['${k}'],'')` : "''");
  const pairs = [
    ["{{FirstName}}", rv("firstName")],
    ["{{LastName}}", rv("lastName")],
    ["{{FullName}}", rv("fullName")],
    ["{{Email}}", rv("email")],
    ["{{Company}}", rv("company")],
    ["{{JobTitle}}", rv("jobTitle")],
    ["{{SenderName}}", "coalesce(outputs('Get_Sender')?['body/fullname'],'')"],
    ["{{SenderEmail}}", "coalesce(outputs('Get_Sender')?['body/internalemailaddress'],'')"],
    ["{{SenderJobTitle}}", "coalesce(outputs('Get_Sender')?['body/jobtitle'],'')"],
    ["{{OrganizationName}}", `coalesce(${S("org")},'')`],
    ["{{Today}}", "formatDateTime(utcNow(),'yyyy-MM-dd')"],
    ["{{Signature}}", "''"]
  ];
  let e = `coalesce(${source},'')`;
  for (const [t, v] of pairs) { e = `replace(${e},'${t}',${v})`; }
  return e;
}
const testPrefix = (realTo) => `if(${S("testMode")}, concat('[TEST to ', ${realTo}, '] '), '')`;
const nullIfEmpty = (e) => `if(empty(${e}), null, ${e})`;
const ccExpr = `if(${S("testMode")}, null, ${nullIfEmpty(`coalesce(${msg("mb_ccaddresses")},'')`)})`;
const bccRaw = `concat(if(${S("testMode")}, '', coalesce(${msg("mb_bccaddresses")},'')), if(or(empty(coalesce(${msg("mb_bccaddresses")},'')), empty(${S("archiveBcc")}), ${S("testMode")}), '', ';'), ${S("archiveBcc")})`;
const bccExpr = nullIfEmpty(bccRaw);
const importance = `coalesce(${msg("mb_importance@OData.Community.Display.V1.FormattedValue")},'Normal')`;

// Send block: tries the configured mailbox and records the outcome in vOutcome / vOutcomeError.
function sendBlock(sfx, toExpr, subjectExpr, bodyExpr) {
  const common = {
    "emailMessage/To": `@{${toExpr}}`,
    "emailMessage/Subject": `@{${subjectExpr}}`,
    "emailMessage/Body": `@{${bodyExpr}}`,
    "emailMessage/Cc": `@${ccExpr}`,
    "emailMessage/Bcc": `@${bccExpr}`,
    "emailMessage/Importance": `@{${importance}}`,
    "emailMessage/ReplyTo": `@${nullIfEmpty(S("replyTo"))}`
  };
  const sendShared = { type: "OpenApiConnection", runAfter: {}, inputs: {
    host: host(O365, "SharedMailboxSendEmailV2"),
    parameters: { "emailMessage/MailboxAddress": `@{${S("sharedMailbox")}}`, ...common }, authentication: auth } };
  const sendOwner = { type: "OpenApiConnection", runAfter: {}, inputs: {
    host: host(O365, "SendEmailV2"), parameters: common, authentication: auth } };
  const errOf = (scopeName) => `coalesce(first(result('${scopeName}'))?['outputs']?['body']?['error']?['message'], first(result('${scopeName}'))?['outputs']?['body']?['message'], first(result('${scopeName}'))?['error']?['message'], 'The mail server rejected the message.')`;
  const branch = (kind, sendAction) => chain([
    [`Try_Send_${kind}_${sfx}`, scope({ [`Send_${kind}_${sfx}`]: sendAction })],
    [`Mark_Sent_${kind}_${sfx}`, { ...setVar("vOutcome", "Sent"), runAfter: after(`Try_Send_${kind}_${sfx}`) }],
    [`Mark_Failed_${kind}_${sfx}`, { ...setVar("vOutcomeError", `@{${errOf(`Try_Send_${kind}_${sfx}`)}}`), runAfter: after(`Try_Send_${kind}_${sfx}`, ["Failed", "TimedOut"]) }]
  ]);
  return chain([
    [`Reset_Outcome_${sfx}`, setVar("vOutcome", "Failed")],
    [`Reset_Error_${sfx}`, setVar("vOutcomeError", "")],
    [`Use_Shared_Mailbox_${sfx}`, cond(`@${isShared}`, branch("Shared", sendShared), branch("Owner", sendOwner))]
  ]);
}

function logDelivery(sfx, statusValue, emailExpr, nameExpr, subjectExpr, errorExpr) {
  return cond(`@equals(${S("log")}, true)`, {
    [`Create_Delivery_${sfx}`]: dvOp("CreateRecord", {
      entityName: SETS.mb_emaildelivery,
      "item/mb_name": `@{take(coalesce(${emailExpr},'(no address)'), 320)}`,
      "item/mb_recipientname": `@{take(coalesce(${nameExpr},''), 200)}`,
      "item/mb_deliverystatus": statusValue,
      "item/mb_subjectsent": `@{take(coalesce(${subjectExpr},''), 400)}`,
      "item/mb_errordetail": `@{take(coalesce(${errorExpr},''), 10000)}`,
      "item/mb_sentat": "@utcNow()",
      [`item/${NAV["mb_emaildelivery.mb_emailmessageid"]}@odata.bind`]: `@{concat('/${SETS.mb_emailmessage}(', ${messageId}, ')')}`,
      "item/ownerid@odata.bind": `@{${ownerBind}}`
    })
  });
}

// Records the outcome of one send for one recipient (counts + delivery row).
function recordOutcome(sfx, emailExpr, nameExpr, subjectExpr) {
  return cond("@equals(variables('vOutcome'), 'Sent')",
    chain([
      [`Count_Sent_${sfx}`, incr("vSent")],
      [`Log_Sent_${sfx}`, logDelivery(`Sent_${sfx}`, DELIVERY.Sent, emailExpr, nameExpr, subjectExpr, "''")]
    ]),
    chain([
      [`Count_Failed_${sfx}`, incr("vFailed")],
      [`Note_Error_${sfx}`, appendStr("vErrors", `@{concat(${emailExpr}, ': ', variables('vOutcomeError'), ' | ')}`)],
      [`Log_Failed_${sfx}`, logDelivery(`Failed_${sfx}`, DELIVERY.Failed, emailExpr, nameExpr, subjectExpr, "variables('vOutcomeError')")]
    ]));
}

// Stops the run with a clear message on the Email Message.
function failAndStop(sfx, messageExpr) {
  return chain([
    [`Mark_Message_Failed_${sfx}`, dvOp("UpdateRecord", {
      entityName: SETS.mb_emailmessage, recordId: `@${messageId}`,
      "item/mb_status": STATUS.Failed, "item/mb_lasterror": `@{${messageExpr}}`
    })],
    [`Stop_${sfx}`, { type: "Terminate", inputs: { runStatus: "Failed", runError: { code: "EmailHub", message: `@{${messageExpr}}` } } }]
  ]);
}

// Candidate recipient object.
function candidate({ email, first, last, full, company, job, internal, skip }) {
  return {
    email: `@${email}`, firstName: `@${first}`, lastName: `@${last}`, fullName: `@${full}`,
    company: `@${company}`, jobTitle: `@${job}`, internal, skipReason: `@${skip}`
  };
}
const c = (e) => `coalesce(${e},'')`;

// ---------- recipient expansion ----------
const M = "items('For_Each_Member')";
const optedOut = `if(equals(${M}?['mb_optedout'], true), 'Opted out', '')`;
const userNav = NAV["mb_recipientlistmember.mb_userid"];
const contactNav = NAV["mb_recipientlistmember.mb_contactid"];
const userSelect = "fullname,firstname,lastname,internalemailaddress,jobtitle,isdisabled";

const teamFetch = (teamIdExpr) =>
  "<fetch><entity name=\"systemuser\"><attribute name=\"fullname\"/><attribute name=\"firstname\"/><attribute name=\"lastname\"/>" +
  "<attribute name=\"internalemailaddress\"/><attribute name=\"jobtitle\"/><filter><condition attribute=\"isdisabled\" operator=\"eq\" value=\"0\"/></filter>" +
  "<link-entity name=\"teammembership\" from=\"systemuserid\" to=\"systemuserid\" intersect=\"true\"><filter>" +
  `<condition attribute="teamid" operator="eq" value="@{${teamIdExpr}}"/></filter></link-entity></entity></fetch>`;

const memberSwitch = {
  type: "Switch", expression: `@${M}?['mb_membertype']`, runAfter: {},
  cases: {
    Member_User: { case: MEMBER.User, actions: { Add_Member_User: appendArr("vCandidates", candidate({
      email: c(`${M}?['${userNav}']?['internalemailaddress']`), first: c(`${M}?['${userNav}']?['firstname']`),
      last: c(`${M}?['${userNav}']?['lastname']`), full: c(`${M}?['${userNav}']?['fullname']`), company: c(`${M}?['mb_company']`),
      job: c(`${M}?['${userNav}']?['jobtitle']`), internal: true,
      skip: `if(equals(${M}?['${userNav}']?['isdisabled'], true), 'User is disabled', ${optedOut})` })) } },
    Member_Contact: { case: MEMBER.Contact, actions: { Add_Member_Contact: appendArr("vCandidates", candidate({
      email: c(`${M}?['${contactNav}']?['emailaddress1']`), first: c(`${M}?['${contactNav}']?['firstname']`),
      last: c(`${M}?['${contactNav}']?['lastname']`), full: c(`${M}?['${contactNav}']?['fullname']`), company: c(`${M}?['mb_company']`),
      job: c(`${M}?['${contactNav}']?['jobtitle']`), internal: false, skip: optedOut })) } },
    Member_Team: { case: MEMBER.Team, actions: chain([
      ["List_Team_Users", dvOp("ListRecords", { entityName: SETS.systemuser, fetchXml: teamFetch(`${M}?['_mb_teamid_value']`) }, {},
        { runtimeConfiguration: { paginationPolicy: { minimumItemCount: 5000 } } })],
      ["For_Each_Team_User", forEach("@outputs('List_Team_Users')?['body/value']", {
        Add_Team_User: appendArr("vCandidates", candidate({
          email: c("items('For_Each_Team_User')?['internalemailaddress']"), first: c("items('For_Each_Team_User')?['firstname']"),
          last: c("items('For_Each_Team_User')?['lastname']"), full: c("items('For_Each_Team_User')?['fullname']"), company: "''",
          job: c("items('For_Each_Team_User')?['jobtitle']"), internal: true, skip: optedOut }))
      }, true)]
    ]) },
    Member_External: { case: MEMBER["External Email"], actions: { Add_Member_External: appendArr("vCandidates", candidate({
      email: c(`${M}?['mb_emailaddress']`), first: c(`${M}?['mb_firstname']`), last: c(`${M}?['mb_lastname']`),
      full: `if(empty(trim(concat(${c(`${M}?['mb_firstname']`)},' ',${c(`${M}?['mb_lastname']`)}))), ${c(`${M}?['mb_name']`)}, trim(concat(${c(`${M}?['mb_firstname']`)},' ',${c(`${M}?['mb_lastname']`)})))`,
      company: c(`${M}?['mb_company']`), job: "''", internal: false, skip: optedOut })) } }
  },
  default: { actions: {} }
};

const normalizedAddresses = `replace(replace(replace(replace(${c(msg("mb_toaddresses"))},',',';'),decodeUriComponent('%0A'),';'),decodeUriComponent('%0D'),';'),' ',';')`;

const expandSwitch = {
  type: "Switch", expression: `@${msg("mb_recipienttype")}`, runAfter: {},
  cases: {
    To_User: { case: SEND_TO["Single User"], actions: chain([
      ["Get_To_User", dvOp("GetItem", { entityName: SETS.systemuser, recordId: `@${msg("_mb_touserid_value")}`, $select: userSelect })],
      ["Add_To_User", appendArr("vCandidates", candidate({
        email: c("outputs('Get_To_User')?['body/internalemailaddress']"), first: c("outputs('Get_To_User')?['body/firstname']"),
        last: c("outputs('Get_To_User')?['body/lastname']"), full: c("outputs('Get_To_User')?['body/fullname']"), company: "''",
        job: c("outputs('Get_To_User')?['body/jobtitle']"), internal: true,
        skip: "if(equals(outputs('Get_To_User')?['body/isdisabled'], true), 'User is disabled', '')" }))]
    ]) },
    To_Contact: { case: SEND_TO["Single Contact"], actions: chain([
      ["Get_To_Contact", dvOp("GetItem", { entityName: SETS.contact, recordId: `@${msg("_mb_tocontactid_value")}`,
        $select: "fullname,firstname,lastname,emailaddress1,jobtitle,_parentcustomerid_value" })],
      ["Add_To_Contact", appendArr("vCandidates", candidate({
        email: c("outputs('Get_To_Contact')?['body/emailaddress1']"), first: c("outputs('Get_To_Contact')?['body/firstname']"),
        last: c("outputs('Get_To_Contact')?['body/lastname']"), full: c("outputs('Get_To_Contact')?['body/fullname']"),
        company: c("outputs('Get_To_Contact')?['body/_parentcustomerid_value@OData.Community.Display.V1.FormattedValue']"),
        job: c("outputs('Get_To_Contact')?['body/jobtitle']"), internal: false, skip: "''" }))]
    ]) },
    To_List: { case: SEND_TO["Recipient List"], actions: chain([
      ["List_Members", dvOp("ListRecords", {
        entityName: SETS.mb_recipientlistmember,
        $filter: `_mb_listid_value eq @{${msg("_mb_recipientlistid_value")}} and statecode eq 0`,
        $expand: `${userNav}($select=${userSelect}),${contactNav}($select=fullname,firstname,lastname,emailaddress1,jobtitle)`
      }, {}, { runtimeConfiguration: { paginationPolicy: { minimumItemCount: 5000 } } })],
      ["For_Each_Member", forEach("@outputs('List_Members')?['body/value']", { Member_Type: memberSwitch }, true)]
    ]) },
    To_Addresses: { case: SEND_TO["Email Addresses"], actions: {
      For_Each_Address: forEach(`@split(${normalizedAddresses}, ';')`, {
        Address_Not_Blank: cond("@not(empty(trim(items('For_Each_Address'))))", {
          Add_Address: appendArr("vCandidates", candidate({
            email: "trim(items('For_Each_Address'))", first: "''", last: "''", full: "trim(items('For_Each_Address'))",
            company: "''", job: "''", internal: false, skip: "''" }))
        })
      }, true)
    } }
  },
  default: { actions: {} }
};

// ---------- validation / de-duplication ----------
const V = "items('Validate_Recipients')";
const E = "outputs('Clean_Email')";
const skipReason =
  `if(not(empty(coalesce(${V}?['skipReason'],''))), ${V}?['skipReason'], ` +
  `if(empty(${E}), 'No email address', ` +
  `if(not(and(equals(length(split(${E},'@')),2), greater(length(first(split(${E},'@'))),0), contains(last(split(${E},'@')),'.'), not(contains(${E},' ')))), 'Invalid email address', ` +
  `if(contains(variables('vSeen'), concat('|',${E},'|')), 'DUPLICATE', ` +
  `if(and(not(equals(${V}?['internal'], true)), not(equals(${S("allowExternal")}, true))), 'External recipients are not allowed', ` +
  `if(and(not(equals(${V}?['internal'], true)), not(empty(${S("domains")})), not(contains(concat(';',${S("domains")},';'), concat(';',last(split(${E},'@')),';')))), 'Domain not allowed', ''))))))`;

const validateLoop = forEach("@variables('vCandidates')", chain([
  ["Clean_Email", compose(`@toLower(trim(coalesce(${V}?['email'],'')))`)],
  ["Skip_Reason", compose(`@${skipReason}`)],
  ["Is_Valid", cond("@equals(outputs('Skip_Reason'), '')",
    chain([
      ["Keep_Recipient", appendArr("vRecipients", `@setProperty(${V}, 'email', ${E})`)],
      ["Remember_Address", appendStr("vSeen", `@{concat(${E}, '|')}`)]
    ]),
    { Not_Duplicate: cond("@not(equals(outputs('Skip_Reason'), 'DUPLICATE'))", {
      Keep_Skipped: appendArr("vSkipped", `@setProperty(setProperty(${V}, 'skipReason', outputs('Skip_Reason')), 'email', ${E})`)
    }) })]
]), true);

// ---------- sending ----------
const R = "items('Send_Each')";
const personalized = forEach("@variables('vRecipients')", {
  ...chain([
    ["Personal_Subject", compose(`@{concat(${testPrefix(`${R}?['email']`)}, ${tokens(msg("mb_name"), R)})}`)],
    ["Personal_Body", compose(`@{${tokens("outputs('Assembled_Body')", R)}}`)],
    ["Send_Personal", { type: "Scope", actions: sendBlock("P",
      `if(${S("testMode")}, ${S("testRecipient")}, ${R}?['email'])`,
      "outputs('Personal_Subject')", "outputs('Personal_Body')"), runAfter: {} }],
    ["Record_Personal", { ...recordOutcome("P", `${R}?['email']`, `${R}?['fullName']`, "outputs('Personal_Subject')"),
      runAfter: after("Send_Personal", ["Succeeded", "Failed", "TimedOut", "Skipped"]) }]
  ])
}, true);

const allEmails = "join(body('Select_Emails'), ';')";
const single = chain([
  ["Select_Emails", { type: "Select", inputs: { from: "@variables('vRecipients')", select: "@item()?['email']" } }],
  ["Single_Subject", compose(`@{concat(${testPrefix(allEmails)}, ${tokens(msg("mb_name"), null)})}`)],
  ["Single_Body", compose(`@{${tokens("outputs('Assembled_Body')", null)}}`)],
  ["Send_Single", { type: "Scope", actions: sendBlock("S",
    `if(${S("testMode")}, ${S("testRecipient")}, ${allEmails})`, "outputs('Single_Subject')", "outputs('Single_Body')"), runAfter: {} }],
  ["Record_Single", { ...forEach("@variables('vRecipients')", {
    Record_Single_Recipient: recordOutcome("S", "items('Record_Single')?['email']", "items('Record_Single')?['fullName']", "outputs('Single_Subject')")
  }, true), runAfter: after("Send_Single", ["Succeeded", "Failed", "TimedOut", "Skipped"]) }]
]);

// ---------- main body ----------
const firstSetting = "first(outputs('List_Settings')?['body/value'])";
const tryActions = chain([
  ["List_Settings", dvOp("ListRecords", { entityName: SETS.mb_emailsetting, $filter: "mb_isactive eq true and statecode eq 0", $orderby: "createdon asc", $top: 1 })],
  ["Settings", compose({
    sendMode: `@coalesce(${firstSetting}?['mb_sendmode'], ${SEND_FROM["Flow Owner Mailbox"]})`,
    sharedMailbox: `@coalesce(${firstSetting}?['mb_sharedmailbox'], '')`,
    replyTo: `@coalesce(${firstSetting}?['mb_replyto'], '')`,
    org: `@coalesce(${firstSetting}?['mb_organizationname'], '')`,
    footer: `@coalesce(${firstSetting}?['mb_globalfooter'], '')`,
    max: `@coalesce(${firstSetting}?['mb_maxrecipients'], 500)`,
    allowExternal: `@coalesce(${firstSetting}?['mb_allowexternal'], true)`,
    domains: `@toLower(replace(replace(coalesce(${firstSetting}?['mb_alloweddomains'], ''), ' ', ''), ',', ';'))`,
    testMode: `@coalesce(${firstSetting}?['mb_testmode'], false)`,
    testRecipient: `@coalesce(${firstSetting}?['mb_testrecipient'], '')`,
    archiveBcc: `@coalesce(${firstSetting}?['mb_archivebcc'], '')`,
    log: `@coalesce(${firstSetting}?['mb_logdelivery'], true)`,
    defaultSignatureId: `@coalesce(${firstSetting}?['_mb_defaultsignatureid_value'], '')`
  })],
  ["Config_Error", compose(`@if(and(${S("testMode")}, empty(${S("testRecipient")})), 'Test Mode is on but no Test Mode Recipient is set in Email Settings.', if(and(${isShared}, empty(${S("sharedMailbox")})), 'Send From is Shared Mailbox but no Shared Mailbox Address is set in Email Settings.', ''))`)],
  ["Check_Config", cond("@not(empty(outputs('Config_Error')))", failAndStop("Config", "outputs('Config_Error')"))],
  ["Wait_If_Scheduled", cond(`@and(not(empty(triggerOutputs()?['body/mb_scheduledon'])), greater(ticks(coalesce(triggerOutputs()?['body/mb_scheduledon'], utcNow())), ticks(utcNow())))`,
    { Wait_Until_Send_After: { type: "Wait", inputs: { until: { timestamp: "@{triggerOutputs()?['body/mb_scheduledon']}" } }, runAfter: {} } })],
  ["Get_Message", dvOp("GetItem", { entityName: SETS.mb_emailmessage, recordId: `@${messageId}` })],
  ["Get_Sender", dvOp("GetItem", { entityName: SETS.systemuser,
    recordId: `@if(equals(${msg("_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname")}, 'systemuser'), ${msg("_ownerid_value")}, ${msg("_createdby_value")})`,
    $select: "fullname,internalemailaddress,jobtitle" })],
  ["Signature_Id", compose(`@if(equals(${msg("mb_includesignature")}, false), '', coalesce(${msg("_mb_signatureid_value")}, ${S("defaultSignatureId")}, ''))`)],
  ["Load_Signature", cond("@not(empty(outputs('Signature_Id')))", chain([
    ["Get_Signature", dvOp("GetItem", { entityName: SETS.mb_emailsignature, recordId: "@outputs('Signature_Id')", $select: "mb_signaturehtml" })],
    ["Set_Signature", setVar("vSignature", "@{coalesce(outputs('Get_Signature')?['body/mb_signaturehtml'], '')}")]
  ]))],
  ["Assembled_Body", compose(`@{concat(if(contains(${c(msg("mb_body"))}, '{{Signature}}'), replace(${c(msg("mb_body"))}, '{{Signature}}', variables('vSignature')), concat(${c(msg("mb_body"))}, if(empty(variables('vSignature')), '', concat('<br/>', variables('vSignature'))))), if(empty(${S("footer")}), '', concat('<br/>', ${S("footer")})))}`)],
  ["Expand_Recipients", expandSwitch],
  ["Validate_Recipients", validateLoop],
  ["Check_Limit", cond(`@greater(length(variables('vRecipients')), ${S("max")})`,
    failAndStop("Limit", `concat('This message expands to ', string(length(variables('vRecipients'))), ' recipients, which is more than Max Recipients Per Send (', string(${S("max")}), ').')`))],
  ["Send_Emails", cond("@greater(length(variables('vRecipients')), 0)",
    { Delivery_Mode: cond(`@equals(${msg("mb_deliverymode")}, ${MODE["Single email to all recipients"]})`, single, { Send_Each: personalized }) },
    { No_Recipients: appendStr("vErrors", "No valid recipients after applying the rules in Email Settings. ") })],
  ["Log_Skipped", forEach("@variables('vSkipped')", chain([
    ["Count_Skipped", incr("vFailed")],
    ["Log_Skip_Row", logDelivery("Skipped", DELIVERY.Skipped, "items('Log_Skipped')?['email']", "items('Log_Skipped')?['fullName']", `${msg("mb_name")}`, "items('Log_Skipped')?['skipReason']")]
  ]), true, after("Send_Emails", ANY))],
  ["Finish_Message", dvOp("UpdateRecord", {
    entityName: SETS.mb_emailmessage, recordId: `@${messageId}`,
    "item/mb_status": `@if(equals(variables('vSent'), 0), ${STATUS.Failed}, if(greater(variables('vFailed'), 0), ${STATUS["Partially Sent"]}, ${STATUS.Sent}))`,
    "item/mb_senton": "@utcNow()",
    "item/mb_totalrecipients": "@add(length(variables('vRecipients')), length(variables('vSkipped')))",
    "item/mb_sentcount": "@variables('vSent')",
    "item/mb_failedcount": "@variables('vFailed')",
    "item/mb_lasterror": "@{take(variables('vErrors'), 9000)}"
  }, after("Log_Skipped", ANY))],
  ["Mark_Finished", setVar("vFinished", true)]
]);

const variables = [
  ["vCandidates", "array", []], ["vRecipients", "array", []], ["vSkipped", "array", []],
  ["vSeen", "string", "|"], ["vSignature", "string", ""], ["vErrors", "string", ""],
  ["vOutcome", "string", ""], ["vOutcomeError", "string", ""],
  ["vSent", "integer", 0], ["vFailed", "integer", 0], ["vFinished", "boolean", false]
];

const actions = chain([
  ...variables.map(([n, t, v]) => [`Init_${n}`, { type: "InitializeVariable", inputs: { variables: [{ name: n, type: t, value: v }] } }]),
  ["Mark_Sending", dvOp("UpdateRecord", { entityName: SETS.mb_emailmessage, recordId: `@${messageId}`, "item/mb_status": STATUS.Sending })],
  ["Try", scope(tryActions)],
  // A send failure handled inside the loops can still mark Try as Failed; only report a crash when
  // the message was not finished normally.
  ["Catch", cond("@not(variables('vFinished'))", {
    Mark_Message_Crashed: dvOp("UpdateRecord", {
      entityName: SETS.mb_emailmessage, recordId: `@${messageId}`,
      "item/mb_status": STATUS.Failed,
      "item/mb_lasterror": "@{take(concat('The delivery flow failed: ', string(result('Try'))), 9000)}"
    })
  }, {}, after("Try", ["Failed", "TimedOut"]))]
]);

const definition = {
  properties: {
    connectionReferences: Object.fromEntries(Object.entries(CONNECTION_REFERENCES).map(([api, ref]) => [api, {
      runtimeSource: "embedded", connection: { connectionReferenceLogicalName: ref }, api: { name: api }
    }])),
    definition: {
      $schema: "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
      contentVersion: "1.0.0.0",
      parameters: {
        $connections: { defaultValue: {}, type: "Object" },
        $authentication: { defaultValue: {}, type: "SecureObject" }
      },
      triggers: {
        When_an_Email_Message_is_queued: {
          type: "OpenApiConnectionWebhook",
          inputs: {
            host: host(DV, "SubscribeWebhookTrigger"),
            parameters: {
              "subscriptionRequest/message": 3, // Modified (Send Now / setting Queued is always an update)
              "subscriptionRequest/entityname": "mb_emailmessage",
              "subscriptionRequest/scope": 4,
              "subscriptionRequest/filteringattributes": "mb_status"
            },
            authentication: auth
          },
          // Only start a run when the message is Queued (evaluated by the flow service).
          conditions: [{ expression: `@equals(triggerOutputs()?['body/mb_status'], ${STATUS.Queued})` }]
        }
      },
      actions
    }
  },
  schemaVersion: "1.0.0.0"
};

const out = path.join(__dirname, "EmailHub-ProcessEmailMessage.json");
fs.writeFileSync(out, JSON.stringify(definition, null, 2) + "\n");
console.log(`wrote ${path.relative(process.cwd(), out)} (${Object.keys(actions).length} top-level actions)`);
module.exports = { CONNECTION_REFERENCES };
