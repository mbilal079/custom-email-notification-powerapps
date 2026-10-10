using System;
using System.Collections.Generic;
using System.Linq;
using EmailHub.Plugins.Common;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace EmailHub.Plugins.Engine
{
    /// <summary>
    /// Prepares a queued Email Message: resolves recipients, renders tokens, creates one Email activity and one
    /// Email Delivery row per email, and hands the deliveries to the configured channel
    /// (Dataverse SendEmail via <see cref="Plugins.SendDelivery"/>, or the Outlook cloud flow).
    /// </summary>
    public sealed class MessageProcessor
    {
        private readonly IOrganizationService _svc;      // SYSTEM context
        private readonly ITracingService _trace;
        private readonly RecipientResolver _resolver;

        public MessageProcessor(IOrganizationService systemService, ITracingService trace)
        {
            _svc = systemService;
            _trace = trace;
            _resolver = new RecipientResolver(systemService);
        }

        public void Process(Guid messageId)
        {
            var msg = _svc.Retrieve(Tables.Message, messageId, new ColumnSet(true));
            if (msg.GetAttributeValue<OptionSetValue>("mb_status")?.Value != MessageStatus.Queued)
            {
                _trace.Trace("Message is not Queued; nothing to do.");
                return;
            }

            var sendAfter = msg.GetAttributeValue<DateTime?>("mb_scheduledon");
            if (sendAfter.HasValue && sendAfter.Value > DateTime.UtcNow.AddMinutes(1))
            {
                Update(messageId, e => e["mb_status"] = new OptionSetValue(MessageStatus.Scheduled));
                return;
            }

            Update(messageId, e =>
            {
                e["mb_status"] = new OptionSetValue(MessageStatus.Sending);
                e["mb_totalrecipients"] = null;
                e["mb_sentcount"] = null;
                e["mb_failedcount"] = null;
                e["mb_lasterror"] = null;
                e["mb_senton"] = null;
            });

            try
            {
                Prepare(msg);
            }
            catch (Exception ex)
            {
                _trace.Trace(ex.ToString());
                Fail(messageId, (ex is InvalidPluginExecutionException ? ex.Message : "The email engine failed: " + ex.Message) + $" [engine {typeof(MessageProcessor).Assembly.GetName().Version}]");
            }
        }

        private void Prepare(Entity msg)
        {
            var settings = HubSettings.Load(_svc);
            var configError = settings.ConfigurationError();
            if (configError != null) { Fail(msg.Id, configError); return; }

            var owner = msg.GetAttributeValue<EntityReference>("ownerid");
            var senderRef = owner?.LogicalName == "systemuser" ? owner : msg.GetAttributeValue<EntityReference>("createdby");
            var renderer = new TokenRenderer
            {
                Settings = settings,
                Sender = _svc.Retrieve("systemuser", senderRef.Id, new ColumnSet("fullname", "internalemailaddress", "jobtitle"))
            };

            // ----- related (regarding) record -----
            var sendTo = msg.GetAttributeValue<OptionSetValue>("mb_recipienttype")?.Value ?? SendTo.SingleUser;
            var regarding = RegardingOf(msg);
            if (regarding == null && sendTo == SendTo.SingleContact && msg.GetAttributeValue<EntityReference>("mb_tocontactid") != null)
            {
                regarding = msg.GetAttributeValue<EntityReference>("mb_tocontactid");
            }
            if (regarding != null)
            {
                EnsureOwnerCanRead(owner, regarding);
                renderer.Record = _svc.Retrieve(regarding.LogicalName, regarding.Id, new ColumnSet(true));
                var md = _resolver.Metadata(regarding.LogicalName);
                renderer.RecordName = md.PrimaryNameAttribute != null ? renderer.Record.GetAttributeValue<string>(md.PrimaryNameAttribute) ?? "" : "";
                renderer.RecordUrl = RecordUrl(regarding);
                regarding.Name = renderer.RecordName;
            }
            var activityRegarding = ActivityRegarding(regarding, renderer.Record);

            // ----- signature -----
            var signatureHtml = "";
            if (msg.GetAttributeValue<bool?>("mb_includesignature") != false)
            {
                var sig = msg.GetAttributeValue<EntityReference>("mb_signatureid") ?? settings.DefaultSignature;
                if (sig != null)
                {
                    signatureHtml = _svc.Retrieve(Tables.Signature, sig.Id, new ColumnSet("mb_signaturehtml")).GetAttributeValue<string>("mb_signaturehtml") ?? "";
                }
            }
            var bodyTemplate = TokenRenderer.Assemble(msg.GetAttributeValue<string>("mb_body"), signatureHtml, settings.Footer);
            var subjectTemplate = msg.GetAttributeValue<string>("mb_name") ?? "";

            // ----- recipients -----
            var candidates = Candidates(msg, sendTo, renderer.Record).ToList();
            var (recipients, skipped) = Validate(candidates, settings);
            if (recipients.Count > settings.MaxRecipients)
            {
                Fail(msg.Id, $"This message expands to {recipients.Count} recipients, which is more than Max Recipients Per Send ({settings.MaxRecipients}).");
                return;
            }

            var personalized = (msg.GetAttributeValue<OptionSetValue>("mb_deliverymode")?.Value ?? DeliveryMode.Personalized) != DeliveryMode.SingleEmail;
            var createActivity = settings.CreateActivities || settings.Channel == Channel.Dataverse;
            var importance = msg.GetAttributeValue<OptionSetValue>("mb_importance")?.Value ?? Importance.Normal;
            var cc = settings.TestMode ? new string[0] : Text.SplitAddresses(msg.GetAttributeValue<string>("mb_ccaddresses")).ToArray();
            var bcc = settings.TestMode ? new string[0]
                : Text.SplitAddresses(msg.GetAttributeValue<string>("mb_bccaddresses")).Concat(Text.SplitAddresses(settings.ArchiveBcc)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var from = settings.FromQueue ?? senderRef;

            var units = personalized
                ? recipients.Select(r => new[] { r }).ToList()
                : (recipients.Count > 0 ? new List<Recipient[]> { recipients.ToArray() } : new List<Recipient[]>());

            foreach (var unit in units)
            {
                var one = personalized ? unit[0] : null;
                var subject = renderer.Render(subjectTemplate, one, false);
                var body = renderer.Render(bodyTemplate, one, true);
                var realTo = string.Join(";", unit.Select(r => r.Email));
                IEnumerable<Recipient> toParties = unit;
                if (settings.TestMode)
                {
                    subject = $"[TEST to {realTo}] {subject}";
                    toParties = new[] { RecipientResolver.Address(settings.TestRecipient) };
                }
                var toAddresses = string.Join(";", toParties.Select(r => r.Email));

                Guid? activityId = null;
                if (createActivity)
                {
                    activityId = CreateEmailActivity(subject, body, from, toParties, cc, bcc, activityRegarding, owner, importance);
                }

                var delivery = new Entity(Tables.Delivery)
                {
                    ["mb_name"] = Text.Truncate(toAddresses, 850),
                    ["mb_toaddresses"] = toAddresses,
                    ["mb_recipientname"] = Text.Truncate(personalized ? one.DisplayName : $"{unit.Length} recipients", 200),
                    ["mb_deliverystatus"] = new OptionSetValue(DeliveryStatus.Pending),
                    ["mb_channel"] = new OptionSetValue(settings.Channel),
                    ["mb_subjectsent"] = Text.Truncate(subject, 400),
                    ["mb_bodysent"] = body,
                    ["mb_ccaddresses"] = Text.Truncate(string.Join(";", cc), 2000),
                    ["mb_bccaddresses"] = Text.Truncate(string.Join(";", bcc), 2000),
                    ["mb_emailmessageid"] = msg.ToEntityReference(),
                    ["ownerid"] = owner
                };
                if (activityId.HasValue) { delivery["mb_emailactivityid"] = new EntityReference("email", activityId.Value); }
                _svc.Create(delivery);
            }

            foreach (var s in skipped)
            {
                _svc.Create(new Entity(Tables.Delivery)
                {
                    ["mb_name"] = Text.Truncate(string.IsNullOrWhiteSpace(s.Email) ? "(no address)" : s.Email, 850),
                    ["mb_toaddresses"] = s.Email,
                    ["mb_recipientname"] = Text.Truncate(s.DisplayName, 200),
                    ["mb_deliverystatus"] = new OptionSetValue(DeliveryStatus.Skipped),
                    ["mb_channel"] = new OptionSetValue(settings.Channel),
                    ["mb_subjectsent"] = Text.Truncate(subjectTemplate, 400),
                    ["mb_errordetail"] = s.SkipReason,
                    ["mb_sentat"] = DateTime.UtcNow,
                    ["mb_emailmessageid"] = msg.ToEntityReference(),
                    ["ownerid"] = owner
                });
            }

            // Marks preparation complete (Total set) and hands over to the channel; the finalizer settles the status.
            Update(msg.Id, e =>
            {
                e["mb_totalrecipients"] = recipients.Count + skipped.Count;
                e["mb_status"] = new OptionSetValue(settings.Channel == Channel.Outlook && units.Count > 0 ? MessageStatus.AwaitingOutlook : MessageStatus.Sending);
                if (recipients.Count == 0) { e["mb_lasterror"] = "No valid recipients after applying the rules in Email Settings."; }
                if (regarding != null)
                {
                    e["mb_regardingtable"] = regarding.LogicalName;
                    e["mb_regardingid"] = regarding.Id.ToString();
                    e["mb_regardingname"] = Text.Truncate(regarding.Name, 400);
                }
            });
            new MessageFinalizer(_svc).TryFinalize(msg.Id);
        }

        private IEnumerable<Recipient> Candidates(Entity msg, int sendTo, Entity record)
        {
            switch (sendTo)
            {
                case SendTo.SingleUser:
                    var u = msg.GetAttributeValue<EntityReference>("mb_touserid");
                    if (u != null) { yield return _resolver.User(u.Id); }
                    break;
                case SendTo.SingleContact:
                    var c = msg.GetAttributeValue<EntityReference>("mb_tocontactid");
                    if (c != null) { yield return _resolver.Contact(c.Id); }
                    break;
                case SendTo.RecipientList:
                    var l = msg.GetAttributeValue<EntityReference>("mb_recipientlistid");
                    if (l != null) { foreach (var m in _resolver.ListMembers(l.Id)) { yield return m; } }
                    break;
                case SendTo.EmailAddresses:
                    foreach (var a in Text.SplitAddresses(msg.GetAttributeValue<string>("mb_toaddresses"))) { yield return RecipientResolver.Address(a); }
                    break;
                case SendTo.NotificationRule:
                    var ruleRef = msg.GetAttributeValue<EntityReference>("mb_notificationruleid");
                    if (ruleRef == null) { throw new InvalidPluginExecutionException("The message has no Notification Rule."); }
                    var rule = _svc.Retrieve(Tables.Rule, ruleRef.Id, new ColumnSet(true));
                    foreach (var r in RuleRecipients(rule, record)) { yield return r; }
                    break;
            }
        }

        /// <summary>Recipients configured on a notification rule, resolved against the triggering record.</summary>
        private IEnumerable<Recipient> RuleRecipients(Entity rule, Entity record)
        {
            if (record != null)
            {
                if (rule.GetAttributeValue<bool>("mb_sendtoowner") && record.GetAttributeValue<EntityReference>("ownerid") != null)
                {
                    foreach (var r in _resolver.Reference(record.GetAttributeValue<EntityReference>("ownerid"))) { yield return r; }
                }
                if (rule.GetAttributeValue<bool>("mb_sendtocreator") && record.GetAttributeValue<EntityReference>("createdby") != null)
                {
                    foreach (var r in _resolver.Reference(record.GetAttributeValue<EntityReference>("createdby"))) { yield return r; }
                }
                foreach (var col in Text.SplitNames(rule.GetAttributeValue<string>("mb_emailcolumns")))
                {
                    foreach (var a in Text.SplitAddresses(record.GetAttributeValue<string>(col) ?? "")) { yield return RecipientResolver.Address(a); }
                }
                foreach (var col in Text.SplitNames(rule.GetAttributeValue<string>("mb_lookupcolumns")))
                {
                    if (record.Attributes.Contains(col) && record[col] is EntityReference er)
                    {
                        foreach (var r in _resolver.Reference(er)) { yield return r; }
                    }
                }
            }
            var list = rule.GetAttributeValue<EntityReference>("mb_recipientlistid");
            if (list != null) { foreach (var m in _resolver.ListMembers(list.Id)) { yield return m; } }
            foreach (var a in Text.SplitAddresses(rule.GetAttributeValue<string>("mb_additionaladdresses"))) { yield return RecipientResolver.Address(a); }
        }

        private static (List<Recipient> ok, List<Recipient> skipped) Validate(IEnumerable<Recipient> candidates, HubSettings s)
        {
            var ok = new List<Recipient>();
            var skipped = new List<Recipient>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var c in candidates)
            {
                c.Email = (c.Email ?? "").Trim().ToLowerInvariant();
                var reason = c.SkipReason;
                if (string.IsNullOrEmpty(reason))
                {
                    if (c.Email.Length == 0) { reason = "No email address"; }
                    else if (!Text.IsValidEmail(c.Email)) { reason = "Invalid email address"; }
                    else if (seen.Contains(c.Email)) { continue; } // duplicates are sent once, silently
                    else if (!c.Internal && !s.AllowExternal) { reason = "External recipients are not allowed"; }
                    else if (!c.Internal && s.AllowedDomains.Length > 0 && !s.AllowedDomains.Contains(c.Email.Split('@')[1])) { reason = "Domain not allowed"; }
                }
                if (string.IsNullOrEmpty(reason))
                {
                    seen.Add(c.Email);
                    ok.Add(c);
                }
                else
                {
                    c.SkipReason = reason;
                    skipped.Add(c);
                }
            }
            return (ok, skipped);
        }

        private Guid CreateEmailActivity(string subject, string body, EntityReference from, IEnumerable<Recipient> to, string[] cc, string[] bcc,
            EntityReference regarding, EntityReference owner, int importance)
        {
            Entity Party(Recipient r) => r.Party != null
                ? new Entity("activityparty") { ["partyid"] = r.Party }
                : new Entity("activityparty") { ["addressused"] = r.Email };
            Entity Addr(string a) => new Entity("activityparty") { ["addressused"] = a };

            var email = new Entity("email")
            {
                ["subject"] = Text.Truncate(subject, 400),
                ["description"] = body,
                ["directioncode"] = true,
                ["from"] = new EntityCollection(new List<Entity> { new Entity("activityparty") { ["partyid"] = from } }),
                ["to"] = new EntityCollection(to.Select(Party).ToList()),
                ["prioritycode"] = new OptionSetValue(importance == Importance.High ? 2 : importance == Importance.Low ? 0 : 1)
            };
            if (cc.Length > 0) { email["cc"] = new EntityCollection(cc.Select(Addr).ToList()); }
            if (bcc.Length > 0) { email["bcc"] = new EntityCollection(bcc.Select(Addr).ToList()); }
            if (regarding != null) { email["regardingobjectid"] = regarding; }
            if (owner != null) { email["ownerid"] = owner; }
            try
            {
                return _svc.Create(email);
            }
            catch (Exception ex)
            {
                var about = regarding == null ? "no related record" : $"related record {regarding.LogicalName} {regarding.Id}";
                throw new InvalidPluginExecutionException($"Could not create the Email activity ({about}): {ex.Message}", ex);
            }
        }

        /// <summary>
        /// An Email activity can only be regarding a table with activities enabled, and never another activity.
        /// For an activity row (task, appointment...) the email is linked to that activity's own Regarding record.
        /// </summary>
        private EntityReference ActivityRegarding(EntityReference regarding, Entity record)
        {
            if (regarding == null) { return null; }
            var md = _resolver.Metadata(regarding.LogicalName);
            if (md.IsActivity == true) { return record?.GetAttributeValue<EntityReference>("regardingobjectid"); }
            return md.HasActivities == true ? regarding : null;
        }

        private static EntityReference RegardingOf(Entity msg)
        {
            var table = (msg.GetAttributeValue<string>("mb_regardingtable") ?? "").Trim().ToLowerInvariant();
            var idText = (msg.GetAttributeValue<string>("mb_regardingid") ?? "").Trim().Trim('{', '}');
            return table.Length > 0 && Guid.TryParse(idText, out var id) ? new EntityReference(table, id) : null;
        }

        /// <summary>The SYSTEM context can read anything, so make sure the message owner may read the related record.</summary>
        private void EnsureOwnerCanRead(EntityReference owner, EntityReference record)
        {
            if (owner == null) { return; }
            var resp = (RetrievePrincipalAccessResponse)_svc.Execute(new RetrievePrincipalAccessRequest { Principal = owner, Target = record });
            if ((resp.AccessRights & AccessRights.ReadAccess) == 0)
            {
                throw new InvalidPluginExecutionException("The owner of this email message does not have read access to the related record.");
            }
        }

        private string RecordUrl(EntityReference r)
        {
            try
            {
                var org = (RetrieveCurrentOrganizationResponse)_svc.Execute(new RetrieveCurrentOrganizationRequest());
                var web = org.Detail.Endpoints[Microsoft.Xrm.Sdk.Organization.EndpointType.WebApplication].TrimEnd('/');
                return $"{web}/main.aspx?pagetype=entityrecord&etn={r.LogicalName}&id={r.Id}";
            }
            catch (Exception ex)
            {
                _trace.Trace("Record URL unavailable: " + ex.Message);
                return "";
            }
        }

        private void Fail(Guid id, string error) => Update(id, e =>
        {
            e["mb_status"] = new OptionSetValue(MessageStatus.Failed);
            e["mb_lasterror"] = Text.Truncate(error, 10000);
        });

        private void Update(Guid id, Action<Entity> set)
        {
            var e = new Entity(Tables.Message, id);
            set(e);
            _svc.Update(e);
        }
    }
}
