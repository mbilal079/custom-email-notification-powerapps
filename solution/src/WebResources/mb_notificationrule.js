/*
 * Email Notification Hub - Notification Rule form logic.
 * Checks the table logical name and lists the table's email and lookup columns so users can configure
 * recipients without opening the maker portal.
 */
var EmailHub = window.EmailHub || {};

EmailHub.Rule = (function () {
  "use strict";

  var TABLE = "mb_tablename";

  function api(path) {
    var url = Xrm.Utility.getGlobalContext().getClientUrl() + "/api/data/v9.2/" + path;
    return fetch(url, { headers: { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" }, credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) { throw new Error(r.status); }
        return r.json();
      });
  }

  function describe(fc) {
    var a = fc.getAttribute(TABLE);
    var table = (a.getValue() || "").trim().toLowerCase();
    fc.ui.clearFormNotification("mbTable");
    fc.ui.clearFormNotification("mbColumns");
    if (!table) { return; }
    if (table !== a.getValue()) { a.setValue(table); }
    var def = "EntityDefinitions(LogicalName='" + encodeURIComponent(table) + "')";
    Promise.all([
      api(def + "?$select=LogicalName"),
      api(def + "/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=LogicalName,FormatName"),
      api(def + "/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,AttributeOf")
    ]).then(function (res) {
      var emails = res[1].value.filter(function (x) { return x.FormatName && x.FormatName.Value === "Email"; })
        .map(function (x) { return x.LogicalName; }).sort();
      var lookups = res[2].value.filter(function (x) { return !x.AttributeOf; })
        .map(function (x) { return x.LogicalName; }).sort();
      fc.ui.setFormNotification(
        "Email columns: " + (emails.join(", ") || "none") + "  |  Lookup columns: " + (lookups.join(", ") || "none"),
        "INFO", "mbColumns");
    }, function () {
      fc.ui.setFormNotification("Table '" + table + "' was not found. Use the logical name, e.g. task, contact, account or new_project.", "ERROR", "mbTable");
    });
  }

  function onLoad(executionContext) {
    var fc = executionContext.getFormContext();
    ["mb_registeredsteps", "mb_lasttriggeredon", "mb_triggercount"].forEach(function (n) {
      var c = fc.getControl(n);
      if (c) { c.setDisabled(true); }
    });
    describe(fc);
  }

  function onTableChange(executionContext) {
    describe(executionContext.getFormContext());
  }

  return { onLoad: onLoad, onTableChange: onTableChange };
}());

window.EmailHub = EmailHub;
