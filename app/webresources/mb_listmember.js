/*
 * Email Notification Hub - List Member form logic.
 * Shows only the field that matches the Member Type and auto-fills email / names from users and contacts.
 */
var EmailHub = window.EmailHub || {};

EmailHub.ListMember = (function () {
  "use strict";

  var TYPE = "mb_membertype";
  var LOOKUPS = { "User": "mb_userid", "Contact": "mb_contactid", "Team": "mb_teamid" };
  var DETAIL_FIELDS = ["mb_emailaddress", "mb_firstname", "mb_lastname", "mb_company"];

  function attr(fc, n) { return fc.getAttribute(n); }
  function ctl(fc, n) { return fc.getControl(n); }
  function cleanId(id) { return (id || "").replace(/[{}]/g, ""); }

  function setChoiceByLabel(fc, name, label) {
    var a = attr(fc, name);
    var hit = (a.getOptions() || []).filter(function (o) { return o.text === label; })[0];
    if (hit) { a.setValue(hit.value); }
  }

  function applyType(fc) {
    var t = attr(fc, TYPE).getText();
    Object.keys(LOOKUPS).forEach(function (label) {
      var on = label === t;
      if (ctl(fc, LOOKUPS[label])) { ctl(fc, LOOKUPS[label]).setVisible(on); }
      attr(fc, LOOKUPS[label]).setRequiredLevel(on ? "required" : "none");
    });
    var external = t === "External Email";
    var team = t === "Team";
    DETAIL_FIELDS.forEach(function (f) {
      var c = ctl(fc, f);
      if (!c) { return; }
      c.setVisible(!team);
      c.setDisabled(!external);
    });
    attr(fc, "mb_emailaddress").setRequiredLevel(external ? "required" : "none");
    // The display name is derived from the member, so users never have to type it.
    attr(fc, "mb_name").setRequiredLevel("none");
    if (ctl(fc, "mb_name")) { ctl(fc, "mb_name").setDisabled(true); }
  }

  function setDetails(fc, d) {
    attr(fc, "mb_emailaddress").setValue(d.email || null);
    attr(fc, "mb_firstname").setValue(d.first || null);
    attr(fc, "mb_lastname").setValue(d.last || null);
    attr(fc, "mb_company").setValue(d.company || null);
    attr(fc, "mb_name").setValue(d.name || d.email || null);
  }

  function onLoad(executionContext) {
    var fc = executionContext.getFormContext();
    if (fc.ui.getFormType() === 1 && !attr(fc, TYPE).getValue()) { setChoiceByLabel(fc, TYPE, "External Email"); }
    applyType(fc);
  }

  function onTypeChange(executionContext) {
    var fc = executionContext.getFormContext();
    Object.keys(LOOKUPS).forEach(function (l) { attr(fc, LOOKUPS[l]).setValue(null); });
    setDetails(fc, {});
    applyType(fc);
  }

  function onUserChange(executionContext) {
    var fc = executionContext.getFormContext();
    var v = attr(fc, "mb_userid").getValue();
    if (!v) { setDetails(fc, {}); return; }
    Xrm.WebApi.retrieveRecord("systemuser", cleanId(v[0].id), "?$select=fullname,firstname,lastname,internalemailaddress")
      .then(function (u) {
        setDetails(fc, { email: u.internalemailaddress, first: u.firstname, last: u.lastname, name: u.fullname });
      });
  }

  function onContactChange(executionContext) {
    var fc = executionContext.getFormContext();
    var v = attr(fc, "mb_contactid").getValue();
    if (!v) { setDetails(fc, {}); return; }
    Xrm.WebApi.retrieveRecord("contact", cleanId(v[0].id), "?$select=fullname,firstname,lastname,emailaddress1,_parentcustomerid_value")
      .then(function (c) {
        setDetails(fc, {
          email: c.emailaddress1, first: c.firstname, last: c.lastname, name: c.fullname,
          company: c["_parentcustomerid_value@OData.Community.Display.V1.FormattedValue"]
        });
      });
  }

  function onTeamChange(executionContext) {
    var fc = executionContext.getFormContext();
    var v = attr(fc, "mb_teamid").getValue();
    setDetails(fc, {});
    attr(fc, "mb_name").setValue(v ? "Team: " + v[0].name : null);
  }

  function onEmailChange(executionContext) {
    var fc = executionContext.getFormContext();
    if (attr(fc, TYPE).getText() !== "External Email") { return; }
    var first = attr(fc, "mb_firstname").getValue();
    var last = attr(fc, "mb_lastname").getValue();
    var full = [first, last].filter(Boolean).join(" ");
    attr(fc, "mb_name").setValue(full || attr(fc, "mb_emailaddress").getValue());
  }

  function onSave(executionContext) {
    var fc = executionContext.getFormContext();
    if (!attr(fc, "mb_name").getValue()) {
      attr(fc, "mb_name").setValue(attr(fc, "mb_emailaddress").getValue() || "Member");
    }
  }

  return {
    onLoad: onLoad,
    onTypeChange: onTypeChange,
    onUserChange: onUserChange,
    onContactChange: onContactChange,
    onTeamChange: onTeamChange,
    onEmailChange: onEmailChange,
    onSave: onSave
  };
}());

window.EmailHub = EmailHub;
