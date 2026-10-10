# Email Notification Hub — User Guide

**Install → Configure → Use.** This guide covers administrators (install, configure, secure) and everyday users
(templates, lists, signatures, sending).

- Publisher: **Muhammad Bilal** (`mb`)
- Solution: **Email Notification Hub** (`EmailNotificationHub`)
- App: **Email Notification Hub** (model-driven)

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Install the solution](#2-install-the-solution)
3. [Turn on the delivery flow](#3-turn-on-the-delivery-flow)
4. [Configure Email Settings](#4-configure-email-settings)
5. [Security roles](#5-security-roles)
6. [Using the app](#6-using-the-app)
7. [Personalization tokens](#7-personalization-tokens)
8. [Monitoring and troubleshooting](#8-monitoring-and-troubleshooting)
9. [Upgrade and uninstall](#9-upgrade-and-uninstall)
10. [FAQ](#10-faq)

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| A Power Platform environment **with Dataverse** | The tables and the app live there |
| **System Administrator** or **System Customizer** in that environment | To import the solution |
| A **Microsoft 365 mailbox** (a user or service account) with a Power Automate licence | The Office 365 Outlook connection sends the emails |
| *(Optional)* A **shared mailbox** and *Send As* permission for the connection account | To send from e.g. `notifications@yourcompany.com` |

> **Tip.** Use a dedicated service account for the flow connections. Emails then come from a stable mailbox, and
> the flow keeps running when people leave.

## 2. Install the solution

1. Download the solution zip from [`solution/`](../solution) (use the **managed** zip for test and production,
   and the **unmanaged** zip only for development).
2. Go to **https://make.powerapps.com** → choose your environment → **Solutions** → **Import solution**.
3. Browse to the zip → **Next**.
4. **Connections.** The import asks for two connection references:
   - **Email Hub - Dataverse** → pick or create a *Microsoft Dataverse* connection.
   - **Email Hub - Office 365 Outlook** → pick or create an *Office 365 Outlook* connection (signed in as the
     mailbox that should send the emails).
5. **Import.** It takes a few minutes. When it finishes, open **Email Notification Hub** from **Apps**.

## 3. Turn on the delivery flow

1. **Solutions** → **Email Notification Hub** → **Cloud flows** → **Email Hub - Process Email Message**.
2. If it shows **Off**, select **Turn on**. When it complains about connections, open
   **Solutions → Email Notification Hub → Connection references** and set a connection on both references first.
3. The account that owns the connections must have the **Email Hub Administrator** role (it updates every message
   and writes the delivery log).

## 4. Configure Email Settings

Open the app → **Administration → Settings** → **New** (or open the sample *Default* record).

| Field | What it does | Recommended |
|---|---|---|
| **Setting Name** | Label only | `Default` |
| **Active Configuration** | The flow uses the **first active** settings row. Keep only one active row. | Yes |
| **Send From** | *Flow Owner Mailbox* sends from the Outlook connection's mailbox. *Shared Mailbox* sends from the address below. | Your choice |
| **Shared Mailbox Address** | Required when *Send From = Shared Mailbox*. The connection account needs **Send As** on it. | |
| **Reply-To Address** | Optional reply address for every email | |
| **Organization Name** | Value of `{{OrganizationName}}` | Your company name |
| **Default Signature** | Used when a message has no signature selected | |
| **Keep Delivery Log** | Writes one *Email Delivery* row per recipient | Yes |
| **Test Mode** | **Redirects every email** to *Test Mode Recipient*. The subject gets a `[TEST to …]` prefix and CC/BCC are dropped. | **Yes** until you finish testing |
| **Test Mode Recipient** | Where test emails go | Your own address |
| **Max Recipients Per Send** | A message that expands to more recipients fails without sending anything | 500 |
| **Allow External Recipients** | When *No*, only Dataverse users (and Team members) receive email; contacts and external addresses are skipped | Yes |
| **Allowed External Domains** | `;`-separated allow-list (e.g. `contoso.com;fabrikam.com`). Blank = any domain | |
| **Archive BCC Address** | Mailbox blind-copied on every email (e.g. for compliance) | |
| **Global Footer** | HTML added to the end of every email (disclaimer, unsubscribe text). Tokens work here too. | |

If no settings row exists, the flow uses safe defaults: it sends from the flow owner's mailbox with a limit of
500 recipients, external recipients allowed, Test Mode off, and the delivery log kept.

**First test:** keep *Test Mode = Yes*, send a message to a recipient list, and check that the test inbox receives
one email per recipient. Then set *Test Mode = No*.

## 5. Security roles

Assign roles in **Power Platform admin center → Environments → *your env* → Settings → Users + permissions → Users**
(or via Teams). Always add the platform's **Basic User** role as well.

| What | Email Hub Administrator | Email Hub Manager | Email Hub Sender |
|---|---|---|---|
| Email Settings | Full | Read | Read |
| Email Templates | Full (all) | Full (all) | Read all · create/edit/delete **own** |
| Recipient Lists | Full (all) | Full (all) | Read all · create/edit/delete **own** |
| List Members | Full (all) | Full (all) | Read all · create/edit/delete **own** |
| Email Signatures | Full (all) | Own only | Own only |
| Email Messages | Full (all) | Read all · edit own | **Own only** |
| Email Deliveries | Full (all) | Read all | Read **own** |
| Users / Contacts / Teams | Read | Read | Read |

Notes:

- **Who should get what.** *Sender* is for everyone who sends emails. *Manager* is for people who curate the
  shared template library and shared lists. *Administrator* is for the app owner and the **flow connection account**.
- Senders can link their messages to **any** shared template or list (org-level *Append To*). Because of that, a
  Sender can also add their own members to a list owned by someone else. If that is not acceptable, lower *Append To*
  on *Recipient List* to *User* in the Sender role. Senders can then only send to their own lists.
- Share a template or list with specific people or teams with the standard **Share** command. It respects these roles.

## 6. Using the app

### 6.1 Navigation

| Area | Item | Purpose |
|---|---|---|
| Overview | **Overview** | Dashboard: messages by status, deliveries by status, my messages, failed deliveries, the queue |
| Overview | **Getting Started** | In-app quick guide and token reference |
| Send | **Email Messages** | Compose, send and track |
| Send | **Delivery Log** | Every per-recipient delivery |
| Library | **Templates** | Reusable subject + body |
| Library | **Recipient Lists / List Members** | Email groups |
| Library | **Signatures** | Your personal signatures |
| Administration | **Settings** | Admin configuration |

### 6.2 Create your signature

**Library → Signatures → New** → name it → write it with the rich text editor (logo images by URL, links,
formatting) → tick **My Default** → **Save**. Your default signature is pre-selected on every new message.
Signatures may contain tokens such as `{{SenderName}}` or `{{SenderJobTitle}}`.

### 6.3 Create a template

**Library → Templates → New**:

- **Template Name**, **Category** (General, Announcement, Reminder, Alert, Onboarding, Follow-up)
- **Subject** and **Body** — use tokens like `Hi {{FirstName}}`
- **Importance**, **Include Signature**, **Usage Notes**

Put `{{Signature}}` where the signature should go. Without it, the signature is added at the end.

### 6.4 Create a recipient list (email group)

**Library → Recipient Lists → New** → name, type, description → **Save** → in **Members**, select **+ New**:

| Member Type | What you fill in | Who receives it |
|---|---|---|
| **User** | Pick a Dataverse user; email and names fill in automatically | That user |
| **Contact** | Pick a contact; email, names and company fill in automatically | That contact |
| **Team** | Pick a Dataverse team (owner team or Microsoft Entra group team) | Every enabled member of the team at send time |
| **External Email** | Email, first name, last name, company | That address |

Tick **Opted Out** to keep someone on the list without emailing them. They are logged as *Skipped*.

### 6.5 Send an email

1. **Send → Email Messages → New**.
2. **Send To**:
   - *Single User* → pick **To User**
   - *Single Contact* → pick **To Contact**
   - *Recipient List* → pick **Recipient List**
   - *Email Addresses* → type addresses separated by `;`, `,` or new lines
3. **Delivery Mode**:
   - *Personalized (one email per recipient)* (default) — every person gets their own email with their own
     `{{FirstName}}` etc. Recipients do not see each other.
   - *Single email to all recipients* — one email with everybody on the **To** line. Recipient tokens are blank.
4. Optional **CC** / **BCC** (`;` separated). In personalized mode they are added to **every** email.
5. **Template** → subject, body, importance and *Include Signature* are filled in. If you already typed something,
   you are asked first.
6. Edit the **Subject** and **Body**, choose a **Signature**.
7. Optional **Send After** — the flow waits until then (up to 30 days).
8. Select **Send Now** on the command bar → confirm.

The record locks and **Delivery Status** moves **Queued → Sending → Sent** (or *Partially Sent* / *Failed*).
Refresh the form to follow progress. The **Delivery** section shows totals, and the **Delivery Log** sub-grid
lists every recipient.

**Fix and resend:** on a *Failed* or *Partially Sent* message, correct the problem and select **Send Now** again.
Use **Reset to Draft** first if you want to edit it without sending immediately. Resending sends to **all** recipients again.

### 6.6 Rules the flow applies

1. Lists and Teams are expanded; **duplicate addresses are sent only once**.
2. **Skipped** (and logged): blank or invalid addresses, opted-out members, disabled users, external recipients
   when they are not allowed, domains outside *Allowed External Domains*.
3. More recipients than *Max Recipients Per Send* → the message **fails** and nothing is sent.
4. **Test Mode** redirects everything to the test recipient.

## 7. Personalization tokens

Tokens are **case-sensitive** and work in the subject, body, signature and global footer.

| Token | Personalized mode | Single email mode |
|---|---|---|
| `{{FirstName}}` | Recipient first name | blank |
| `{{LastName}}` | Recipient last name | blank |
| `{{FullName}}` | Recipient full name (or email for typed addresses) | blank |
| `{{Email}}` | Recipient email | blank |
| `{{Company}}` | Contact's account, or the list member's *Company* | blank |
| `{{JobTitle}}` | User/contact job title | blank |
| `{{SenderName}}` | Message owner's full name | same |
| `{{SenderEmail}}` | Message owner's email | same |
| `{{SenderJobTitle}}` | Message owner's job title | same |
| `{{OrganizationName}}` | From Email Settings | same |
| `{{Today}}` | Send date, `yyyy-MM-dd` (UTC) | same |
| `{{Signature}}` | Signature position | same |

Where the values come from:

| Recipient source | Names / email | Company |
|---|---|---|
| Single User / list User / Team member | User record | blank (list User: member *Company*) |
| Single Contact | Contact record | Contact's *Company Name* |
| List Contact | Contact record | Member *Company* (auto-filled from the contact) |
| List External Email | Member fields | Member *Company* |
| Typed Email Addresses | `{{FullName}}` and `{{Email}}` = the address | blank |

## 8. Monitoring and troubleshooting

| Symptom | Check |
|---|---|
| Status stays **Queued** | The flow is **Off**, or its connections are broken. Open the flow → *Run history*. |
| Status **Failed**, *Last Error* mentions Test Mode or Shared Mailbox | Complete Email Settings (*Test Mode Recipient* / *Shared Mailbox Address*). |
| *Last Error*: "more than Max Recipients Per Send" | Raise the limit in Settings or split the list. |
| Deliveries **Skipped** — "Domain not allowed" / "External recipients are not allowed" | Adjust *Allowed External Domains* / *Allow External Recipients*. |
| Deliveries **Failed** — "SendAs denied" | Give the connection account *Send As* on the shared mailbox (Exchange admin center). |
| Senders can't see their Delivery Log | The flow assigns delivery rows to the message owner. The connection account needs the **Email Hub Administrator** role (Assign privilege). |
| Template does not fill the form | The sender needs read access to the template (Sender role reads all templates). |

**Flow run history:** make.powerapps.com → *Solutions* → *Email Notification Hub* → *Cloud flows* →
*Email Hub - Process Email Message* → **28-day run history**.

**Throughput.** Personalized mode sends one email at a time. That is fine for hundreds of recipients. Office 365
Outlook connector and Exchange Online limits apply (roughly 30 messages per minute and 10,000 recipients per day per
mailbox). Use *Single email* mode or several sends for larger audiences.

## 9. Upgrade and uninstall

- **Upgrade:** import the newer **managed** zip. Choose *Upgrade* (recommended) so components removed in the new
  version are deleted. Your data, settings and connections are kept.
- **Uninstall:** *Solutions → Email Notification Hub → Delete*. Deleting a managed solution **removes its tables and
  all their data** (messages, templates, lists, logs). Export what you need first.

## 10. FAQ

**Can it send attachments?** Not in this version. Link to files (SharePoint/OneDrive) in the body instead.

**Can I send from different mailboxes per message?** The mailbox is environment-wide (Email Settings). Use a shared
mailbox for a common sender identity.

**Does it create Dataverse Email activities?** No. It sends through Office 365 Outlook and keeps its own delivery log,
so no server-side sync or mailbox approval is needed.

**Can I trigger a send from another flow or app?** Yes. Create an `mb_emailmessage` row with the fields filled in and
*Delivery Status = Queued*. The delivery flow picks it up.

**Where is the source?** [`app/app-spec.json`](../app/app-spec.json) (tables, forms, views, roles),
[`app/webresources`](../app/webresources) (form scripts), and [`flows/`](../flows) (flow generator + definition).
