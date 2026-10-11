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
        "Email columns: " + (emails.join(", ") || "none") + "  |  Lookup columns: " + (lookups.join(", ") || "none") +
        "  |  A related row's email: lookup.column in Email Columns, e.g. " + (lookups[0] || "parentcustomerid") + ".emailaddress1",
        "INFO", "mbColumns");
    }, function () {
      fc.ui.setFormNotification("Table '" + table + "' was not found. Use the logical name, e.g. task, contact, account or new_project.", "ERROR", "mbTable");
    });
  }

  // Lookups that look right but are normally empty, with the column to use instead.
  var EMPTY_LOOKUPS = { contact: { accountid: "parentcustomerid" }, opportunity: { accountid: "parentaccountid", contactid: "parentcontactid" } };

  function checkColumns(fc) {
    fc.ui.clearFormNotification("mbEmptyLookup");
    var table = (fc.getAttribute(TABLE).getValue() || "").trim().toLowerCase();
    var map = EMPTY_LOOKUPS[table]; if (!map) { return; }
    var used = ["mb_emailcolumns", "mb_lookupcolumns"].map(function (n) { var a = fc.getAttribute(n); return (a && a.getValue()) || ""; }).join(",").toLowerCase();
    Object.keys(map).forEach(function (bad) {
      if (new RegExp("(^|[\\s,;])" + bad + "(\\.|$|[\\s,;])").test(used)) {
        fc.ui.setFormNotification("On " + table + ", '" + bad + "' is maintained by the system and is usually empty. Use '" + map[bad] +
          "' instead (e.g. " + map[bad] + ".emailaddress1 in Email Columns, or " + map[bad] + " in Lookup Columns).", "WARNING", "mbEmptyLookup");
      }
    });
  }

  function onLoad(executionContext) {
    var fc = executionContext.getFormContext();
    ["mb_registeredsteps", "mb_lasttriggeredon", "mb_triggercount"].forEach(function (n) {
      var c = fc.getControl(n);
      if (c) { c.setDisabled(true); }
    });
    describe(fc);
    checkColumns(fc);
    ["mb_emailcolumns", "mb_lookupcolumns", TABLE].forEach(function (n) {
      var a = fc.getAttribute(n); if (a) { a.addOnChange(function () { checkColumns(fc); }); }
    });
  }

  function onTableChange(executionContext) {
    describe(executionContext.getFormContext());
  }

  return { onLoad: onLoad, onTableChange: onTableChange };
}());

window.EmailHub = EmailHub;
