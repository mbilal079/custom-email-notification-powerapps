using System;
using System.Linq;
using System.Text;
using EmailHub.Plugins.Common;
using EmailHub.Plugins.Engine;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;

namespace EmailHub.Plugins
{
    /// <summary>Common plumbing: SYSTEM service, tracing, target id.</summary>
    public abstract class HubPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            Run(context, factory, factory.CreateOrganizationService(null), trace);
        }

        protected abstract void Run(IPluginExecutionContext context, IOrganizationServiceFactory factory, IOrganizationService system, ITracingService trace);

        protected static Guid TargetId(IPluginExecutionContext context)
        {
            if (context.InputParameters.Contains("Target"))
            {
                if (context.InputParameters["Target"] is Entity e && e.Id != Guid.Empty) { return e.Id; }
                if (context.InputParameters["Target"] is EntityReference r) { return r.Id; }
            }
            if (context.OutputParameters.Contains("id") && context.OutputParameters["id"] is Guid id) { return id; }
            return context.PrimaryEntityId;
        }
    }

    /// <summary>
    /// mb_emailmessage Create / Update(mb_status), asynchronous: prepares a Queued message
    /// (recipients, tokens, Email activities, delivery rows).
    /// </summary>
    public sealed class ProcessEmailMessage : HubPlugin
    {
        protected override void Run(IPluginExecutionContext context, IOrganizationServiceFactory factory, IOrganizationService system, ITracingService trace)
        {
            if (context.Depth > 3) { return; }
            new MessageProcessor(system, trace).Process(TargetId(context));
        }
    }

    /// <summary>
    /// mb_emaildelivery Create, asynchronous: sends Pending deliveries on the Dataverse channel with SendEmail.
    /// Each delivery is its own system job, so large sends run in parallel and are retried by the platform.
    /// </summary>
    public sealed class SendDelivery : HubPlugin
    {
        protected override void Run(IPluginExecutionContext context, IOrganizationServiceFactory factory, IOrganizationService system, ITracingService trace)
        {
            var id = TargetId(context);
            var d = system.Retrieve(Tables.Delivery, id, new ColumnSet("mb_channel", "mb_deliverystatus", "mb_emailactivityid"));
            if (d.GetAttributeValue<OptionSetValue>("mb_channel")?.Value != Channel.Dataverse) { return; }
            if (d.GetAttributeValue<OptionSetValue>("mb_deliverystatus")?.Value != DeliveryStatus.Pending) { return; }
            var activity = d.GetAttributeValue<EntityReference>("mb_emailactivityid");

            var update = new Entity(Tables.Delivery, id) { ["mb_sentat"] = DateTime.UtcNow };
            try
            {
                if (activity == null) { throw new InvalidPluginExecutionException("No Email activity was created for this delivery."); }
                // Send as the activity's sender when it is a user, so mailbox permissions are respected.
                var email = system.Retrieve("email", activity.Id, new ColumnSet("from"));
                var fromParty = email.GetAttributeValue<EntityCollection>("from")?.Entities.FirstOrDefault()?.GetAttributeValue<EntityReference>("partyid");
                var sender = fromParty?.LogicalName == "systemuser" ? factory.CreateOrganizationService(fromParty.Id) : system;
                sender.Execute(new SendEmailRequest { EmailId = activity.Id, IssueSend = true, TrackingToken = "" });
                update["mb_deliverystatus"] = new OptionSetValue(DeliveryStatus.Sent);
            }
            catch (Exception ex)
            {
                trace.Trace(ex.ToString());
                update["mb_deliverystatus"] = new OptionSetValue(DeliveryStatus.Failed);
                update["mb_errordetail"] = Text.Truncate(Explain(ex.Message), 10000);
            }
            system.Update(update);
        }

        private static string Explain(string error)
        {
            if (error.IndexOf("unresolved", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return error + " (Enable 'Allow messages with unresolved email recipients to be sent' in system settings, or use the Office 365 Outlook channel.)";
            }
            if (error.IndexOf("mailbox", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return error + " (The sender's mailbox must be approved and enabled for server-side synchronization.)";
            }
            return error;
        }
    }

    /// <summary>
    /// mb_emaildelivery Update(mb_deliverystatus), asynchronous: completes the Email activity of deliveries sent by the
    /// Outlook flow and settles the parent message when nothing is pending.
    /// </summary>
    public sealed class FinalizeDelivery : HubPlugin
    {
        protected override void Run(IPluginExecutionContext context, IOrganizationServiceFactory factory, IOrganizationService system, ITracingService trace)
        {
            var d = system.Retrieve(Tables.Delivery, TargetId(context), new ColumnSet("mb_channel", "mb_deliverystatus", "mb_emailactivityid", "mb_emailmessageid"));
            var status = d.GetAttributeValue<OptionSetValue>("mb_deliverystatus")?.Value;
            var activity = d.GetAttributeValue<EntityReference>("mb_emailactivityid");
            if (activity != null && d.GetAttributeValue<OptionSetValue>("mb_channel")?.Value == Channel.Outlook)
            {
                try
                {
                    // Completed / Sent for a delivered email; Canceled when Outlook rejected it.
                    var sent = status == DeliveryStatus.Sent;
                    system.Execute(new SetStateRequest
                    {
                        EntityMoniker = activity,
                        State = new OptionSetValue(sent ? 1 : 2),
                        Status = new OptionSetValue(sent ? 3 : 5)
                    });
                }
                catch (Exception ex) { trace.Trace("Could not close the Email activity: " + ex.Message); }
            }
            var msg = d.GetAttributeValue<EntityReference>("mb_emailmessageid");
            if (msg != null) { new MessageFinalizer(system).TryFinalize(msg.Id); }
        }
    }

    /// <summary>
    /// mb_notificationrule Create/Update (post, sync) and Delete (pre, sync): validates the rule and registers or removes
    /// the plugin steps that watch the rule's table. Runs as SYSTEM, so Email Hub administrators do not need
    /// System Customizer rights.
    /// </summary>
    public sealed class NotificationRuleManager : HubPlugin
    {
        private const string TriggerType = "EmailHub.Plugins.NotificationRuleTrigger";

        protected override void Run(IPluginExecutionContext context, IOrganizationServiceFactory factory, IOrganizationService system, ITracingService trace)
        {
            if (context.Depth > 1) { return; }
            var ruleId = TargetId(context);
            if (context.MessageName == "Delete")
            {
                var existing = system.Retrieve(Tables.Rule, ruleId, new ColumnSet("mb_registeredsteps"));
                RemoveSteps(system, existing.GetAttributeValue<string>("mb_registeredsteps"), trace);
                return;
            }

            var rule = system.Retrieve(Tables.Rule, ruleId, new ColumnSet(true));
            RemoveSteps(system, rule.GetAttributeValue<string>("mb_registeredsteps"), trace);
            var stepIds = new StringBuilder();
            var active = rule.GetAttributeValue<bool>("mb_isactive") && rule.GetAttributeValue<OptionSetValue>("statecode")?.Value == 0;
            if (active)
            {
                var table = (rule.GetAttributeValue<string>("mb_tablename") ?? "").Trim().ToLowerInvariant();
                ValidateRule(system, rule, table);
                var evt = rule.GetAttributeValue<OptionSetValue>("mb_triggerevent")?.Value ?? TriggerEvent.Create;
                var columns = string.Join(",", Text.SplitNames(rule.GetAttributeValue<string>("mb_watchedcolumns")));
                if (evt == TriggerEvent.Create || evt == TriggerEvent.CreateOrUpdate)
                {
                    stepIds.Append(Register(system, rule, table, "Create", null)).Append(';');
                }
                if (evt == TriggerEvent.Update || evt == TriggerEvent.CreateOrUpdate)
                {
                    stepIds.Append(Register(system, rule, table, "Update", columns.Length > 0 ? columns : null)).Append(';');
                }
            }
            var save = new Entity(Tables.Rule, ruleId) { ["mb_registeredsteps"] = stepIds.ToString().TrimEnd(';') };
            var tableName = rule.GetAttributeValue<string>("mb_tablename");
            if (tableName != null && tableName != tableName.Trim().ToLowerInvariant()) { save["mb_tablename"] = tableName.Trim().ToLowerInvariant(); }
            system.Update(save);
        }

        private static void ValidateRule(IOrganizationService svc, Entity rule, string table)
        {
            if (table.Length == 0) { throw new InvalidPluginExecutionException("Enter the logical name of the table to watch (for example task or contact)."); }
            if (table.StartsWith("mb_email") || table == Tables.Rule)
            {
                throw new InvalidPluginExecutionException("Notification rules cannot watch Email Hub's own tables.");
            }
            Microsoft.Xrm.Sdk.Metadata.EntityMetadata md;
            try
            {
                md = ((RetrieveEntityResponse)svc.Execute(new RetrieveEntityRequest { LogicalName = table, EntityFilters = Microsoft.Xrm.Sdk.Metadata.EntityFilters.Attributes })).EntityMetadata;
            }
            catch
            {
                throw new InvalidPluginExecutionException($"Table '{table}' was not found. Use the table's logical name, e.g. 'task', 'contact' or 'new_project'.");
            }
            var names = md.Attributes.Select(a => a.LogicalName).ToList();
            foreach (var field in new[] { "mb_watchedcolumns", "mb_emailcolumns", "mb_lookupcolumns" })
            {
                var missing = Text.SplitNames(rule.GetAttributeValue<string>(field))
                    .Where(c => !(field == "mb_emailcolumns" && c.Contains('.') ? RelatedColumnExists(svc, md, c) : names.Contains(c))).ToList();
                if (missing.Count > 0)
                {
                    throw new InvalidPluginExecutionException($"Column(s) {string.Join(", ", missing)} do not exist on table '{table}'." +
                        (field == "mb_emailcolumns" ? " For a column on a related row use lookup.column, e.g. parentcustomerid.emailaddress1." : ""));
                }
            }
            foreach (var c in Text.SplitNames(rule.GetAttributeValue<string>("mb_lookupcolumns")))
            {
                if (!(md.Attributes.First(a => a.LogicalName == c) is Microsoft.Xrm.Sdk.Metadata.LookupAttributeMetadata))
                {
                    throw new InvalidPluginExecutionException($"'{c}' is not a lookup column on '{table}'. Put email text columns in Email Columns instead.");
                }
            }
            if (rule.GetAttributeValue<EntityReference>("mb_templateid") == null)
            {
                throw new InvalidPluginExecutionException("Choose the Email Template the rule sends.");
            }
            var hasRecipients = rule.GetAttributeValue<bool>("mb_sendtoowner") || rule.GetAttributeValue<bool>("mb_sendtocreator")
                || Text.SplitNames(rule.GetAttributeValue<string>("mb_emailcolumns")).Any()
                || Text.SplitNames(rule.GetAttributeValue<string>("mb_lookupcolumns")).Any()
                || rule.GetAttributeValue<EntityReference>("mb_recipientlistid") != null
                || Text.SplitAddresses(rule.GetAttributeValue<string>("mb_additionaladdresses")).Any();
            if (!hasRecipients) { throw new InvalidPluginExecutionException("Choose at least one recipient source for the rule."); }
        }

        /// <summary>"lookup.column": the lookup exists on the table and the column exists on at least one table it can point to.</summary>
        private static bool RelatedColumnExists(IOrganizationService svc, Microsoft.Xrm.Sdk.Metadata.EntityMetadata md, string path)
        {
            var parts = path.Split('.');
            if (parts.Length != 2) { return false; }
            if (!(md.Attributes.FirstOrDefault(a => a.LogicalName == parts[0]) is Microsoft.Xrm.Sdk.Metadata.LookupAttributeMetadata lookup)) { return false; }
            foreach (var target in lookup.Targets ?? new string[0])
            {
                var tmd = ((RetrieveEntityResponse)svc.Execute(new RetrieveEntityRequest { LogicalName = target, EntityFilters = Microsoft.Xrm.Sdk.Metadata.EntityFilters.Attributes })).EntityMetadata;
                if (tmd.Attributes.Any(a => a.LogicalName == parts[1])) { return true; }
            }
            return false;
        }

        private static Guid Register(IOrganizationService svc, Entity rule, string table, string message, string filteringAttributes)
        {
            var type = svc.RetrieveMultiple(new QueryExpression("plugintype")
            {
                ColumnSet = new ColumnSet("plugintypeid"),
                Criteria = { Conditions = { new ConditionExpression("typename", ConditionOperator.Equal, TriggerType) } }
            }).Entities.FirstOrDefault() ?? throw new InvalidPluginExecutionException("The NotificationRuleTrigger plugin is not registered.");
            var msg = svc.RetrieveMultiple(new QueryExpression("sdkmessage")
            {
                ColumnSet = new ColumnSet("sdkmessageid"),
                Criteria = { Conditions = { new ConditionExpression("name", ConditionOperator.Equal, message) } }
            }).Entities.First();
            var filter = svc.RetrieveMultiple(new QueryExpression("sdkmessagefilter")
            {
                ColumnSet = new ColumnSet("sdkmessagefilterid"),
                Criteria =
                {
                    Conditions =
                    {
                        new ConditionExpression("sdkmessageid", ConditionOperator.Equal, msg.Id),
                        new ConditionExpression("primaryobjecttypecode", ConditionOperator.Equal, table)
                    }
                }
            }).Entities.FirstOrDefault() ?? throw new InvalidPluginExecutionException($"Table '{table}' does not support the {message} event for plug-ins.");

            var step = new Entity("sdkmessageprocessingstep")
            {
                ["name"] = Text.Truncate($"Email Hub rule: {rule.GetAttributeValue<string>("mb_name")} ({table} {message})", 256),
                ["description"] = "Registered automatically by Email Notification Hub for a Notification Rule. Do not edit; change the rule instead.",
                ["plugintypeid"] = type.ToEntityReference(),
                ["sdkmessageid"] = msg.ToEntityReference(),
                ["sdkmessagefilterid"] = filter.ToEntityReference(),
                ["configuration"] = rule.Id.ToString(),
                ["stage"] = new OptionSetValue(40),
                ["mode"] = new OptionSetValue(1),
                ["rank"] = 1,
                ["supporteddeployment"] = new OptionSetValue(0),
                ["asyncautodelete"] = true
            };
            if (!string.IsNullOrEmpty(filteringAttributes)) { step["filteringattributes"] = filteringAttributes; }
            return svc.Create(step);
        }

        private static void RemoveSteps(IOrganizationService svc, string ids, ITracingService trace)
        {
            foreach (var part in (ids ?? "").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (!Guid.TryParse(part.Trim(), out var id)) { continue; }
                try { svc.Delete("sdkmessageprocessingstep", id); }
                catch (Exception ex) { trace.Trace($"Step {id} already removed: {ex.Message}"); }
            }
        }
    }

    /// <summary>
    /// Registered dynamically (one step per rule and event, unsecure configuration = rule id), asynchronous: when the
    /// watched record matches the rule's condition, queues an Email Message regarding that record.
    /// </summary>
    public sealed class NotificationRuleTrigger : IPlugin
    {
        private readonly Guid _ruleId;

        public NotificationRuleTrigger(string unsecureConfig, string secureConfig)
        {
            Guid.TryParse((unsecureConfig ?? "").Trim(), out _ruleId);
        }

        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var svc = ((IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory))).CreateOrganizationService(null);
            if (_ruleId == Guid.Empty || context.Depth > 2) { return; }

            Entity rule;
            try { rule = svc.Retrieve(Tables.Rule, _ruleId, new ColumnSet(true)); }
            catch { trace.Trace("Rule no longer exists."); return; }
            if (!rule.GetAttributeValue<bool>("mb_isactive") || rule.GetAttributeValue<OptionSetValue>("statecode")?.Value != 0) { return; }

            var table = context.PrimaryEntityName;
            var recordId = context.PrimaryEntityId;
            if (!MatchesCondition(svc, rule.GetAttributeValue<string>("mb_conditionfetchxml"), table, recordId, trace)) { return; }

            var template = svc.Retrieve(Tables.Template, rule.GetAttributeValue<EntityReference>("mb_templateid").Id,
                new ColumnSet("mb_subject", "mb_body", "mb_includesignature", "mb_importance", "mb_recordbutton"));
            var message = new Entity(Tables.Message)
            {
                ["mb_name"] = template.GetAttributeValue<string>("mb_subject"),
                ["mb_body"] = template.GetAttributeValue<string>("mb_body"),
                ["mb_includesignature"] = template.GetAttributeValue<bool?>("mb_includesignature") ?? true,
                ["mb_recipienttype"] = new OptionSetValue(SendTo.NotificationRule),
                ["mb_notificationruleid"] = rule.ToEntityReference(),
                ["mb_templateid"] = template.ToEntityReference(),
                ["mb_regardingtable"] = table,
                ["mb_regardingid"] = recordId.ToString(),
                ["mb_status"] = new OptionSetValue(MessageStatus.Queued),
                ["ownerid"] = rule.GetAttributeValue<EntityReference>("ownerid")
            };
            if (template.GetAttributeValue<OptionSetValue>("mb_importance") != null) { message["mb_importance"] = template["mb_importance"]; }
            if (template.GetAttributeValue<OptionSetValue>("mb_recordbutton") != null) { message["mb_recordbutton"] = template["mb_recordbutton"]; }
            if (rule.GetAttributeValue<OptionSetValue>("mb_deliverymode") != null) { message["mb_deliverymode"] = rule["mb_deliverymode"]; }
            if (rule.GetAttributeValue<EntityReference>("mb_signatureid") != null) { message["mb_signatureid"] = rule["mb_signatureid"]; }
            svc.Create(message);

            svc.Update(new Entity(Tables.Rule, _ruleId)
            {
                ["mb_lasttriggeredon"] = DateTime.UtcNow,
                ["mb_triggercount"] = (rule.GetAttributeValue<int?>("mb_triggercount") ?? 0) + 1
            });
        }

        /// <summary>Optional FetchXML &lt;filter&gt; that the record must match.</summary>
        private static bool MatchesCondition(IOrganizationService svc, string filterXml, string table, Guid id, ITracingService trace)
        {
            if (string.IsNullOrWhiteSpace(filterXml)) { return true; }
            var md = ((RetrieveEntityResponse)svc.Execute(new RetrieveEntityRequest { LogicalName = table, EntityFilters = Microsoft.Xrm.Sdk.Metadata.EntityFilters.Entity })).EntityMetadata;
            var fetch = $"<fetch top='1'><entity name='{table}'><attribute name='{md.PrimaryIdAttribute}'/>" +
                        $"<filter type='and'><condition attribute='{md.PrimaryIdAttribute}' operator='eq' value='{id}'/>{filterXml.Trim()}</filter></entity></fetch>";
            var hit = svc.RetrieveMultiple(new FetchExpression(fetch)).Entities.Count > 0;
            trace.Trace(hit ? "Condition matched." : "Condition not matched; no email.");
            return hit;
        }
    }
}
