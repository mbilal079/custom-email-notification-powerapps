#!/usr/bin/env node
// Generates the Email Hub cloud flow definitions from flows/choice-values.json.
//
//   flows/EmailHub-SendViaOutlook.json           - sends deliveries prepared by the plug-in through Office 365 Outlook
//   flows/EmailHub-ReleaseScheduledMessages.json - every 15 minutes, re-queues Scheduled messages whose Send After passed
//
// All recipient logic, token rendering, Email activities and status handling live in the EmailHub.Plugins
// assembly; these flows only do what a plug-in cannot (the Outlook connector, and waking up on a schedule).
//
// Usage: node flows/build-flow-definition.js
"use strict";
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "choice-values.json"), "utf8"));
const STATUS = cfg.mb_emailmessage.mb_status;
const SEND_FROM = cfg.mb_emailsetting.mb_sendmode;
const DELIVERY = cfg.mb_emaildelivery.mb_deliverystatus;
const CHANNEL = cfg.mb_emaildelivery.mb_channel;
const SETS = cfg.entitySets;

const DV = "shared_commondataserviceforapps";
const O365 = "shared_office365";
const REFS = { [DV]: "mb_emailhubdataverse", [O365]: "mb_emailhuboutlook" };
const auth = "@parameters('$authentication')";

const host = (conn, op) => ({ connectionName: conn, operationId: op, apiId: `/providers/Microsoft.PowerApps/apis/${conn}` });
const op = (conn, operationId, parameters, runAfter, extra) =>
  ({ type: "OpenApiConnection", inputs: { host: host(conn, operationId), parameters, authentication: auth }, runAfter: runAfter || {}, ...(extra || {}) });
const after = (name, statuses) => ({ [name]: statuses || ["Succeeded"] });

function wrap(connections, triggers, actions) {
  return {
    properties: {
      connectionReferences: Object.fromEntries(connections.map((api) => [api, {
        runtimeSource: "embedded", connection: { connectionReferenceLogicalName: REFS[api] }, api: { name: api }
      }])),
      definition: {
        $schema: "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        contentVersion: "1.0.0.0",
        parameters: { $connections: { defaultValue: {}, type: "Object" }, $authentication: { defaultValue: {}, type: "SecureObject" } },
        triggers, actions
      }
    },
    schemaVersion: "1.0.0.0"
  };
}

// ---------------- Send via Outlook ----------------
const D = "items('For_Each_Delivery')";
const S = (f) => `outputs('Settings')?['${f}']`;
const first = "first(outputs('List_Settings')?['body/value'])";
const nullIfEmpty = (e) => `@if(empty(coalesce(${e},'')), null, ${e})`;
const mail = {
  "emailMessage/To": `@{${D}?['mb_toaddresses']}`,
  "emailMessage/Subject": `@{${D}?['mb_subjectsent']}`,
  "emailMessage/Body": `@{${D}?['mb_bodysent']}`,
  "emailMessage/Cc": nullIfEmpty(`${D}?['mb_ccaddresses']`),
  "emailMessage/Bcc": nullIfEmpty(`${D}?['mb_bccaddresses']`),
  "emailMessage/Importance": "@{coalesce(outputs('Get_Message')?['body/mb_importance@OData.Community.Display.V1.FormattedValue'], 'Normal')}",
  "emailMessage/ReplyTo": nullIfEmpty(S("replyTo"))
};
const errorOf = (scope) =>
  `@{take(coalesce(first(result('${scope}'))?['outputs']?['body']?['error']?['message'], first(result('${scope}'))?['outputs']?['body']?['message'], first(result('${scope}'))?['error']?['message'], 'The mail server rejected the message.'), 10000)}`;
const markDelivery = (status, runAfter, extra) => op(DV, "UpdateRecord", {
  entityName: SETS.mb_emaildelivery, recordId: `@${D}?['mb_emaildeliveryid']`,
  "item/mb_deliverystatus": status, "item/mb_sentat": "@utcNow()", ...(extra || {})
}, runAfter);
const branch = (kind, operationId, extraParams) => ({
  [`Send_${kind}`]: { type: "Scope", runAfter: {}, actions: {
    [`Send_Email_${kind}`]: op(O365, operationId, { ...extraParams, ...mail }) } },
  [`Mark_Sent_${kind}`]: markDelivery(DELIVERY.Sent, after(`Send_${kind}`)),
  [`Mark_Failed_${kind}`]: markDelivery(DELIVERY.Failed, after(`Send_${kind}`, ["Failed", "TimedOut"]),
    { "item/mb_errordetail": errorOf(`Send_${kind}`) })
});

const sendViaOutlook = wrap([DV, O365], {
  When_a_message_is_ready_for_Outlook: {
    type: "OpenApiConnectionWebhook",
    inputs: {
      host: host(DV, "SubscribeWebhookTrigger"),
      parameters: {
        "subscriptionRequest/message": 3,
        "subscriptionRequest/entityname": "mb_emailmessage",
        "subscriptionRequest/scope": 4,
        "subscriptionRequest/filteringattributes": "mb_status"
      },
      authentication: auth
    },
    conditions: [{ expression: `@equals(triggerOutputs()?['body/mb_status'], ${STATUS["Awaiting Outlook"]})` }]
  }
}, {
  List_Settings: op(DV, "ListRecords", { entityName: SETS.mb_emailsetting, $filter: "mb_isactive eq true and statecode eq 0", $orderby: "createdon asc", $top: 1 }),
  Settings: { type: "Compose", runAfter: after("List_Settings"), inputs: {
    shared: `@equals(coalesce(${first}?['mb_sendmode'], ${SEND_FROM["Flow Owner Mailbox"]}), ${SEND_FROM["Shared Mailbox"]})`,
    sharedMailbox: `@coalesce(${first}?['mb_sharedmailbox'], ${first}?['mb_fromaddress'], '')`,
    sendFrom: `@coalesce(${first}?['mb_fromaddress'], '')`,
    replyTo: `@coalesce(${first}?['mb_replyto'], '')`
  } },
  Get_Message: op(DV, "GetItem", { entityName: SETS.mb_emailmessage, recordId: "@triggerOutputs()?['body/mb_emailmessageid']", $select: "mb_importance" }, after("Settings")),
  List_Pending_Deliveries: op(DV, "ListRecords", {
    entityName: SETS.mb_emaildelivery,
    $select: "mb_emaildeliveryid,mb_toaddresses,mb_subjectsent,mb_bodysent,mb_ccaddresses,mb_bccaddresses",
    $filter: `_mb_emailmessageid_value eq @{triggerOutputs()?['body/mb_emailmessageid']} and mb_deliverystatus eq ${DELIVERY.Pending} and mb_channel eq ${CHANNEL["Office 365 Outlook (cloud flow)"]}`
  }, after("Get_Message"), { runtimeConfiguration: { paginationPolicy: { minimumItemCount: 5000 } } }),
  For_Each_Delivery: {
    type: "Foreach", runAfter: after("List_Pending_Deliveries"),
    foreach: "@outputs('List_Pending_Deliveries')?['body/value']",
    runtimeConfiguration: { concurrency: { repetitions: 5 } },
    actions: {
      Use_Shared_Mailbox: {
        type: "If", runAfter: {}, expression: `@equals(${S("shared")}, true)`,
        actions: branch("Shared", "SharedMailboxSendEmailV2", { "emailMessage/MailboxAddress": `@{${S("sharedMailbox")}}` }),
        else: { actions: branch("Owner", "SendEmailV2", { "emailMessage/From": nullIfEmpty(S("sendFrom")) }) }
      }
    }
  }
});

// ---------------- Release scheduled messages ----------------
const releaseScheduled = wrap([DV], {
  Every_15_minutes: { type: "Recurrence", recurrence: { frequency: "Minute", interval: 15 } }
}, {
  List_Due_Messages: op(DV, "ListRecords", {
    entityName: SETS.mb_emailmessage, $select: "mb_emailmessageid",
    $filter: `mb_status eq ${STATUS.Scheduled} and mb_scheduledon le @{utcNow()}`
  }, {}, { runtimeConfiguration: { paginationPolicy: { minimumItemCount: 5000 } } }),
  Queue_Each: {
    type: "Foreach", runAfter: after("List_Due_Messages"), foreach: "@outputs('List_Due_Messages')?['body/value']",
    actions: {
      Queue_Message: op(DV, "UpdateRecord", {
        entityName: SETS.mb_emailmessage, recordId: "@items('Queue_Each')?['mb_emailmessageid']", "item/mb_status": STATUS.Queued
      })
    }
  }
});

for (const [file, def] of [["EmailHub-SendViaOutlook.json", sendViaOutlook], ["EmailHub-ReleaseScheduledMessages.json", releaseScheduled]]) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(def, null, 2) + "\n");
  console.log(`wrote flows/${file}`);
}
