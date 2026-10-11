using System;
using System.Collections.Generic;
using System.Linq;
using EmailHub.Plugins.Common;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace EmailHub.Plugins.Engine
{
    /// <summary>The active Email Setting row, with safe defaults when none exists.</summary>
    public sealed class HubSettings
    {
        public int Channel = Common.Channel.Outlook;
        public int SendFrom = Common.SendFrom.FlowOwnerMailbox;
        public string SharedMailbox = "";
        public string FromAddress = "";
        public string ReplyTo = "";
        public string OrganizationName = "";
        public string Footer = "";
        public int MaxRecipients = 500;
        public bool AllowExternal = true;
        public string[] AllowedDomains = new string[0];
        public bool TestMode;
        public string TestRecipient = "";
        public string ArchiveBcc = "";
        public bool KeepLog = true;
        public bool CreateActivities = true;
        public EntityReference DefaultSignature;
        public EntityReference FromQueue;
        public int Layout = EmailLayout.Branded;
        public string BrandColor = EmailLayout.DefaultBrand;
        public string BackgroundColor = EmailLayout.DefaultBackground;
        public string LogoUrl = "";
        public string HeaderTitle = "";
        public bool ShowRecordButton = true;
        public string RecordButtonLabel = "Open record";

        public static HubSettings Load(IOrganizationService svc)
        {
            var q = new QueryExpression(Tables.Setting) { ColumnSet = new ColumnSet(true), TopCount = 1 };
            q.Criteria.AddCondition("mb_isactive", ConditionOperator.Equal, true);
            q.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);
            q.AddOrder("createdon", OrderType.Ascending);
            var row = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
            var s = new HubSettings();
            if (row == null) { return s; }
            s.Channel = row.GetAttributeValue<OptionSetValue>("mb_deliverychannel")?.Value ?? s.Channel;
            s.SendFrom = row.GetAttributeValue<OptionSetValue>("mb_sendmode")?.Value ?? s.SendFrom;
            s.FromAddress = (row.GetAttributeValue<string>("mb_fromaddress") ?? "").Trim();
            s.SharedMailbox = row.GetAttributeValue<string>("mb_sharedmailbox") ?? "";
            if (string.IsNullOrWhiteSpace(s.SharedMailbox)) { s.SharedMailbox = s.FromAddress; }
            s.ReplyTo = row.GetAttributeValue<string>("mb_replyto") ?? "";
            s.OrganizationName = row.GetAttributeValue<string>("mb_organizationname") ?? "";
            s.Footer = row.GetAttributeValue<string>("mb_globalfooter") ?? "";
            s.MaxRecipients = row.GetAttributeValue<int?>("mb_maxrecipients") ?? 500;
            s.AllowExternal = row.GetAttributeValue<bool?>("mb_allowexternal") ?? true;
            s.AllowedDomains = Text.SplitAddresses(row.GetAttributeValue<string>("mb_alloweddomains")).Select(d => d.ToLowerInvariant()).ToArray();
            s.TestMode = row.GetAttributeValue<bool?>("mb_testmode") ?? false;
            s.TestRecipient = (row.GetAttributeValue<string>("mb_testrecipient") ?? "").Trim();
            s.ArchiveBcc = (row.GetAttributeValue<string>("mb_archivebcc") ?? "").Trim();
            s.KeepLog = row.GetAttributeValue<bool?>("mb_logdelivery") ?? true;
            s.CreateActivities = row.GetAttributeValue<bool?>("mb_createactivities") ?? true;
            s.DefaultSignature = row.GetAttributeValue<EntityReference>("mb_defaultsignatureid");
            s.FromQueue = row.GetAttributeValue<EntityReference>("mb_fromqueueid");
            s.Layout = row.GetAttributeValue<OptionSetValue>("mb_emaillayout")?.Value ?? s.Layout;
            s.BrandColor = EmailLayout.Color(row.GetAttributeValue<string>("mb_brandcolor"), EmailLayout.DefaultBrand);
            s.BackgroundColor = EmailLayout.Color(row.GetAttributeValue<string>("mb_backgroundcolor"), EmailLayout.DefaultBackground);
            s.LogoUrl = (row.GetAttributeValue<string>("mb_logourl") ?? "").Trim();
            s.HeaderTitle = (row.GetAttributeValue<string>("mb_headertitle") ?? "").Trim();
            s.ShowRecordButton = row.GetAttributeValue<bool?>("mb_showrecordbutton") ?? true;
            s.RecordButtonLabel = (row.GetAttributeValue<string>("mb_recordbuttonlabel") ?? "").Trim();
            return s;
        }

        public string ConfigurationError()
        {
            if (FromAddress.Length > 0 && !Text.IsValidEmail(FromAddress)) { return $"Send From Address '{FromAddress}' is not a valid email address."; }
            if (TestMode && string.IsNullOrWhiteSpace(TestRecipient)) { return "Test Mode is on but no Test Mode Recipient is set in Email Settings."; }
            if (Channel == Common.Channel.Outlook && SendFrom == Common.SendFrom.SharedMailbox && string.IsNullOrWhiteSpace(SharedMailbox))
            {
                return "Send Mode is Shared Mailbox but neither Shared Mailbox Address nor Send From Address is set in Email Settings.";
            }
            return null;
        }
    }

    /// <summary>One person (or address) a message may be delivered to.</summary>
    public sealed class Recipient
    {
        public string Email = "";
        public string FirstName = "";
        public string LastName = "";
        public string FullName = "";
        public string Company = "";
        public string JobTitle = "";
        public bool Internal;
        public string SkipReason = "";
        /// <summary>Record used as the activity party (contact, user, account, lead, queue...). Null = unresolved address.</summary>
        public EntityReference Party;

        public string DisplayName => string.IsNullOrWhiteSpace(FullName) ? Email : FullName;
    }

    public static class Text
    {
        private static readonly char[] Separators = { ';', ',', '\n', '\r', ' ', '\t' };

        public static IEnumerable<string> SplitAddresses(string value) =>
            (value ?? "").Split(Separators, StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).Where(s => s.Length > 0);

        public static IEnumerable<string> SplitNames(string value) =>
            (value ?? "").Split(new[] { ',', ';', ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(s => s.Trim().ToLowerInvariant()).Where(s => s.Length > 0);

        public static bool IsValidEmail(string e)
        {
            if (string.IsNullOrWhiteSpace(e) || e.Contains(" ")) { return false; }
            var parts = e.Split('@');
            return parts.Length == 2 && parts[0].Length > 0 && parts[1].Contains(".") && !parts[1].StartsWith(".") && !parts[1].EndsWith(".");
        }

        public static string Truncate(string value, int max) =>
            string.IsNullOrEmpty(value) || value.Length <= max ? value : value.Substring(0, max);
    }
}
