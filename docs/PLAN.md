# Email Notification Hub — Solution Plan

> Publisher: **Muhammad Bilal** (prefix `mb`) · Solution unique name: `EmailNotificationHub`
> Type: Power Apps **model-driven app** + Dataverse + **C# plug-ins** + Power Automate cloud flows, shipped as one solution.

## 1. Goal

A solution anyone can **install → configure → use** to email:

- a **single internal user**, a **single contact**,
- a **recipient list / group** (users, contacts, Dataverse teams and external addresses mixed),
- **ad-hoc external addresses**,
- and — through **Notification Rules** — whoever is related to a row in **any table** (standard or custom) when it
  is created or updated: the owner, the creator, any email column, any lookup column, a list, fixed addresses.

Every email is recorded as a standard **Email activity** linked to the recipient and the **related (regarding)
record**, so it shows on timelines. Templates use **personalization tokens** filled per recipient and from the
related record. Admins choose the **delivery channel** and guard rails in **Email Settings**.

### Name options considered

| Name | Notes |
|---|---|
| **Email Notification Hub** ✅ | Chosen — says what it is, works in a sitemap and on an app tile |
| NotifyHub | Short, but generic and widely used |
| MailCraft for Dataverse | Brand-like; less obvious to admins |
| Dataverse Email Center | Descriptive; collides with "Email" system table wording |

## 2. Architecture

```
 ┌────────────── Model-driven app "Email Notification Hub" ──────────────┐
 │ Overview · Getting Started · Email Messages · Delivery Log · Templates │
 │ Recipient Lists · List Members · Signatures · Settings · Rules         │
 └──────────┬──────────────────────────────────────────────┬─────────────┘
            │ Send Now (form JS) → status Queued            │ Notification Rule saved
            ▼                                              ▼
   mb_emailmessage ◄──── NotificationRuleTrigger ◄── step on <any table>
            │            (async plug-in, registered automatically by
            │             NotificationRuleManager when a rule is saved)
            ▼ ProcessEmailMessage (async plug-in)
   ┌──────────────────────────────────────────────────────────────────┐
   │ settings · signature · related record ({{Record.x}}) · recipients│
   │ expand lists/teams/lookups · de-duplicate · guard rails          │
   │ render tokens · create Email activity (Regarding = related row)  │
   │ create one mb_emaildelivery (Pending) per email                  │
   └───────────────┬──────────────────────────────┬───────────────────┘
     Dataverse channel                     Outlook channel
            ▼                                     ▼  status "Awaiting Outlook"
   SendDelivery (async plug-in,         Cloud flow "Email Hub - Send via Outlook"
   one job per email: SendEmail via     (Office 365 Outlook: own or shared mailbox)
   server-side sync)                              │
            └──────────────┬──────────────────────┘
                           ▼ delivery status Sent / Failed
              FinalizeDelivery (async plug-in): closes the Email activity,
              settles the message (Sent / Partially Sent / Failed + counts)

   Cloud flow "Email Hub - Release Scheduled Messages" (every 15 min):
   Scheduled messages whose Send After passed → Queued
```

**Why plug-ins?** Recipient expansion, token rendering, activity creation and status handling run server-side in
Dataverse. They're fast, transactional, retried by the platform, and need no connector licence. Every email on the Dataverse channel
is its own async job, so large sends run in parallel.

**Why still cloud flows?** A plug-in cannot use the Office 365 Outlook connector (the channel that works without
mailbox approval or server-side sync), and cannot wake itself up for scheduled sends.

**Configurable engine.** `Email Settings → Delivery Channel`:

| Channel | Sends with | Needs |
|---|---|---|
| **Office 365 Outlook (cloud flow)** — default | Outlook connector, own or shared mailbox | Two connection references |
| **Dataverse Email (server-side sync)** | `SendEmail` on the Email activity | Approved mailboxes; *allow unresolved recipients* for external addresses |

## 3. Data model

| Table | Purpose | Key columns |
|---|---|---|
| `mb_emailsetting` **Email Setting** | Admin configuration (first active row wins; defaults when none) | Delivery Channel, Create Email Activities, Send From (owner / shared mailbox), Shared Mailbox, Send From Queue, Reply-To, Organization Name, Default Signature, Global Footer, Max Recipients, Allow External, Allowed Domains, Test Mode + Recipient, Archive BCC, Keep Delivery Log |
| `mb_emailsignature` **Email Signature** | Personal HTML signatures (user-owned) | Signature, My Default |
| `mb_emailtemplate` **Email Template** | Reusable subject + HTML body with tokens | Subject, Body, Category, Importance, Include Signature, Usage Notes |
| `mb_recipientlist` / `mb_recipientlistmember` | Email groups | Member Type (User / Contact / Team / External Email), lookups, address, names, company, Opted Out |
| `mb_emailmessage` **Email Message** | One send request | Send To (Single User / Single Contact / Recipient List / Email Addresses / Notification Rule), recipients, CC/BCC, Template, Signature, Subject, Body, Importance, Delivery Mode, Send After, **Regarding Table / Id / Name**, Notification Rule, Delivery Status, counts, Last Error |
| `mb_emaildelivery` **Email Delivery** | One row per email sent (per recipient in personalized mode) | To, CC, BCC, Subject Sent, Body Sent, Channel, Delivery Status (Pending / Sent / Failed / Skipped), Error, **Email Activity** |
| `mb_notificationrule` **Notification Rule** | Automatic email for any table | Table, When (create / update / both), Only When These Columns Change, Condition (FetchXML filter), Template, Signature, Delivery Mode, recipients (owner, created by, email columns, lookup columns, list, addresses), Registered Steps, Last Triggered On, Times Triggered |
| `email` (standard) | Timeline record of every email | Regarding = related record, To = recipient parties |

Message lifecycle: `Draft → Queued → (Scheduled →) Sending → [Awaiting Outlook →] Sent | Partially Sent | Failed`.

## 4. Personalization tokens

| Token | Value |
|---|---|
| `{{FirstName}}` `{{LastName}}` `{{FullName}}` `{{Email}}` `{{Company}}` `{{JobTitle}}` | Recipient (blank in single-email mode) |
| `{{SenderName}}` `{{SenderEmail}}` `{{SenderJobTitle}}` | Owner of the message (rule owner for rule emails) |
| `{{OrganizationName}}` `{{Today}}` | Settings / send date |
| `{{Record.<column>}}` | Any column of the related record, formatted (e.g. `{{Record.subject}}`, `{{Record.scheduledend}}`) |
| `{{RecordName}}` `{{RecordUrl}}` | Related record's name and a link to open it |
| `{{Signature}}` | Signature position (else appended) |

Values inserted into the HTML body are HTML-encoded.

## 5. Security model

| Area | Email Hub Administrator | Email Hub Manager | Email Hub Sender |
|---|---|---|---|
| Settings | Full (org) | Read | Read |
| Notification Rules | Full (org) | Read | — |
| Templates, Lists, Members | Full (org) | Full (org) | Read all · manage own |
| Signatures | Full (org) | Own | Own |
| Email Messages | Full (org) | Read all · manage own | Own |
| Email Deliveries | Full (org) | Read all | Read own |

The plug-ins run as **SYSTEM** for their writes, and assign activities and deliveries to the message owner. Before
reading a related record, the engine checks that the **message owner can read it**
(`RetrievePrincipalAccess`), so tokens can't leak data. Rule steps are registered by the plug-in as SYSTEM, so
Email Hub Administrators don't need System Customizer.

## 6. Guard rails

Test Mode redirect, Max Recipients Per Send, Allow External Recipients, Allowed External Domains, opted-out members,
disabled users, invalid/duplicate addresses (skipped and logged), owner read-access check on the related record,
rules can't watch Email Hub's own tables, recursion depth guards.

## 7. Build & delivery steps

1. `app/app-spec.json` → model-apps **app-builder** (tables, forms, views, charts, dashboard, sitemap, roles).
2. `scripts/enable-rich-text.js` — rich text editor on HTML columns.
3. `plugins/EmailHub.Plugins` → `dotnet build -c Release` → `scripts/register-plugins.js`.
4. `scripts/fetch-choice-values.js` → `flows/build-flow-definition.js` → `scripts/deploy-flow.js`.
5. `scripts/finalize-solution.js` — command buttons into the solution.
6. Export managed + unmanaged solution, unpack to `solution/src`.

## 8. Repository hygiene (public repo)

Never committed: environment URLs, tenant / org / user ids, connection ids, tokens, build workspaces
(`.maker-workspace/`), build logs, the plug-in signing key (`*.snk`). Scripts take the environment URL as an argument.
