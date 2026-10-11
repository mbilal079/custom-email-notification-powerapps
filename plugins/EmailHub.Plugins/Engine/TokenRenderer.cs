using System;
using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;

namespace EmailHub.Plugins.Engine
{
    /// <summary>
    /// Replaces {{Token}} placeholders. Recipient tokens are blank when no recipient is given (single email mode).
    /// {{Record.column}} reads the related (regarding) record; {{RecordName}} / {{RecordUrl}} describe it.
    /// Values are HTML-encoded in bodies so names and record data cannot inject markup.
    /// </summary>
    public sealed class TokenRenderer
    {
        private static readonly Regex RecordToken = new Regex(@"\{\{Record\.([A-Za-z0-9_]+)\}\}", RegexOptions.Compiled);

        public Entity Sender;
        public HubSettings Settings;
        public Entity Record;
        public string RecordName = "";
        public string RecordUrl = "";

        public string Render(string template, Recipient r, bool html)
        {
            if (string.IsNullOrEmpty(template)) { return ""; }
            string Enc(string v) => html ? WebUtility.HtmlEncode(v ?? "") : (v ?? "");
            var s = template
                .Replace("{{FirstName}}", Enc(FirstNameOf(r)))
                .Replace("{{LastName}}", Enc(r?.LastName))
                .Replace("{{FullName}}", Enc(r?.FullName))
                .Replace("{{Email}}", Enc(r?.Email))
                .Replace("{{Company}}", Enc(r?.Company))
                .Replace("{{JobTitle}}", Enc(r?.JobTitle))
                .Replace("{{SenderName}}", Enc(Sender?.GetAttributeValue<string>("fullname")))
                .Replace("{{SenderEmail}}", Enc(Sender?.GetAttributeValue<string>("internalemailaddress")))
                .Replace("{{SenderJobTitle}}", Enc(Sender?.GetAttributeValue<string>("jobtitle")))
                .Replace("{{OrganizationName}}", Enc(Settings?.OrganizationName))
                .Replace("{{Today}}", DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
                .Replace("{{RecordName}}", Enc(RecordName))
                .Replace("{{RecordUrl}}", Enc(RecordUrl))
                .Replace("{{Signature}}", "");
            return RecordToken.Replace(s, m => Enc(RecordValue(m.Groups[1].Value)));
        }

        private string RecordValue(string column)
        {
            if (Record == null) { return ""; }
            column = column.ToLowerInvariant();
            if (Record.FormattedValues.Contains(column)) { return Record.FormattedValues[column]; }
            if (!Record.Attributes.Contains(column) || Record[column] == null) { return ""; }
            var v = Record[column];
            switch (v)
            {
                case EntityReference er: return er.Name ?? "";
                case Money m: return m.Value.ToString("N2", CultureInfo.InvariantCulture);
                case OptionSetValue o: return o.Value.ToString(CultureInfo.InvariantCulture);
                case DateTime d: return d.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " UTC";
                case bool b: return b ? "Yes" : "No";
                case AliasedValue a: return Convert.ToString(a.Value, CultureInfo.InvariantCulture);
                default: return Convert.ToString(v, CultureInfo.InvariantCulture);
            }
        }

        /// <summary>Places the signature at {{Signature}} (or appends it) and appends the global footer.</summary>
        /// <summary>First name; for accounts and other non-person rows their name; never an email address.</summary>
        private static string FirstNameOf(Recipient r)
        {
            if (r == null) { return ""; }
            if (!string.IsNullOrWhiteSpace(r.FirstName)) { return r.FirstName; }
            return string.IsNullOrWhiteSpace(r.FullName) || r.FullName.Contains("@") ? "" : r.FullName;
        }

        public static string Assemble(string body, string signature, string footer)
        {
            body = body ?? "";
            if (!string.IsNullOrEmpty(signature))
            {
                body = body.Contains("{{Signature}}") ? body.Replace("{{Signature}}", signature) : body + "<br/>" + signature;
            }
            if (!string.IsNullOrEmpty(footer)) { body += "<br/>" + footer; }
            return body;
        }
    }
}
