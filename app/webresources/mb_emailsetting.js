/*
 * Email Notification Hub - Email Settings form logic.
 * Connects the Design studio (mb_designstudio.html) on the Email Design tab to this record. The studio edits the
 * design columns directly; the plain fields are hidden while it is available and shown again if it is not.
 * Publisher: Muhammad Bilal (mb).
 */
var EmailHub = window.EmailHub || {};

EmailHub.Setting = (function () {
  "use strict";

  var STUDIO = "WebResource_mb_designstudio";
  var PLAIN_SECTIONS = ["sec_layout", "sec_button"];

  function showPlainFields(fc, visible) {
    fc.ui.tabs.forEach(function (tab) {
      PLAIN_SECTIONS.forEach(function (name) {
        var sec = tab.sections.get(name);
        if (sec) { sec.setVisible(visible); }
      });
    });
  }

  function onLoad(executionContext) {
    var fc = executionContext.getFormContext();
    var studio = fc.getControl(STUDIO);
    if (!studio || !studio.getContentWindow) { return; }
    showPlainFields(fc, false);
    studio.getContentWindow().then(function (win) {
      var tries = 0;
      (function connect() {
        if (win.EmailHubStudio) { win.EmailHubStudio.attach(fc); return; }
        if (++tries < 40) { setTimeout(connect, 150); } else { showPlainFields(fc, true); }
      }());
    }, function () { showPlainFields(fc, true); });
  }

  return { onLoad: onLoad };
}());

window.EmailHub = EmailHub;
