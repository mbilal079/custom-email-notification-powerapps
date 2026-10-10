// Minimal Dataverse Web API helper. Auth comes from the signed-in Azure CLI (`az login`);
// no secrets are stored in this repository. The environment URL is always passed in by the caller.
"use strict";
const { execSync } = require("child_process");

const tokens = new Map();

function token(resource) {
  if (!tokens.has(resource)) {
    if (!/^https:\/\/[\w.-]+\/?$/.test(resource)) { throw new Error(`unexpected resource ${resource}`); }
    const out = execSync(`az account get-access-token --resource ${resource} --query accessToken -o tsv`, { encoding: "utf8" });
    tokens.set(resource, out.trim());
  }
  return tokens.get(resource);
}

function normalizeEnv(envUrl) {
  if (!envUrl || !/^https:\/\/[^/]+\.dynamics\.com\/?$/i.test(envUrl)) {
    throw new Error("Pass the environment URL, e.g. https://yourorg.crm.dynamics.com");
  }
  return envUrl.replace(/\/$/, "");
}

async function dv(envUrl, method, path, body, extraHeaders) {
  const base = normalizeEnv(envUrl);
  const res = await fetch(`${base}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token(base)}`,
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: "odata.include-annotations=\"*\"",
      ...(extraHeaders || {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && data.error ? data.error.message : text;
    const err = new Error(`${method} ${path} -> ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return { status: res.status, data, headers: res.headers };
}

module.exports = { dv, token, normalizeEnv };
