using System;
using System.Linq;
using EmailHub.Plugins.Common;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace EmailHub.Plugins.Engine
{
    /// <summary>
    /// Settles an Email Message once every delivery has an outcome. Safe to call any number of times and from
    /// parallel jobs: it only writes when preparation is complete (Total Recipients set) and nothing is Pending.
    /// </summary>
    public sealed class MessageFinalizer
    {
        private readonly IOrganizationService _svc;

        public MessageFinalizer(IOrganizationService systemService) { _svc = systemService; }

        public void TryFinalize(Guid messageId)
        {
            var msg = _svc.Retrieve(Tables.Message, messageId, new ColumnSet("mb_status", "mb_totalrecipients", "mb_lasterror"));
            var status = msg.GetAttributeValue<OptionSetValue>("mb_status")?.Value;
            if (msg.GetAttributeValue<int?>("mb_totalrecipients") == null) { return; }                 // still preparing
            if (status != MessageStatus.Sending && status != MessageStatus.AwaitingOutlook) { return; } // already settled

            var q = new QueryExpression(Tables.Delivery) { ColumnSet = new ColumnSet("mb_deliverystatus", "mb_name", "mb_errordetail") };
            q.Criteria.AddCondition("mb_emailmessageid", ConditionOperator.Equal, messageId);
            var rows = new RecipientResolver(_svc).RetrieveAll(q).ToList();
            int Count(int s) => rows.Count(r => r.GetAttributeValue<OptionSetValue>("mb_deliverystatus")?.Value == s);
            if (Count(DeliveryStatus.Pending) > 0) { return; }

            var sent = Count(DeliveryStatus.Sent);
            var failed = Count(DeliveryStatus.Failed) + Count(DeliveryStatus.Skipped);
            var errors = string.Join(" | ", rows
                .Where(r => r.GetAttributeValue<OptionSetValue>("mb_deliverystatus")?.Value == DeliveryStatus.Failed)
                .Take(5)
                .Select(r => r.GetAttributeValue<string>("mb_name") + ": " + r.GetAttributeValue<string>("mb_errordetail")));

            var update = new Entity(Tables.Message, messageId)
            {
                ["mb_status"] = new OptionSetValue(sent == 0 ? MessageStatus.Failed : failed > 0 ? MessageStatus.PartiallySent : MessageStatus.Sent),
                ["mb_sentcount"] = sent,
                ["mb_failedcount"] = failed,
                ["mb_senton"] = DateTime.UtcNow
            };
            if (errors.Length > 0) { update["mb_lasterror"] = Text.Truncate(errors, 10000); }
            _svc.Update(update);
        }
    }
}
