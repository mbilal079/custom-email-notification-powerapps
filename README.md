# Email Notification Hub for Power Apps

A configurable **Power Apps model-driven app + Dataverse + C# plug-ins + Power Automate** solution for sending
personalized emails to a **single user**, a **single contact**, a **recipient list / group** (users, contacts,
Dataverse teams and external addresses), **ad-hoc addresses**, or automatically through **Notification Rules** on
**any table**. Every email is logged as a standard **Email activity** on the recipient's and related record's timeline.

**Install → configure → use.** Import one solution, pick two connections, fill in a Settings record, assign roles.

| | |
|---|---|
| Publisher | Muhammad Bilal (`mb`) |
| Solution | `EmailNotificationHub` — *Email Notification Hub* |
| App | Email Notification Hub (model-driven) |
| Engine | `EmailHub.Plugins` (async Dataverse plug-ins) |
| Channels | Office 365 Outlook (cloud flow, own or shared mailbox) **or** Dataverse Email (server-side sync), set in Settings |

## Features

- **Recipients:** single user, single contact, recipient lists (User / Contact / Team / External Email members), typed
  addresses. Lists and teams are expanded, duplicates removed, opted-out members skipped.
- **Notification Rules:** "when a row in *table X* is created/updated [and matches a FetchXML condition], email the
  owner / creator / email columns / lookup columns / a list / fixed addresses using template Y". Works for standard
  and custom tables. Saving a rule registers its plug-in step automatically.
- **Email activities** with **Regarding** set to the related record (timeline history) on both channels.
- **Templates** with tokens resolved per recipient and from the related record: `{{FirstName}}`, `{{Company}}`,
  `{{SenderName}}`, `{{OrganizationName}}`, `{{Today}}`, `{{Record.<column>}}`, `{{RecordName}}`, `{{RecordUrl}}`,
  `{{Signature}}` …
- **Signatures** (personal, rich text, default per user), **rich text editor** on all HTML fields.
- **Delivery modes:** personalized (one email each) or single email; **Send After** scheduling.
- **Admin settings:** channel, shared mailbox / queue sender, reply-to, footer, **Test Mode** redirect, max recipients,
  external-recipient switch, allowed domains, archive BCC.
- **Delivery log** per email (Pending / Sent / Failed / Skipped + reason) linked to its Email activity.
- **Security roles:** Email Hub Administrator, Email Hub Manager, Email Hub Sender, plus an owner read-access check on
  related records.
- **Overview page** (web resource, no dependencies): live KPIs, SVG charts, recent messages and failures, rules,
  configuration and health checks, per-user customizable; plus an in-app **Getting Started** page.

## Repository layout

| Path | Contents |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Architecture, data model, security design |
| [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) | Install, configure, use, notification rules, troubleshooting |
| [`app/app-spec.json`](app/app-spec.json) | App definition for the Power Platform `model-apps` **app-builder** |
| [`app/webresources/`](app/webresources) | Form scripts, Getting Started page, icons |
| [`plugins/EmailHub.Plugins/`](plugins/EmailHub.Plugins) | C# plug-ins: message processor, Dataverse sender, finalizer, rule manager and rule trigger |
| [`flows/`](flows) | Generator and definitions of the two cloud flows |
| [`scripts/`](scripts) | Deployment helpers |
| [`solution/`](solution) | Exported solution zips (managed + unmanaged) and unpacked source |

## Quick start (packaged solution)

1. Import `solution/EmailNotificationHub_managed.zip` (**make.powerapps.com → Solutions → Import**).
2. Bind the **Email Hub - Dataverse** and **Email Hub - Office 365 Outlook** connection references.
3. Turn on the flows **Email Hub - Send via Outlook** and **Email Hub - Release Scheduled Messages**.
4. Open the app → **Settings** → *Default* record: choose the **Delivery Channel**, start with **Test Mode = Yes**.
5. Assign the security roles. Details are in the [User Guide](docs/USER-GUIDE.md).

## Build from source

Prerequisites: Node.js LTS, .NET SDK, [PAC CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction),
Azure CLI (`az login` with the same identity as `pac auth`), and the
[power-platform-skills](https://github.com/microsoft/power-platform-skills) `model-apps` plugin.

```bash
ENV=https://yourorg.crm.dynamics.com
PLUGIN=/path/to/power-platform-skills/plugins/model-apps

node $PLUGIN/scripts/lint-app-spec.js --spec @app/app-spec.json
node $PLUGIN/scripts/build-model-app.js --env $ENV --spec @app/app-spec.json --apply --verify --publish --sample-data
node scripts/sync-webresources.js $ENV          # push form-script / page updates
node scripts/enable-rich-text.js $ENV           # rich text editor on HTML columns
node scripts/fix-dashboard.js $ENV              # optional: classic dashboard tile heights + view bindings

pwsh scripts/new-plugin-key.ps1                 # once: strong-name key (git-ignored; keep a backup)
dotnet build plugins/EmailHub.Plugins -c Release
node scripts/register-plugins.js $ENV           # assembly, types, steps (--fresh to re-register from scratch)

node scripts/fetch-choice-values.js $ENV
node flows/build-flow-definition.js
node scripts/deploy-flow.js $ENV                # add --activate once the connection references are bound
node scripts/finalize-solution.js $ENV          # command bar buttons into the solution

pac solution export --name EmailNotificationHub --path solution/EmailNotificationHub_unmanaged.zip
pac solution export --name EmailNotificationHub --path solution/EmailNotificationHub_managed.zip --managed
```

> This is a public repository: environment URLs, tenant/org/user ids, connection ids and the plug-in signing key are
> never committed (see `.gitignore`). Scripts take the environment URL as an argument.

## License

[MIT](LICENSE)
