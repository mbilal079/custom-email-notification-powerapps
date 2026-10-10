using System;
using System.Collections.Generic;
using System.Linq;
using EmailHub.Plugins.Common;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;
using Microsoft.Xrm.Sdk.Query;

namespace EmailHub.Plugins.Engine
{
    /// <summary>Turns users, contacts, teams, lists, lookups and typed addresses into <see cref="Recipient"/>s.</summary>
    public sealed class RecipientResolver
    {
        private readonly IOrganizationService _svc;
        private readonly Dictionary<string, EntityMetadata> _metadata = new Dictionary<string, EntityMetadata>(StringComparer.OrdinalIgnoreCase);

        public RecipientResolver(IOrganizationService svc) { _svc = svc; }

        public EntityMetadata Metadata(string table)
        {
            if (!_metadata.TryGetValue(table, out var md))
            {
                var resp = (RetrieveEntityResponse)_svc.Execute(new RetrieveEntityRequest { LogicalName = table, EntityFilters = EntityFilters.Attributes });
                md = resp.EntityMetadata;
                _metadata[table] = md;
            }
            return md;
        }

        public Recipient User(Guid id, string skip = "")
        {
            var u = _svc.Retrieve("systemuser", id, new ColumnSet("fullname", "firstname", "lastname", "internalemailaddress", "jobtitle", "isdisabled"));
            return new Recipient
            {
                Email = u.GetAttributeValue<string>("internalemailaddress") ?? "",
                FirstName = u.GetAttributeValue<string>("firstname") ?? "",
                LastName = u.GetAttributeValue<string>("lastname") ?? "",
                FullName = u.GetAttributeValue<string>("fullname") ?? "",
                JobTitle = u.GetAttributeValue<string>("jobtitle") ?? "",
                Internal = true,
                Party = u.ToEntityReference(),
                SkipReason = u.GetAttributeValue<bool>("isdisabled") ? "User is disabled" : skip
            };
        }

        public Recipient Contact(Guid id, string skip = "", string companyOverride = null)
        {
            var c = _svc.Retrieve("contact", id, new ColumnSet("fullname", "firstname", "lastname", "emailaddress1", "jobtitle", "parentcustomerid"));
            return new Recipient
            {
                Email = c.GetAttributeValue<string>("emailaddress1") ?? "",
                FirstName = c.GetAttributeValue<string>("firstname") ?? "",
                LastName = c.GetAttributeValue<string>("lastname") ?? "",
                FullName = c.GetAttributeValue<string>("fullname") ?? "",
                JobTitle = c.GetAttributeValue<string>("jobtitle") ?? "",
                Company = !string.IsNullOrWhiteSpace(companyOverride) ? companyOverride : c.GetAttributeValue<EntityReference>("parentcustomerid")?.Name ?? "",
                Internal = false,
                Party = c.ToEntityReference(),
                SkipReason = skip
            };
        }

        public IEnumerable<Recipient> TeamMembers(Guid teamId, string skip = "")
        {
            var q = new QueryExpression("systemuser") { ColumnSet = new ColumnSet("fullname", "firstname", "lastname", "internalemailaddress", "jobtitle") };
            q.Criteria.AddCondition("isdisabled", ConditionOperator.Equal, false);
            var link = q.AddLink("teammembership", "systemuserid", "systemuserid");
            link.LinkCriteria.AddCondition("teamid", ConditionOperator.Equal, teamId);
            foreach (var u in RetrieveAll(q))
            {
                yield return new Recipient
                {
                    Email = u.GetAttributeValue<string>("internalemailaddress") ?? "",
                    FirstName = u.GetAttributeValue<string>("firstname") ?? "",
                    LastName = u.GetAttributeValue<string>("lastname") ?? "",
                    FullName = u.GetAttributeValue<string>("fullname") ?? "",
                    JobTitle = u.GetAttributeValue<string>("jobtitle") ?? "",
                    Internal = true,
                    Party = u.ToEntityReference(),
                    SkipReason = skip
                };
            }
        }

        public static Recipient Address(string address, string first = "", string last = "", string full = "", string company = "", string skip = "")
        {
            var name = string.IsNullOrWhiteSpace(full) ? string.Join(" ", new[] { first, last }.Where(s => !string.IsNullOrWhiteSpace(s))) : full;
            return new Recipient
            {
                Email = (address ?? "").Trim(),
                FirstName = first ?? "",
                LastName = last ?? "",
                FullName = string.IsNullOrWhiteSpace(name) ? (address ?? "").Trim() : name,
                Company = company ?? "",
                Internal = false,
                SkipReason = skip
            };
        }

        /// <summary>Any lookup target: users, contacts, teams (expanded), accounts, leads, queues, or a custom table with an email column.</summary>
        public IEnumerable<Recipient> Reference(EntityReference r)
        {
            if (r == null || r.Id == Guid.Empty) { yield break; }
            switch (r.LogicalName)
            {
                case "systemuser": yield return User(r.Id); yield break;
                case "contact": yield return Contact(r.Id); yield break;
                case "team":
                    foreach (var m in TeamMembers(r.Id)) { yield return m; }
                    yield break;
            }
            var md = Metadata(r.LogicalName);
            var emailAttrs = md.Attributes.OfType<StringAttributeMetadata>()
                .Where(a => a.Format == StringFormat.Email && a.IsValidForRead == true && a.AttributeOf == null)
                .Select(a => a.LogicalName)
                .OrderBy(n => n == "emailaddress1" ? 0 : n == "emailaddress" ? 1 : 2).ThenBy(n => n)
                .ToList();
            if (emailAttrs.Count == 0) { yield break; }
            var cols = new List<string>(emailAttrs);
            foreach (var extra in new[] { md.PrimaryNameAttribute, "firstname", "lastname", "jobtitle", "companyname" })
            {
                if (!string.IsNullOrEmpty(extra) && md.Attributes.Any(a => a.LogicalName == extra) && !cols.Contains(extra)) { cols.Add(extra); }
            }
            var rec = _svc.Retrieve(r.LogicalName, r.Id, new ColumnSet(cols.ToArray()));
            var email = emailAttrs.Select(a => rec.GetAttributeValue<string>(a)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) ?? "";
            yield return new Recipient
            {
                Email = email,
                FirstName = rec.GetAttributeValue<string>("firstname") ?? "",
                LastName = rec.GetAttributeValue<string>("lastname") ?? "",
                FullName = md.PrimaryNameAttribute != null ? rec.GetAttributeValue<string>(md.PrimaryNameAttribute) ?? "" : "",
                JobTitle = rec.GetAttributeValue<string>("jobtitle") ?? "",
                Company = rec.GetAttributeValue<string>("companyname") ?? (r.LogicalName == "account" ? rec.GetAttributeValue<string>("name") ?? "" : ""),
                Internal = false,
                Party = md.IsActivityParty == true ? r : null
            };
        }

        /// <summary>Members of a recipient list (users, contacts, teams, external addresses).</summary>
        public IEnumerable<Recipient> ListMembers(Guid listId)
        {
            var q = new QueryExpression(Tables.Member)
            {
                ColumnSet = new ColumnSet("mb_name", "mb_membertype", "mb_userid", "mb_contactid", "mb_teamid", "mb_emailaddress", "mb_firstname", "mb_lastname", "mb_company", "mb_optedout")
            };
            q.Criteria.AddCondition("mb_listid", ConditionOperator.Equal, listId);
            q.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);
            foreach (var m in RetrieveAll(q))
            {
                var skip = m.GetAttributeValue<bool>("mb_optedout") ? "Opted out" : "";
                var type = m.GetAttributeValue<OptionSetValue>("mb_membertype")?.Value;
                var company = m.GetAttributeValue<string>("mb_company");
                if (type == MemberType.User && m.GetAttributeValue<EntityReference>("mb_userid") != null)
                {
                    var u = User(m.GetAttributeValue<EntityReference>("mb_userid").Id, skip);
                    if (!string.IsNullOrWhiteSpace(company)) { u.Company = company; }
                    yield return u;
                }
                else if (type == MemberType.Contact && m.GetAttributeValue<EntityReference>("mb_contactid") != null)
                {
                    yield return Contact(m.GetAttributeValue<EntityReference>("mb_contactid").Id, skip, company);
                }
                else if (type == MemberType.Team && m.GetAttributeValue<EntityReference>("mb_teamid") != null)
                {
                    foreach (var t in TeamMembers(m.GetAttributeValue<EntityReference>("mb_teamid").Id, skip)) { yield return t; }
                }
                else
                {
                    yield return Address(m.GetAttributeValue<string>("mb_emailaddress"), m.GetAttributeValue<string>("mb_firstname"),
                        m.GetAttributeValue<string>("mb_lastname"), null, company, skip);
                }
            }
        }

        public IEnumerable<Entity> RetrieveAll(QueryExpression q)
        {
            q.PageInfo = new PagingInfo { Count = 5000, PageNumber = 1 };
            while (true)
            {
                var page = _svc.RetrieveMultiple(q);
                foreach (var e in page.Entities) { yield return e; }
                if (!page.MoreRecords) { yield break; }
                q.PageInfo.PageNumber++;
                q.PageInfo.PagingCookie = page.PagingCookie;
            }
        }
    }
}
