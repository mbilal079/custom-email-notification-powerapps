/*
 * Email Notification Hub - Email Message form logic.
 * Publisher: Muhammad Bilal (mb). Choice values are always resolved by LABEL, never hardcoded.
 */
var EmailHub = window.EmailHub || {};

EmailHub.Message = (function () {
  "use strict";

  var STATUS = "mb_status";
  var SEND_TO = "mb_recipienttype";
  var RECIPIENT_FIELDS = {
    "Single User": "mb_touserid",
    "Single Contact": "mb_tocontactid",
    "Recipient List": "mb_recipientlistid",
    "Email Addresses": "mb_toaddresses"
  };
  var EDITABLE_STATUSES = ["Draft", "Failed", "Partially Sent"];
  // Maintained by the delivery flow - never editable by users.
  var SYSTEM_FIELDS = ["mb_status", "mb_senton", "mb_totalrecipients", "mb_sentcount", "mb_failedcount", "mb_lasterror"];

  function attr(fc, name) { return fc.getAttribute(name); }

  function choiceText(fc, name) {
    var a = attr(fc, name);
    return a ? a.getText() : null;
  }

  function setChoiceByLabel(fc, name, label) {
    var a = attr(fc, name);
    if (!a) { return false; }
    var hit = (a.getOptions() || []).filter(function (o) { return o.text === label; })[0];
    if (hit) {
      a.setValue(hit.value);
      a.setSubmitMode("always"); // the control may be read-only; make sure the value is saved
    }
    return !!hit;
  }

  function isEditable(fc) {
    var s = choiceText(fc, STATUS);
    return !s || EDITABLE_STATUSES.indexOf(s) >= 0;
  }

  function cleanId(id) { return (id || "").replace(/[{}]/g, "").toLowerCase(); }

  function applyRecipientVisibility(fc) {
    var sendTo = choiceText(fc, SEND_TO);
    Object.keys(RECIPIENT_FIELDS).forEach(function (label) {
      var field = RECIPIENT_FIELDS[label];
      var on = label === sendTo;
      var c = fc.getControl(field);
      if (c) { c.setVisible(on); }
      var a = attr(fc, field);
      if (a) { a.setRequiredLevel(on ? "required" : "none"); }
    });
  }

  function applyLock(fc) {
    var locked = !isEditable(fc);
    fc.ui.controls.forEach(function (c) {
      if (!c || typeof c.setDisabled !== "function" || (c.getControlType && c.getControlType() === "subgrid")) { return; }
      var bound = c.getAttribute ? c.getAttribute() : null;
      var system = bound && SYSTEM_FIELDS.indexOf(bound.getName()) >= 0;
      c.setDisabled(locked || system);
    });
    if (locked) {
      fc.ui.setFormNotification("This message has been queued or sent and can no longer be edited.", "INFO", "mbLocked");
    } else {
      fc.ui.clearFormNotification("mbLocked");
    }
  }

  function defaultSignature(fc) {
    var sig = attr(fc, "mb_signatureid");
    if (!sig || sig.getValue()) { return; }
    var userId = cleanId(Xrm.Utility.getGlobalContext().userSettings.userId);
    Xrm.WebApi.retrieveMultipleRecords("mb_emailsignature",
      "?$select=mb_name&$filter=_ownerid_value eq " + userId + " and mb_isdefault eq true and statecode eq 0&$top=1")
      .then(function (r) {
        if (r.entities.length && !sig.getValue()) {
          sig.setValue([{ id: r.entities[0].mb_emailsignatureid, name: r.entities[0].mb_name, entityType: "mb_emailsignature" }]);
        }
      }, function () { /* signature defaulting is best-effort */ });
  }

  function onLoad(executionContext) {
    var fc = executionContext.getFormContext();
    if (fc.ui.getFormType() === 1) {
      if (!attr(fc, STATUS).getValue()) { setChoiceByLabel(fc, STATUS, "Draft"); }
      if (!attr(fc, SEND_TO).getValue()) { setChoiceByLabel(fc, SEND_TO, "Single User"); }
      defaultSignature(fc);
    }
    applyRecipientVisibility(fc);
    applyLock(fc);
  }

  function onSendToChange(executionContext) {
    applyRecipientVisibility(executionContext.getFormContext());
  }

  function onTemplateChange(executionContext) {
    var fc = executionContext.getFormContext();
    var tpl = attr(fc, "mb_templateid").getValue();
    if (!tpl || !tpl.length) { return; }
    Xrm.WebApi.retrieveRecord("mb_emailtemplate", cleanId(tpl[0].id),
      "?$select=mb_subject,mb_body,mb_includesignature,mb_importance")
      .then(function (t) {
        var hasContent = !!(attr(fc, "mb_name").getValue() || attr(fc, "mb_body").getValue());
        var apply = function () {
          attr(fc, "mb_name").setValue(t.mb_subject || null);
          attr(fc, "mb_body").setValue(t.mb_body || null);
          if (t.mb_includesignature !== null && t.mb_includesignature !== undefined) {
            attr(fc, "mb_includesignature").setValue(t.mb_includesignature);
          }
          var imp = t["mb_importance@OData.Community.Display.V1.FormattedValue"];
          if (imp) { setChoiceByLabel(fc, "mb_importance", imp); }
        };
        if (!hasContent) { apply(); return; }
        Xrm.Navigation.openConfirmDialog({
          title: "Apply template",
          text: "Replace the current subject and body with the template content?",
          confirmButtonLabel: "Replace",
          cancelButtonLabel: "Keep mine"
        }).then(function (res) { if (res.confirmed) { apply(); } });
      }, function (e) {
        Xrm.Navigation.openErrorDialog({ message: "Could not load the template: " + e.message });
      });
  }

  function validate(fc) {
    var problems = [];
    if (!attr(fc, "mb_name").getValue()) { problems.push("Subject is required."); }
    if (!attr(fc, "mb_body").getValue()) { problems.push("Body is required."); }
    var sendTo = choiceText(fc, SEND_TO);
    var field = RECIPIENT_FIELDS[sendTo];
    if (!field) {
      problems.push("Choose who to send to.");
    } else {
      var v = attr(fc, field).getValue();
      if (!v || (Array.isArray(v) && !v.length)) { problems.push("Select or enter the recipients (" + sendTo + ")."); }
      if (field === "mb_toaddresses" && v) {
        var bad = v.split(/[;,\s]+/).filter(function (x) { return x && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
        if (bad.length) { problems.push("Invalid email address(es): " + bad.join(", ")); }
      }
    }
    return problems;
  }

  function describeRecipients(fc) {
    var sendTo = choiceText(fc, SEND_TO);
    var v = attr(fc, RECIPIENT_FIELDS[sendTo]).getValue();
    if (Array.isArray(v) && v.length) { return sendTo + ": " + v[0].name; }
    return sendTo + ": " + v;
  }

  // Command bar "Send Now" (MainTab -> receives PrimaryControl).
  function sendNow(primaryControl) {
    var fc = primaryControl;
    if (!isEditable(fc)) {
      Xrm.Navigation.openAlertDialog({ text: "This message is already " + choiceText(fc, STATUS) + "." });
      return;
    }
    var problems = validate(fc);
    if (problems.length) {
      Xrm.Navigation.openAlertDialog({ title: "Cannot send yet", text: problems.join("\n") });
      return;
    }
    Xrm.Navigation.openConfirmDialog({
      title: "Send email",
      text: "Queue this email for delivery?\n" + describeRecipients(fc),
      confirmButtonLabel: "Send",
      cancelButtonLabel: "Cancel"
    }).then(function (res) {
      if (!res.confirmed) { return; }
      if (!setChoiceByLabel(fc, STATUS, "Queued")) {
        Xrm.Navigation.openErrorDialog({ message: "Delivery Status 'Queued' was not found." });
        return;
      }
      attr(fc, "mb_lasterror").setValue(null);
      attr(fc, "mb_lasterror").setSubmitMode("always");
      fc.data.save().then(function () {
        applyLock(fc);
        fc.ui.setFormNotification("Queued for delivery. Refresh in a moment to see progress.", "INFO", "mbQueued");
      }, function (e) {
        setChoiceByLabel(fc, STATUS, "Draft");
        Xrm.Navigation.openErrorDialog({ message: e.message });
      });
    });
  }

  // Command bar "Reset to Draft" - lets a sender fix and resend a failed message.
  function resetToDraft(primaryControl) {
    var fc = primaryControl;
    var s = choiceText(fc, STATUS);
    if (s === "Queued" || s === "Sending") {
      Xrm.Navigation.openAlertDialog({ text: "The message is being processed; wait until it finishes." });
      return;
    }
    setChoiceByLabel(fc, STATUS, "Draft");
    fc.data.save().then(function () { applyLock(fc); fc.ui.clearFormNotification("mbQueued"); });
  }

  return {
    onLoad: onLoad,
    onSendToChange: onSendToChange,
    onTemplateChange: onTemplateChange,
    sendNow: sendNow,
    resetToDraft: resetToDraft
  };
}());

window.EmailHub = EmailHub;
