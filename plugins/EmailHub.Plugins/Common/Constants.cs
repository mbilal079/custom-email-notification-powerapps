namespace EmailHub.Plugins.Common
{
    /// <summary>
    /// Option values of the Email Hub choice columns. They ship inside the solution, so they are the same in every
    /// environment (see flows/choice-values.json, which is generated from the dev environment).
    /// </summary>
    public static class MessageStatus
    {
        public const int Draft = 100000000;
        public const int Queued = 100000001;
        public const int Sending = 100000002;
        public const int Sent = 100000003;
        public const int PartiallySent = 100000004;
        public const int Failed = 100000005;
        public const int Scheduled = 100000006;
        public const int AwaitingOutlook = 100000007;
    }

    public static class SendTo
    {
        public const int SingleUser = 100000000;
        public const int SingleContact = 100000001;
        public const int RecipientList = 100000002;
        public const int EmailAddresses = 100000003;
        public const int NotificationRule = 100000004;
    }

    public static class DeliveryMode
    {
        public const int Personalized = 100000000;
        public const int SingleEmail = 100000001;
    }

    public static class Importance
    {
        public const int Low = 100000000;
        public const int Normal = 100000001;
        public const int High = 100000002;
    }

    public static class MemberType
    {
        public const int User = 100000000;
        public const int Contact = 100000001;
        public const int Team = 100000002;
        public const int ExternalEmail = 100000003;
    }

    public static class DeliveryStatus
    {
        public const int Sent = 100000000;
        public const int Failed = 100000001;
        public const int Skipped = 100000002;
        public const int Pending = 100000003;
    }

    public static class Channel
    {
        public const int Outlook = 100000000;
        public const int Dataverse = 100000001;
    }

    public static class SendFrom
    {
        public const int FlowOwnerMailbox = 100000000;
        public const int SharedMailbox = 100000001;
    }

    /// <summary>mb_designmode on templates.</summary>
    public static class DesignMode
    {
        public const int Settings = 100000000;
        public const int Custom = 100000001;
    }

    /// <summary>mb_recordbutton on templates and messages.</summary>
    public static class RecordButton
    {
        public const int SettingsDefault = 100000000;
        public const int Show = 100000001;
        public const int Hide = 100000002;
    }

    public static class TriggerEvent
    {
        public const int Create = 100000000;
        public const int Update = 100000001;
        public const int CreateOrUpdate = 100000002;
    }

    public static class Tables
    {
        public const string Message = "mb_emailmessage";
        public const string Delivery = "mb_emaildelivery";
        public const string Setting = "mb_emailsetting";
        public const string Signature = "mb_emailsignature";
        public const string Template = "mb_emailtemplate";
        public const string List = "mb_recipientlist";
        public const string Member = "mb_recipientlistmember";
        public const string Rule = "mb_notificationrule";
    }
}
