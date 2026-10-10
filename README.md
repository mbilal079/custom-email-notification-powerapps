# Email Notification Hub for Power Apps

A configurable **Power Apps model-driven app + Dataverse + Power Automate** solution for sending personalized
emails to a **single user**, a **single contact**, a **recipient list / group** (users, contacts, Dataverse teams and
external addresses) or **ad-hoc external addresses**, with **templates**, **personalization tokens**,
**signatures**, **delivery logging** and **security roles**.

**Install → configure → use.** Import one solution, pick two connections, fill in a Settings record, assign roles.

| | |
|---|---|
| Publisher | Muhammad Bilal (`mb`) |
| Solution | `EmailNotificationHub` — *Email Notification Hub* |
| App | Email Notification Hub (model-driven) |
| Sending | Office 365 Outlook connector (own mailbox or shared mailbox) |

## Features

- **Recipients:** single user, single contact, recipient lists (User / Contact / Team / External Email members),
  or typed addresses. Lists and teams are expanded, duplicates removed, opted-out members skipped.
- **Templates** with tokens — `{{FirstName}}`, `{{LastName}}`, `{{FullName}}`, `{{Email}}`, `{{Company}}`,
  `{{JobTitle}}`, `{{SenderName}}`, `{{SenderEmail}}`, `{{SenderJobTitle}}`, `{{OrganizationName}}`, `{{Today}}`,
  `{{Signature}}` — resolved **per recipient**.
- **Signatures:** personal, rich-text, with a per-user default.
- **Delivery modes:** personalized (one email each) or a single email to everyone. Optional **Send After** scheduling.
- **Admin settings:** sender mailbox (own or shared), reply-to, org name, global footer, **Test Mode** redirect,
  max recipients, external-recipient switch, allowed domains, archive BCC, delivery log on/off.
- **Delivery log** per recipient (Sent / Failed / Skipped + reason), message-level counts and last error.
- **Security roles:** Email Hub Administrator, Email Hub Manager, Email Hub Sender.
- **Overview dashboard** and an in-app **Getting Started** page.

## Repository layout

| Path | Contents |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Architecture, data model, security design |
| [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) | Install, configure, use, troubleshoot |
| [`app/app-spec.json`](app/app-spec.json) | App definition (tables, relationships, forms, views, charts, dashboard, sitemap, roles, sample data) built with the Power Platform `model-apps` **app-builder** |
| [`app/webresources/`](app/webresources) | Form scripts, Getting Started page, table icons |
| [`flows/`](flows) | Generator and definition of the *Email Hub - Process Email Message* cloud flow |
| [`scripts/`](scripts) | Post-build helpers: choice values, rich text editor, flow deployment, solution export |
| [`solution/`](solution) | Exported solution zips (managed + unmanaged) and unpacked source |

## Quick start (install the packaged solution)

1. Import `solution/EmailNotificationHub_managed.zip` in **make.powerapps.com → Solutions → Import**.
2. Bind the **Email Hub - Dataverse** and **Email Hub - Office 365 Outlook** connection references.
3. Turn on the cloud flow **Email Hub - Process Email Message**.
4. Open the app → **Settings** → create the *Default* record (start with **Test Mode = Yes**).
5. Assign the security roles. Full details are in the [User Guide](docs/USER-GUIDE.md).

## Build from source (developers)

Prerequisites: Node.js LTS, [PAC CLI](https://learn.microsoft.com/power-platform/developer/cli/introduction),
Azure CLI (`az login` with the same identity as `pac auth`), and the
[power-platform-skills](https://github.com/microsoft/power-platform-skills) `model-apps` plugin.

```bash
ENV=https://yourorg.crm.dynamics.com
PLUGIN=/path/to/power-platform-skills/plugins/model-apps

# 1. Tables, forms, views, charts, dashboard, app, roles (+ optional sample data)
node $PLUGIN/scripts/lint-app-spec.js --spec @app/app-spec.json
node $PLUGIN/scripts/build-model-app.js --env $ENV --spec @app/app-spec.json --apply --verify --publish --sample-data

# 2. Post-build
node scripts/enable-rich-text.js $ENV          # rich text editor on HTML columns
node scripts/fetch-choice-values.js $ENV       # option values used by the flow
node flows/build-flow-definition.js            # generate the flow definition
node scripts/deploy-flow.js $ENV               # connection references + flow (add --activate once connections are bound)
node scripts/finalize-solution.js $ENV         # add command bar buttons to the solution

# 3. Package
pac solution export --name EmailNotificationHub --path solution/EmailNotificationHub_unmanaged.zip
pac solution export --name EmailNotificationHub --path solution/EmailNotificationHub_managed.zip --managed
```

> This is a public repository: environment URLs, tenant/org/user ids and connection ids are never committed
> (see `.gitignore`). Scripts take them as arguments.

## License

[MIT](LICENSE)
