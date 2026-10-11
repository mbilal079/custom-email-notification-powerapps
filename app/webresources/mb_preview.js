/*
 * Email Notification Hub - "Preview Email" command for Settings, Email Templates and Email Messages.
 * Collects the current (unsaved) form values and opens mb_emailpreview.html in a dialog.
 * Publisher: Muhammad Bilal (mb).
 */
var EmailHub = window.EmailHub || {};

EmailHub.Preview = (function () {
  "use strict";

  var DESIGN = ["mb_emaillayout", "mb_brandcolor", "mb_backgroundcolor", "mb_logourl", "mb_headertitle",
    "mb_showrecordbutton", "mb_recordbuttonlabel", "mb_organizationname", "mb_globalfooter", "mb_testmode", "mb_testrecipient", "mb_fromaddress"];

  function val(fc, name) {
    var a = fc.getAttribute(name);
    return a ? a.getValue() : undefined;
  }

  function text(fc, name) {
    var a = fc.getAttribute(name);
    return a ? a.getText() : null;
  }

  function open(primaryControl) {
    var fc = primaryControl;
    var table = fc.data.entity.getEntityName();
    var payload = { mode: table };

    if (table === "mb_emailsetting") {
      payload.settings = {};
      DESIGN.forEach(function (n) { payload.settings[n] = val(fc, n); });
      var layout = fc.getAttribute("mb_emaillayout");
      payload.settings.mb_emaillayout_text = layout ? layout.getText() : null;
    } else if (table === "mb_emailtemplate") {
      payload.subject = val(fc, "mb_subject") || "";
      payload.body = val(fc, "mb_body") || "";
      payload.includeSignature = val(fc, "mb_includesignature") !== false;
      payload.recordButton = text(fc, "mb_recordbutton");
    } else {
      payload.subject = val(fc, "mb_name") || "";
      payload.body = val(fc, "mb_body") || "";
      payload.includeSignature = val(fc, "mb_includesignature") !== false;
      var sig = fc.getAttribute("mb_signatureid");
      var sv = sig && sig.getValue();
      payload.signatureId = sv && sv.length ? sv[0].id.replace(/[{}]/g, "") : null;
      payload.regarding = val(fc, "mb_regardingname") || null;
      payload.recordButton = text(fc, "mb_recordbutton");
    }

    // The dialog page runs on the same origin; hand the payload over through the top window.
    try { window.top.__mbEmailPreview = payload; } catch (e) { /* cross-origin top: the page falls back to saved data */ }

    Xrm.Navigation.navigateTo(
      { pageType: "webresource", webresourceName: "mb_emailpreview.html", data: table },
      { target: 2, position: 1, width: { value: 82, unit: "%" }, height: { value: 88, unit: "%" }, title: "Email preview" }
    );
  }

  return { open: open };
}());
