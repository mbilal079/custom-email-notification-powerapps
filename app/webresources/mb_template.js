/*
 * Email Notification Hub - Email Template form logic.
 * - Connects the Design studio (mb_designstudio.html) on the Design tab to the template.
 * - Send Test command: sends the saved template to you, personalised with any record (mb_sendtest.html).
 * Publisher: Muhammad Bilal (mb).
 */
var EmailHub = window.EmailHub || {};

EmailHub.Template = (function () {
  "use strict";

  var STUDIO = "WebResource_mb_designstudio";

  function showPlainDesignFields(fc, visible) {
    var tab = fc.ui.tabs.get("tab_design");
    var sec = tab && tab.sections.get("sec_layout");
    if (sec) { sec.setVisible(visible); }
  }

  function onLoad(executionContext) {
    var fc = executionContext.getFormContext();
    var studio = fc.getControl(STUDIO);
    if (!studio || !studio.getContentWindow) { return; }
    showPlainDesignFields(fc, false);
    studio.getContentWindow().then(function (win) {
      var tries = 0;
      (function connect() {
        if (win.EmailHubStudio) { win.EmailHubStudio.attach(fc); return; }
        if (++tries < 40) { setTimeout(connect, 150); } else { showPlainDesignFields(fc, true); }
      }());
    }, function () { showPlainDesignFields(fc, true); });
  }

  function sendTest(primaryControl) {
    var fc = primaryControl;
    var open = function () {
      Xrm.Navigation.navigateTo(
        { pageType: "webresource", webresourceName: "mb_sendtest.html", data: fc.data.entity.getId().replace(/[{}]/g, "") },
        { target: 2, position: 1, width: { value: 560, unit: "px" }, height: { value: 640, unit: "px" }, title: "Send test" }
      );
    };
    if (!fc.data.entity.getId() || fc.data.entity.getIsDirty()) {
      fc.data.save().then(open, function () { /* the form shows the save error */ });
    } else {
      open();
    }
  }

  return { onLoad: onLoad, sendTest: sendTest };
}());

window.EmailHub = EmailHub;
