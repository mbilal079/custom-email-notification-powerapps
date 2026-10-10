# Email Notification Hub — User Guide

**Install → Configure → Use.** This guide covers administrators (install, configure, secure) and everyday users
(templates, lists, signatures, sending, notification rules).

- Publisher: **Muhammad Bilal** (`mb`)
- Solution: **Email Notification Hub** (`EmailNotificationHub`)
- App: **Email Notification Hub** (model-driven)

---

## Contents

1. [How it works](#1-how-it-works)
2. [Prerequisites](#2-prerequisites)
3. [Install the solution](#3-install-the-solution)
4. [Choose a delivery channel](#4-choose-a-delivery-channel)
5. [Configure Email Settings](#5-configure-email-settings)
6. [Security roles](#6-security-roles)
7. [Using the app](#7-using-the-app)
8. [Notification Rules (automatic emails for any table)](#8-notification-rules-automatic-emails-for-any-table)
9. [Personalization tokens](#9-personalization-tokens)
10. [Monitoring and troubleshooting](#10-monitoring-and-troubleshooting)
11. [Developers: send from code or flows](#11-developers-send-from-code-or-flows)
12. [Upgrade and uninstall](#12-upgrade-and-uninstall)
13. [FAQ](#13-faq)

---

## 1. How it works

1. Someone composes an **Email Message** and selects **Send Now**, or a **Notification Rule** fires because a row
   was created or updated.
2. The **Email Hub plug-in** runs in Dataverse. It works out the recipients, fills in the tokens, creates a standard
   **Email activity** for each email (linked to the recipient and to the related record, so it shows on their
   timelines), and writes one **Email Delivery** row per email.
3. The configured **channel** sends the emails:
   - **Office 365 Outlook** — the cloud flow *Email Hub - Send via Outlook* sends them from the connection's mailbox
     or a shared mailbox.
   - **Dataverse Email** — the plug-in sends each Email activity through server-side synchronization.
4. The plug-in marks each Email activity as sent, then sets the message to **Sent**, **Partially Sent** or **Failed**,
   with counts.

## 2. Prerequisites

| Requirement | Why |
|---|---|
| A Power Platform environment **with Dataverse** | The tables, plug-ins and app live there |
| **System Administrator** or **System Customizer** in that environment | To import the solution |
| *Outlook channel:* a Microsoft 365 mailbox (user or service account) with a Power Automate licence | The Office 365 Outlook connection sends the emails |
| *Dataverse channel:* mailboxes **approved and enabled for server-side synchronization** | `SendEmail` delivers through Exchange |
| *(Optional)* a **shared mailbox** with *Send As* for the sending account, or a **queue** with a mailbox | A common sender address |

## 3. Install the solution

1. Download the zip from [`solution/`](../solution): use **managed** for test and production, and **unmanaged** only
   for development.
2. **make.powerapps.com** → your environment → **Solutions** → **Import solution** → choose the zip → **Next**.
3. **Connections.** Choose or create connections for the two connection references:
   - **Email Hub - Dataverse** → *Microsoft Dataverse*
   - **Email Hub - Office 365 Outlook** → *Office 365 Outlook* (the mailbox that sends for the Outlook channel)
4. **Import.** The plug-in assembly, its steps, the app, roles and flows are all inside the solution.
5. **Solutions → Email Notification Hub → Cloud flows:** make sure both flows are **On**:
   *Email Hub - Send via Outlook* and *Email Hub - Release Scheduled Messages*.
6. The account that owns the flow connections needs the **Email Hub Administrator** role.

## 4. Choose a delivery channel

| | Office 365 Outlook (cloud flow) — default | Dataverse Email (server-side sync) |
|---|---|---|
| Admin setup | None beyond the connections | Approve mailboxes; enable server-side sync |
| Sender | Connection account, or a **shared mailbox** | Message owner's mailbox, or a **queue** (*Send From Queue*) |
| External addresses | Always work | Need **Settings → System settings → Email → Allow messages with unresolved email recipients to be sent = Yes** (unless the address belongs to a contact or lead) |
| Speed | One flow run per message; up to 5 emails in parallel | One async job per email, so in parallel |
| Licensing | Power Automate (Outlook is a standard connector) | No connector needed |
| Email activity | Created as a record, then completed when the flow sends it | Created and sent by Dataverse; tracked like any email |

You can switch at any time in **Email Settings**; the choice applies to messages queued after the change.

## 5. Configure Email Settings

App → **Administration → Settings** → open *Default* (or **New**).

| Field | What it does |
|---|---|
| **Setting Name** / **Active Configuration** | The engine uses the **first active** row. Keep only one active. |
| **Delivery Channel** | Office 365 Outlook (cloud flow) or Dataverse Email (server-side sync), see §4 |
| **Create Email Activities** | Creates an Email activity for every email (timeline history). Always on for the Dataverse channel. |
| **Send From** | *Outlook channel:* *Flow Owner Mailbox* or *Shared Mailbox* |
| **Shared Mailbox Address** | *Outlook channel*, shared mode: the address (connection account needs *Send As*) |
| **Send From Queue** | *Dataverse channel:* send from a queue's mailbox instead of the message owner's |
| **Reply-To Address** | *Outlook channel:* reply address for every email |
| **Organization Name** | `{{OrganizationName}}` |
| **Default Signature** | Used when a message has none |
| **Keep Delivery Log** | Delivery rows are always written (they drive sending); this flag is informational |
| **Test Mode** / **Test Mode Recipient** | **Every email goes to the test recipient** with a `[TEST to …]` subject prefix, and CC/BCC are dropped |
| **Max Recipients Per Send** | A larger send fails without sending anything (default 500) |
| **Allow External Recipients** / **Allowed External Domains** | Limit who can be emailed (`;`-separated domains; blank = any) |
| **Archive BCC Address** | Blind copy of every email |
| **Global Footer** | HTML appended to every email (tokens allowed) |

Without a settings row the engine uses safe defaults: the Outlook channel from the flow owner's mailbox, a limit of 500, external
recipients allowed, Test Mode off and activities on.

**First test:** keep *Test Mode = Yes* with your own address as the test recipient. Send to a list and check that you
get one email per recipient. Then set *Test Mode = No*.

## 6. Security roles

Assign roles in the **Power Platform admin center → Environments → *env* → Settings → Users + permissions**.
Always add **Basic User** as well, since it covers activities and core tables.

| What | Email Hub Administrator | Email Hub Manager | Email Hub Sender |
|---|---|---|---|
| Email Settings | Full | Read | Read |
| Notification Rules | Full | Read | — |
| Email Templates | Full (all) | Full (all) | Read all · manage **own** |
| Recipient Lists & Members | Full (all) | Full (all) | Read all · manage **own** |
| Email Signatures | Full (all) | Own | Own |
| Email Messages | Full (all) | Read all · manage own | **Own** |
| Email Deliveries | Full (all) | Read all | Read **own** |
| Users / Contacts / Teams | Read | Read | Read |

- The engine (plug-ins) runs as **SYSTEM** and assigns activities and delivery rows to the **message owner**.
- Before using a related record, the engine checks that the **message owner can read it**. If not, the message fails
  with a clear error, so tokens can never expose data the sender cannot see.
- Senders can link messages to any shared template or list (org-level *Append To*). This also lets them add members
  to lists they don't own. Lower *Append To* on *Recipient List* in the Sender role if you need to prevent that.

## 7. Using the app

### 7.1 Navigation

| Group | Item | Purpose |
|---|---|---|
| Overview | **Overview**, **Getting Started** | Dashboard, quick guide and token reference |
| Send | **Email Messages**, **Delivery Log** | Compose, send, track |
| Library | **Templates**, **Recipient Lists**, **List Members**, **Signatures** | Reusable content and groups |
| Administration | **Settings**, **Notification Rules** | Admin configuration and automation |

### 7.2 Signature

**Signatures → New** → write it in the rich text editor → tick **My Default** → **Save**. It is pre-selected on new
messages. Tokens like `{{SenderName}}` work in signatures.

### 7.3 Template

**Templates → New**: name, category, **Subject**, **Body** (rich text, tokens), importance, *Include Signature*.
Put `{{Signature}}` where the signature goes; otherwise it is appended.

### 7.4 Recipient list (email group)

**Recipient Lists → New → Save → Members → + New**:

| Member Type | You fill in | Receives |
|---|---|---|
| **User** | Pick a user (email/names auto-fill) | That user |
| **Contact** | Pick a contact (email/names/company auto-fill) | That contact |
| **Team** | Pick a Dataverse team | Every enabled member at send time |
| **External Email** | Address, names, company | That address |

**Opted Out** keeps the member on the list but skips them (logged as *Skipped*).

### 7.5 Send an email

1. **Email Messages → New**.
2. **Send To**: *Single User*, *Single Contact*, *Recipient List* or *Email Addresses* (`;`, `,` or new lines).
3. **Delivery Mode**: *Personalized* (one email each, with their own tokens) or *Single email to all recipients*
   (one email, recipient tokens blank).
4. Optional **CC/BCC** (added to every email).
5. Pick a **Template** (fills subject, body, importance, *Include Signature*), edit, choose a **Signature**.
6. Optional **Send After** (released by the scheduler flow within 15 minutes of that time).
7. **Send Now** → confirm.

Status: **Queued → Sending → (Awaiting Outlook) → Sent / Partially Sent / Failed**. The **Delivery Log** sub-grid
lists every email with its outcome. Each email is also an **Email activity**: open it from the delivery row
(*Email Activity*) or from the contact's or related record's timeline. A message to a single contact is
automatically regarding that contact.

**Resend:** fix the problem on a *Failed* or *Partially Sent* message and select **Send Now** again. That sends to
**all** recipients again. Use **Reset to Draft** to edit first.

### 7.6 What the engine skips (and logs)

Blank or invalid addresses, opted-out members, disabled users, external addresses when they are not allowed, domains
outside the allow-list. Duplicate addresses are sent once.

## 8. Notification Rules (automatic emails for any table)

**Administration → Notification Rules → New.** Rules work on **any table**, standard or custom.

| Field | Example | Meaning |
|---|---|---|
| **Rule Name** | *Task assigned* | |
| **Active** | Yes | Inactive rules do nothing |
| **Table (logical name)** | `task` | The form lists the table's **email columns** and **lookup columns** as you type |
| **When** | Row is created / updated / created or updated | |
| **Only When These Columns Change** | `ownerid,scheduledend` | Updates only; blank = any change |
| **Condition (FetchXML filter)** | `<filter><condition attribute="prioritycode" operator="eq" value="2"/></filter>` | Optional; the row must match |
| **Email Template / Signature / Delivery Mode** | *Task Assigned* | What is sent |
| **Send to Record Owner** | Yes | Owner user, or every member of an owner team |
| **Send to Created By** | No | |
| **Email Columns** | `emailaddress1,emailaddress2` | Text/email columns on the row |
| **Lookup Columns** | `regardingobjectid,parentcustomerid` | The referenced user, contact, account, lead, queue, team or custom row's email |
| **Recipient List / Additional Addresses** | | Fixed recipients |

Saving an active rule validates the table and columns and **registers a plug-in step** on that table automatically.
Deactivating or deleting the rule removes the step. When the rule fires it creates an Email Message (Send To =
*Notification Rule*) **regarding the row**, owned by the rule owner, and the normal engine sends it. Use
`{{Record.<column>}}`, `{{RecordName}}` and `{{RecordUrl}}` in the template.

**Examples**

| Goal | Table | When | Recipients | Template body |
|---|---|---|---|---|
| New task → its owner | `task` | created | Record Owner | `New task {{Record.subject}} due {{Record.scheduledend}} — {{RecordUrl}}` |
| New contact → the contact owner | `contact` | created | Record Owner | `New contact {{RecordName}} ({{Record.emailaddress1}})` |
| Welcome a new contact | `contact` | created | Email Columns `emailaddress1` | `Welcome {{Record.firstname}}!` |
| Case escalated → customer's primary contact | `incident` | updated, columns `prioritycode`, condition priority = High | Lookup Columns `primarycontactid` | |
| Custom project approved → sponsor | `new_project` | updated, columns `new_status`, condition status = Approved | Lookup Columns `new_sponsorid` | |

The sample rule *Sample - Email owner when a task is created* is shipped **inactive**. Tick **Active** to try it.

## 9. Personalization tokens

Case-sensitive; they work in the subject, body, signature and footer. Values are HTML-encoded in the body.

| Token | Value |
|---|---|
| `{{FirstName}}` `{{LastName}}` `{{FullName}}` `{{Email}}` | Recipient (blank in single-email mode) |
| `{{Company}}` `{{JobTitle}}` | Contact's account / list member's company; job title |
| `{{SenderName}}` `{{SenderEmail}}` `{{SenderJobTitle}}` | Message owner (rule owner for rule emails) |
| `{{OrganizationName}}` | Email Settings |
| `{{Today}}` | Send date (UTC, `yyyy-MM-dd`) |
| `{{Record.column}}` | Any column of the related record, formatted (choices show labels, lookups show names, dates `yyyy-MM-dd HH:mm UTC`) |
| `{{RecordName}}` `{{RecordUrl}}` | Related record's name and a link to it |
| `{{Signature}}` | Signature position |

## 10. Monitoring and troubleshooting

| Symptom | Check |
|---|---|
| Stays **Queued** | Plug-in steps disabled? (*Settings → Customizations → Plug-in steps* or the solution's *Plug-in steps*). Check **System Jobs** for errors. |
| Stays **Awaiting Outlook** | The flow *Email Hub - Send via Outlook* is off or its connections are broken (see its run history). |
| Stays **Scheduled** | The flow *Email Hub - Release Scheduled Messages* is off. |
| **Failed**: Test Mode / Shared Mailbox message | Complete Email Settings. |
| **Failed**: "does not have read access to the related record" | The message owner cannot read the regarding row. |
| Delivery **Failed**: unresolved recipients | Dataverse channel: allow unresolved recipients, or use the Outlook channel. |
| Delivery **Failed**: mailbox not approved | Dataverse channel: approve and test the mailbox (Power Platform admin center → Email → Mailboxes). |
| Delivery **Failed**: SendAs denied | Outlook channel: grant *Send As* on the shared mailbox. |
| Rule save error | The message names the problem (table or column not found, no template, no recipients). |
| Rule does not fire | Is it **Active**? Does the row match the **Condition**? Did a watched column change? Check **Registered Steps** on the rule and **System Jobs**. |

Plug-in traces: enable *Plug-in trace log* in system settings and read **Plug-in Trace Logs**.

## 11. Developers: send from code or flows

Create an `mb_emailmessage` row and set `mb_status` to *Queued* (on create or by a later update):

| Column | Value |
|---|---|
| `mb_name` | Subject (tokens allowed) |
| `mb_body` | HTML body (tokens allowed) |
| `mb_recipienttype` | Single User / Single Contact / Recipient List / Email Addresses |
| `mb_touserid` / `mb_tocontactid` / `mb_recipientlistid` / `mb_toaddresses` | Recipients |
| `mb_regardingtable` + `mb_regardingid` | Related record (logical name + GUID): Email activities are created regarding it and `{{Record.x}}` reads it |
| `mb_templateid`, `mb_signatureid`, `mb_deliverymode`, `mb_scheduledon` | Optional |

## 12. Upgrade and uninstall

- **Upgrade:** import the newer **managed** zip and choose *Upgrade*. Data, settings, rules and connections are kept;
  rule steps are re-registered the next time each rule is saved.
- **Uninstall:** first deactivate all Notification Rules (this removes their plug-in steps), then delete the
  solution. Deleting a managed solution **removes its tables and data**. Email activities stay in the standard
  Email table.

## 13. FAQ

**Attachments?** Not in this version. Link to SharePoint/OneDrive files in the body.

**Different sender per message?** The sender is environment-wide: the shared mailbox (Outlook channel), or the
message owner or a queue (Dataverse channel).

**Why are some activities "Canceled"?** On the Outlook channel, an activity whose email the mail server rejected is
closed as Canceled. The delivery row holds the error.

**Where is the source?** [`app/app-spec.json`](../app/app-spec.json), [`app/webresources`](../app/webresources),
[`plugins/EmailHub.Plugins`](../plugins/EmailHub.Plugins) and [`flows/`](../flows).
