using System;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace EmailHub.Plugins.Engine
{
    /// <summary>
    /// Wraps a rendered email body in the layout chosen in Email Settings (Branded, Minimal or Plain).
    /// The markup is email-client safe: table layout, inline styles, 600px content width, no scripts or external CSS.
    /// Keep in step with app/webresources/mb_emailpreview.html, which renders the same layout for the preview.
    /// </summary>
    public static class EmailLayout
    {
        public const int Branded = 100000000;
        public const int Minimal = 100000001;
        public const int Plain = 100000002;

        public const string DefaultBrand = "#0F6CBD";
        public const string DefaultBackground = "#F3F5F8";

        private static readonly Regex Hex = new Regex("^#(?:[0-9a-fA-F]{3}){1,2}$", RegexOptions.Compiled);
        private const string Font = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

        public sealed class Options
        {
            public int Layout = Branded;
            public string BrandColor = DefaultBrand;
            public string BackgroundColor = DefaultBackground;
            public string LogoUrl = "";
            public string HeaderTitle = "";
            public string OrganizationName = "";
            public string FooterHtml = "";          // already token-rendered
            public string RecordUrl = "";
            public string RecordName = "";
            public bool ShowRecordButton = true;
            public string RecordButtonLabel = "Open record";
            public string TestNotice = "";          // e.g. "Test Mode: originally addressed to a@b.com"
            public string Preheader = "";           // hidden inbox preview text
        }

        /// <summary>Where the Open record button goes: at {{RecordButton}} if the body has it, otherwise right after the body (before the signature).</summary>
        public const string ButtonMarker = "<!--mb:button-->";

        public static string MarkButton(string body)
        {
            body = body ?? "";
            return body.Contains("{{RecordButton}}") ? body.Replace("{{RecordButton}}", ButtonMarker) : body + ButtonMarker;
        }

        public static string Wrap(string bodyHtml, Options o)
        {
            bodyHtml = bodyHtml ?? "";
            var showButton = o.ShowRecordButton && IsHttp(o.RecordUrl);
            if (!bodyHtml.Contains(ButtonMarker)) { bodyHtml += ButtonMarker; }
            if (o.Layout == Plain)
            {
                var sb = new StringBuilder();
                if (o.TestNotice.Length > 0) { sb.Append("<p style=\"color:#8a5300\"><b>").Append(Enc(o.TestNotice)).Append("</b></p>"); }
                var link = showButton ? "<p><a href=\"" + Attr(o.RecordUrl) + "\">" + Enc(Label(o)) + "</a></p>" : "";
                sb.Append(ReplaceFirst(bodyHtml, ButtonMarker, link).Replace(ButtonMarker, ""));
                if (o.FooterHtml.Length > 0) { sb.Append("<br/>").Append(o.FooterHtml); }
                return sb.ToString();
            }

            var brand = Color(o.BrandColor, DefaultBrand);
            var bg = Color(o.BackgroundColor, DefaultBackground);
            var onBrand = IsDark(brand) ? "#FFFFFF" : "#1B1B1F";
            var title = string.IsNullOrWhiteSpace(o.HeaderTitle) ? o.OrganizationName : o.HeaderTitle;
            var branded = o.Layout != Minimal;
            var outerBg = branded ? bg : "#FFFFFF";

            var h = new StringBuilder(4096);
            h.Append("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
             .Append("<meta name=\"color-scheme\" content=\"light\"><meta name=\"supported-color-schemes\" content=\"light\"></head>")
             .Append("<body style=\"margin:0;padding:0;background:").Append(outerBg).Append(";\">");
            if (o.Preheader.Length > 0)
            {
                h.Append("<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:transparent\">").Append(Enc(o.Preheader)).Append("</div>");
            }
            h.Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:").Append(outerBg).Append(";\">")
             .Append("<tr><td align=\"center\" style=\"padding:").Append(branded ? "28px 12px" : "16px 12px").Append(";\">")
             .Append("<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;max-width:600px;\">");

            // test notice
            if (o.TestNotice.Length > 0)
            {
                h.Append("<tr><td style=\"padding:10px 16px;background:#FFF4CE;border:1px solid #F1D68A;border-radius:8px;font:600 13px ").Append(Font)
                 .Append(";color:#7A5200;\">&#9888; ").Append(Enc(o.TestNotice)).Append("</td></tr><tr><td style=\"height:12px;line-height:12px;font-size:0\">&nbsp;</td></tr>");
            }

            // header
            if (branded)
            {
                h.Append("<tr><td style=\"background:").Append(brand).Append(";border-radius:12px 12px 0 0;padding:22px 32px;\">")
                 .Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>");
                if (IsHttp(o.LogoUrl))
                {
                    h.Append("<td style=\"padding-right:14px;vertical-align:middle;\"><img src=\"").Append(Attr(o.LogoUrl))
                     .Append("\" alt=\"").Append(Attr(title)).Append("\" height=\"36\" style=\"display:block;height:36px;max-height:36px;width:auto;border:0;\"></td>");
                }
                if (!string.IsNullOrWhiteSpace(title))
                {
                    h.Append("<td style=\"vertical-align:middle;font:600 19px ").Append(Font).Append(";color:").Append(onBrand).Append(";\">").Append(Enc(title)).Append("</td>");
                }
                h.Append("</tr></table></td></tr>");
            }
            else
            {
                h.Append("<tr><td style=\"border-top:4px solid ").Append(brand).Append(";padding:18px 4px 14px;\">")
                 .Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>");
                if (IsHttp(o.LogoUrl))
                {
                    h.Append("<td style=\"padding-right:12px;vertical-align:middle;\"><img src=\"").Append(Attr(o.LogoUrl))
                     .Append("\" alt=\"").Append(Attr(title)).Append("\" height=\"30\" style=\"display:block;height:30px;max-height:30px;width:auto;border:0;\"></td>");
                }
                if (!string.IsNullOrWhiteSpace(title))
                {
                    h.Append("<td style=\"vertical-align:middle;font:600 17px ").Append(Font).Append(";color:#1B1B1F;\">").Append(Enc(title)).Append("</td>");
                }
                h.Append("</tr></table></td></tr>");
            }

            // body card
            h.Append("<tr><td style=\"background:#FFFFFF;").Append(branded ? "border-radius:0 0 12px 12px;border:1px solid #E3E6EB;border-top:0;padding:32px;" : "padding:8px 4px 24px;")
             .Append("font:15px/1.6 ").Append(Font).Append(";color:#24262B;\">")
             .Append(ButtonHtml(bodyHtml, showButton, brand, onBrand, o));
            h.Append("</td></tr>");
            AppendFooter(h, o, branded);
            return h.ToString();
        }

        private static string ButtonHtml(string bodyHtml, bool showButton, string brand, string onBrand, Options o)
        {
            var b = new StringBuilder();
            if (showButton)
            {
                var named = !string.IsNullOrWhiteSpace(o.RecordName);
                b.Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:").Append(named ? "22px 0 4px" : "22px 0 18px").Append(";\"><tr>")
                 .Append("<td align=\"center\" bgcolor=\"").Append(brand).Append("\" style=\"border-radius:8px;background:").Append(brand).Append(";\">")
                 .Append("<a href=\"").Append(Attr(o.RecordUrl)).Append("\" target=\"_blank\" style=\"display:inline-block;padding:12px 26px;font:600 15px ").Append(Font)
                 .Append(";color:").Append(onBrand).Append(";text-decoration:none;border-radius:8px;\">").Append(Enc(Label(o))).Append(" &rarr;</a></td></tr></table>");
                if (named)
                {
                    b.Append("<div style=\"font:12px ").Append(Font).Append(";color:#6B6F78;margin:6px 0 18px;\">").Append(Enc(o.RecordName)).Append("</div>");
                }
            }
            return ReplaceFirst(bodyHtml, ButtonMarker, b.ToString()).Replace(ButtonMarker, "");
        }

        private static void AppendFooter(StringBuilder h, Options o, bool branded)
        {
            // footer
            h.Append("<tr><td style=\"padding:20px 24px 4px;font:12px/1.6 ").Append(Font).Append(";color:#6B6F78;text-align:").Append(branded ? "center" : "left")
             .Append(";").Append(branded ? "" : "border-top:1px solid #E3E6EB;").Append("\">");
            if (o.FooterHtml.Length > 0) { h.Append("<div style=\"margin-bottom:8px;\">").Append(o.FooterHtml).Append("</div>"); }
            if (!string.IsNullOrWhiteSpace(o.OrganizationName))
            {
                h.Append("<div style=\"color:#8A8E97;\">&copy; ").Append(DateTime.UtcNow.Year.ToString(CultureInfo.InvariantCulture)).Append(' ').Append(Enc(o.OrganizationName)).Append("</div>");
            }
            h.Append("</td></tr></table></td></tr></table></body></html>");
        }

        private static string ReplaceFirst(string s, string find, string with)
        {
            var i = s.IndexOf(find, StringComparison.Ordinal);
            return i < 0 ? s : s.Substring(0, i) + with + s.Substring(i + find.Length);
        }

        private static string Label(Options o) => string.IsNullOrWhiteSpace(o.RecordButtonLabel) ? "Open record" : o.RecordButtonLabel.Trim();

        public static string Color(string value, string fallback)
        {
            var v = (value ?? "").Trim();
            if (v.Length > 0 && v[0] != '#') { v = "#" + v; }
            return Hex.IsMatch(v) ? v.ToUpperInvariant() : fallback;
        }

        /// <summary>True when white text reads better than dark text on this colour (WCAG relative luminance).</summary>
        public static bool IsDark(string hex)
        {
            var v = hex.TrimStart('#');
            if (v.Length == 3) { v = new string(new[] { v[0], v[0], v[1], v[1], v[2], v[2] }); }
            double Lin(int i)
            {
                var c = int.Parse(v.Substring(i, 2), NumberStyles.HexNumber) / 255.0;
                return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
            }
            var l = 0.2126 * Lin(0) + 0.7152 * Lin(2) + 0.0722 * Lin(4);
            return l < 0.179;
        }

        private static bool IsHttp(string url) =>
            !string.IsNullOrWhiteSpace(url) && (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("http://", StringComparison.OrdinalIgnoreCase));

        private static string Enc(string s) => WebUtility.HtmlEncode(s ?? "");
        private static string Attr(string s) => WebUtility.HtmlEncode(s ?? "").Replace("'", "&#39;");

        /// <summary>Plain-text preview of an HTML body for the hidden preheader.</summary>
        public static string Preheader(string html, int max = 110)
        {
            var text = Regex.Replace(html ?? "", "<(style|script)[\\s\\S]*?</\\1>|<[^>]+>", " ", RegexOptions.IgnoreCase);
            text = Regex.Replace(WebUtility.HtmlDecode(text), "\\s+", " ").Trim();
            return text.Length > max ? text.Substring(0, max).TrimEnd() + "…" : text;
        }
    }
}
