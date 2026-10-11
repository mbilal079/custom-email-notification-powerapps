/*
 * Email Notification Hub - email layout for the browser (Preview dialog and Design studio).
 * Mirror of plugins/EmailHub.Plugins/Engine/EmailLayout.cs: keep both in step.
 * Publisher: Muhammad Bilal (mb).
 */
(function (global) {
  "use strict";
  var Xrm = (function () { try { return global.parent.Xrm || global.top.Xrm || global.Xrm || null; } catch (e) { return global.Xrm || null; } })();

  // ---- layout (mirror of plugins/EmailHub.Plugins/Engine/EmailLayout.cs) ----
  var BRANDED = 100000000, MINIMAL = 100000001, PLAIN = 100000002;
  var FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  function enc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function color(v, fb) { v = (v || "").trim(); if (v && v[0] !== "#") { v = "#" + v; } return /^#([0-9a-f]{3}){1,2}$/i.test(v) ? v.toUpperCase() : fb; }
  function isDark(hex) {
    var v = hex.slice(1); if (v.length === 3) { v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2]; }
    function lin(i) { var c = parseInt(v.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) < 0.179;
  }
  function isHttp(u) { return /^https?:\/\//i.test(u || ""); }

  var MARK = "<!--mb:button-->";
  function markButton(b) { b = b || ""; return b.indexOf("{{RecordButton}}") >= 0 ? b.replace("{{RecordButton}}", MARK) : b + MARK; }
  function place(body, html) { if (body.indexOf(MARK) < 0) { body += MARK; } return body.replace(MARK, html).split(MARK).join(""); }

  function wrap(body, o) {
    var showButton = o.showRecordButton && isHttp(o.recordUrl), label = (o.recordButtonLabel || "").trim() || "Open record";
    if (o.layout === PLAIN) {
      return (o.testNotice ? '<p style="color:#8a5300"><b>' + enc(o.testNotice) + "</b></p>" : "") +
        place(body, showButton ? '<p><a href="' + enc(o.recordUrl) + '">' + enc(label) + "</a></p>" : "") + (o.footer ? "<br/>" + o.footer : "");
    }
    var brand = color(o.brandColor, "#0F6CBD"), bg = color(o.backgroundColor, "#F3F5F8"), onBrand = isDark(brand) ? "#FFFFFF" : "#1B1B1F";
    var title = (o.headerTitle || "").trim() || o.organizationName || "", branded = o.layout !== MINIMAL, outer = branded ? bg : "#FFFFFF";
    var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:' + outer + ';">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + outer + ';"><tr><td align="center" style="padding:' + (branded ? "28px 12px" : "16px 12px") + ';">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">';
    if (o.testNotice) {
      h += '<tr><td style="padding:10px 16px;background:#FFF4CE;border:1px solid #F1D68A;border-radius:8px;font:600 13px ' + FONT + ';color:#7A5200;">&#9888; ' + enc(o.testNotice) +
           '</td></tr><tr><td style="height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>';
    }
    var logo = function (px) { return isHttp(o.logoUrl) ? '<td style="padding-right:' + (px > 32 ? 14 : 12) + 'px;vertical-align:middle;"><img src="' + enc(o.logoUrl) + '" alt="' + enc(title) + '" height="' + px + '" style="display:block;height:' + px + "px;max-height:" + px + 'px;width:auto;border:0;"></td>' : ""; };
    if (branded) {
      h += '<tr><td style="background:' + brand + ';border-radius:12px 12px 0 0;padding:22px 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' + logo(36) +
           (title ? '<td style="vertical-align:middle;font:600 19px ' + FONT + ";color:" + onBrand + ';">' + enc(title) + "</td>" : "") + "</tr></table></td></tr>";
    } else {
      h += '<tr><td style="border-top:4px solid ' + brand + ';padding:18px 4px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' + logo(30) +
           (title ? '<td style="vertical-align:middle;font:600 17px ' + FONT + ';color:#1B1B1F;">' + enc(title) + "</td>" : "") + "</tr></table></td></tr>";
    }
    h += '<tr><td style="background:#FFFFFF;' + (branded ? "border-radius:0 0 12px 12px;border:1px solid #E3E6EB;border-top:0;padding:32px;" : "padding:8px 4px 24px;") +
         "font:15px/1.6 " + FONT + ';color:#24262B;">';
    var btn = "";
    if (showButton) {
      btn += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:' + (o.recordName ? "22px 0 4px" : "22px 0 18px") + ';"><tr><td align="center" bgcolor="' + brand + '" style="border-radius:8px;background:' + brand + ';">' +
           '<a href="' + enc(o.recordUrl) + '" target="_blank" style="display:inline-block;padding:12px 26px;font:600 15px ' + FONT + ";color:" + onBrand + ';text-decoration:none;border-radius:8px;">' + enc(label) + " &rarr;</a></td></tr></table>";
      if (o.recordName) { btn += '<div style="font:12px ' + FONT + ';color:#6B6F78;margin:6px 0 18px;">' + enc(o.recordName) + "</div>"; }
    }
    h += place(body, btn);
    h += '</td></tr><tr><td style="padding:20px 24px 4px;font:12px/1.6 ' + FONT + ';color:#6B6F78;text-align:' + (branded ? "center" : "left") + ";" + (branded ? "" : "border-top:1px solid #E3E6EB;") + '">';
    if (o.footer) { h += '<div style="margin-bottom:8px;">' + o.footer + "</div>"; }
    if (o.organizationName) { h += '<div style="color:#8A8E97;">&copy; ' + new Date().getFullYear() + " " + enc(o.organizationName) + "</div>"; }
    return h + "</td></tr></table></td></tr></table></body></html>";
  }

  var user = (function () { try { return Xrm.Utility.getGlobalContext().userSettings.userName; } catch (e) { return "Megan Bowen"; } })();
  function tokens(s, ctx) {
    var map = {
      FirstName: "Alex", LastName: "Wilber", FullName: "Alex Wilber", Email: "alex.wilber@example.com", Company: "Fabrikam", JobTitle: "Project Manager",
      SenderName: user, SenderEmail: "you@example.com", SenderJobTitle: "Customer Success", OrganizationName: ctx.org || "Contoso",
      Today: new Date().toLocaleDateString(), RecordName: "Prepare Q4 report", RecordUrl: "#"
    };
    return (s || "").replace(/\{\{\s*Record\.([\w]+)\s*\}\}/g, function (m, c) { return "<span style=\"background:#EEF4FB;border-radius:3px;padding:0 3px\">" + c + "</span>"; })
      .replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, k) { return k === "Signature" ? "" : (map[k] != null ? enc(map[k]) : m); });
  }

  global.EmailHubLayout = {
    BRANDED: BRANDED, MINIMAL: MINIMAL, PLAIN: PLAIN,
    wrap: wrap, markButton: markButton, tokens: tokens, color: color, isDark: isDark, enc: enc, user: user
  };
}(window));
