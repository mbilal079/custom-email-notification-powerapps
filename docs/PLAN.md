# Email Notification Hub — Solution Plan

> Publisher: **Muhammad Bilal** (prefix `mb`) · Solution unique name: `EmailNotificationHub`
> Type: Power Apps **model-driven app** + Dataverse + Power Automate cloud flow, shipped as one solution.

## 1. Goal

A solution anyone can **install → configure → use** to send emails from Dataverse to:

- a **single internal user** (Dataverse `systemuser`),
- a **single contact** (Dataverse `contact`),
- a **recipient list / group** (users, contacts, Dataverse teams and external addresses mixed),
- **ad-hoc external addresses** (typed in, `;` separated).

Users manage **reusable templates** with **personalization tokens** (`{{FirstName}}`, `{{Company}}` …) that are
filled in **per recipient** at send time, keep **personal signatures**, and see a **delivery log** per recipient.
Admins control everything from a **Settings** record (sender mailbox, test mode, footer, limits, allowed domains).

### Name options considered

| Name | Notes |
|---|---|
| **Email Notification Hub** ✅ | Chosen — says what it is, works in a sitemap and on an app tile |
| NotifyHub | Short, but generic and widely used |
| MailCraft for Dataverse | Brand-like; less obvious to admins |
| Dataverse Email Center | Descriptive; collides with "Email" system table wording |

## 2. Architecture

```
 ┌──────────────── Model-driven app: "Email Notification Hub" ────────────────┐
 │ Overview dashboard · Email Messages · Delivery Log · Templates · Lists ·   │
 │ List Members · Signatures · Settings · Getting Started (HTML web resource) │
 └───────────────┬────────────────────────────────────────────────────────────┘
                 │ user composes an Email Message and clicks "Send Now"
                 │ (form JS validates → Delivery Status = Queued → save)
                 ▼
 ┌──────────── Dataverse (mb_ tables, row-level security via roles) ──────────┐
 │ mb_emailmessage ──► mb_emaildelivery (one row per recipient)               │
 │   │   ├─► mb_emailtemplate      ├─► mb_emailsignature                     │
 │   │   └─► mb_recipientlist ──► mb_recipientlistmember ─► systemuser /     │
 │   │                                                      contact / team    │
 │   └─ mb_emailsetting (active configuration, read by the flow)              │
 └───────────────┬────────────────────────────────────────────────────────────┘
                 │ Dataverse trigger: mb_emailmessage modified, status = Queued
                 ▼
 ┌──────── Cloud flow "Email Hub - Process Email Message" (in solution) ──────┐
 │ load settings → wait until "Send After" → resolve signature + sender →     │
 │ expand recipients (user/contact/list/team/external) → de-duplicate →       │
 │ enforce limits / allowed domains / test mode → render tokens per recipient │
 │ → send via Office 365 Outlook (own or shared mailbox) → log each delivery  │
 │ → set message status Sent / Partially Sent / Failed + counts               │
 └────────────────────────────────────────────────────────────────────────────┘
   Connection references (bound by the installer on import):
     mb_EmailHubDataverse  (Microsoft Dataverse)
     mb_EmailHubOutlook    (Office 365 Outlook)
```

**Why a cloud flow (not a plug-in or Dataverse email activity)?** Office 365 Outlook works in every tenant without
server-side sync or mailbox approval, supports shared mailboxes, and sends to any external address. The flow and its
connection references travel inside the solution, so the installer only has to pick connections.

**Why a classic dashboard (not a generative page)?** Generative pages are environment-gated; a classic dashboard
installs everywhere the solution can be imported.

## 3. Data model

| Table | Purpose | Key columns |
|---|---|---|
| `mb_emailsetting` **Email Setting** | Admin configuration. The flow reads the first row with *Active Configuration = Yes*. Defaults apply when none exists. | Send From (Flow owner mailbox / Shared mailbox), Shared Mailbox Address, Organization Name, Default Signature, Global Footer (HTML), Max Recipients Per Send, Allow External Recipients, Allowed External Domains, Test Mode, Test Mode Recipient, Archive BCC Address, Keep Delivery Log |
| `mb_emailsignature` **Email Signature** | Personal (user-owned) HTML signatures. | Signature (HTML), My Default |
| `mb_emailtemplate` **Email Template** | Reusable subject + HTML body with tokens. | Subject, Body (HTML), Category, Importance, Include Signature, Usage Notes |
| `mb_recipientlist` **Recipient List** | A named group of recipients. | Description, List Type |
| `mb_recipientlistmember` **List Member** | One member of a list. | List, Member Type (User / Contact / Team / External Email), User, Contact, Team, Email Address, First/Last Name, Company, Opted Out |
| `mb_emailmessage` **Email Message** | One send request (draft → queued → sent). | Send To (Single User / Single Contact / Recipient List / Email Addresses), To User, To Contact, Recipient List, Email Addresses, CC, BCC, Template, Signature, Include Signature, Subject, Body (HTML), Importance, Delivery Mode (Personalized / Single email), Send After, Delivery Status, Sent On, Total / Sent / Failed counts, Last Error |
| `mb_emaildelivery` **Email Delivery** | Per-recipient delivery log, owned by the message owner. | Email Message, Recipient Name, Email Address, Delivery Status (Sent / Failed / Skipped), Subject Sent, Error Detail, Sent At |

## 4. Personalization tokens

Resolved per recipient in *Personalized* mode (recipient tokens are blank in *Single email* mode):

| Token | Value |
|---|---|
| `{{FirstName}}` `{{LastName}}` `{{FullName}}` | Recipient name (user/contact record or list member fields) |
| `{{Email}}` | Recipient email |
| `{{Company}}` `{{JobTitle}}` | Contact's account / user's job title / list member's company |
| `{{SenderName}}` `{{SenderEmail}}` `{{SenderJobTitle}}` | Owner of the Email Message |
| `{{OrganizationName}}` | From Settings |
| `{{Today}}` | Send date (yyyy-MM-dd) |
| `{{Signature}}` | Where to place the signature; when absent the signature is appended to the end |

## 5. User experience

- **Email Message form**: choose *Send To* → only the relevant recipient field is shown; choose a template → subject,
  body, importance and *Include Signature* are filled in (asks before overwriting); body and signature use the
  **rich text editor**; **Send Now** command validates and queues; the record locks once queued; a *Delivery* tab shows
  counts and the per-recipient log.
- **List Member form**: choose *Member Type* → only the matching field is shown; picking a user/contact fills
  email and names automatically.
- **Overview dashboard**: messages by status, deliveries by status, failed deliveries, my recent messages.
- **Getting Started** page in the app: quick setup checklist and token reference.

## 6. Security model

Three roles ship in the solution (assign alongside the platform's *Basic User* role):

| Area | Email Hub Administrator | Email Hub Manager | Email Hub Sender |
|---|---|---|---|
| Settings | Full (org) | Read | Read |
| Templates | Full (org) | Full (org) | Create/edit own · read all |
| Recipient Lists & Members | Full (org) | Full (org) | Create/edit own · read all |
| Signatures | Full (org) | Own only | Own only |
| Email Messages | Full (org) | Read all · edit own | Own only |
| Email Deliveries | Full (org) | Read all | Read own |
| Users / Contacts / Teams | Read | Read | Read |

The flow runs under the **connection owner** (a service account or admin with *Email Hub Administrator*), so it can
update any message and create delivery rows; delivery rows are assigned to the message owner so senders see their own log.

## 7. Guard rails

- **Test Mode** (on by default in the sample settings): every email is redirected to the *Test Mode Recipient*.
- **Max Recipients Per Send** (default 500), **Allow External Recipients**, **Allowed External Domains**.
- Invalid or blank addresses, duplicates and opted-out members are **skipped** and logged.
- Sent messages are read-only; failures are recorded per recipient and on the message (*Last Error*).

## 8. Build & delivery steps

1. Author `app/app-spec.json` (tables, relationships, forms, views, charts, dashboard, sitemap, roles, web resources).
2. Lint → dry run → build with the Power Platform `model-apps` **app-builder** into the dev environment.
3. Post-build: bind the rich text editor to HTML columns, create connection references and the cloud flow
   (`scripts/`), add them to the solution.
4. Export **unmanaged** and **managed** solution zips plus an unpacked source tree to `solution/`.
5. Documentation: `docs/USER-GUIDE.md` (install, configure, use, security, troubleshooting).

## 9. Repository hygiene (public repo)

Never committed: environment URLs, tenant / org / user ids, connection ids, tokens, build workspaces
(`.maker-workspace/`), build logs, `.env` files. See `.gitignore`. Scripts take the environment URL as an argument.
