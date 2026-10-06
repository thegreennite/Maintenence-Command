// Admin-only: what's actually connected, and real usage against each
// service's free-tier limit, so Lucas can explain the stack to a client
// and see a limit coming before it turns into a bill.
//
// Free-tier figures below are Cloudflare's published limits as of when
// this was written -- they change over time, so treat them as a
// reference point, not a guarantee, and double check
// https://developers.cloudflare.com/workers/platform/pricing/ etc. if a
// number here looks off.

const CF_API = "https://api.cloudflare.com/client/v4";
const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

export async function handleAdminStats(env, corsHeaders) {
  const results = await Promise.allSettled([
    workersUsage(env),
    d1Usage(env),
    pagesUsage(env),
    r2Usage(env),
  ]);

  const [workers, d1, pages, r2] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: r.reason?.message || "Couldn't fetch this one." },
  );

  return jsonOk(
    {
      generatedAt: new Date().toISOString(),
      connections: [
        { name: "Cloudflare Pages", role: "Hosts the app (frontend)", status: "connected", live: true },
        { name: "Cloudflare Workers", role: "API / backend logic", status: "connected", live: true },
        { name: "Cloudflare D1", role: "Database", status: "connected", live: true },
        { name: "Cloudflare R2", role: "Photo storage", status: env.PHOTOS ? "connected" : "not_set_up", live: false, note: "Inspection + checklist-setup photos, organized by building/day." },
        { name: "Google Gemini", role: "AI photo reading", status: env.GOOGLE_AI_KEY ? "connected" : "not_set_up", live: false, note: "Usage not pulled live here — check console.cloud.google.com billing/quotas." },
        { name: "Google Maps", role: "Building location picker", status: env.GOOGLE_MAPS_API_KEY ? "connected" : "not_set_up", live: false, note: "Usage not pulled live here — check console.cloud.google.com billing/quotas." },
        { name: "GitHub", role: "Source code", status: env.GITHUB_REPO_URL ? "connected" : "not_set_up", live: false, note: env.GITHUB_REPO_URL || undefined },
        { name: "GoHighLevel", role: "Weekly 2FA email delivery", status: env.GHL_API_KEY ? "connected" : "not_set_up", live: false, note: "Reused from Revinetic's own GHL account." },
      ],
      usage: { workers, d1, pages, r2 },
    },
    corsHeaders,
  );
}

async function graphql(env, query) {
  const response = await fetch(CF_GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
}

async function workersUsage(env) {
  const data = await graphql(
    env,
    `query {
      viewer {
        accounts(filter: {accountTag: "${env.CLOUDFLARE_ACCOUNT_ID}"}) {
          workersInvocationsAdaptive(
            limit: 10,
            filter: {datetime_geq: "${isoDaysAgo(1)}", datetime_leq: "${isoDaysAgo(0)}", scriptName: "fhg-command-api"}
          ) { sum { requests } }
        }
      }
    }`,
  );
  const requests = data.viewer.accounts[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
  const limit = 100_000;
  return { label: "Requests today", used: requests, limit, unit: "requests", period: "per day", percent: pct(requests, limit) };
}

async function d1Usage(env) {
  const [sizeResult, rowsData] = await Promise.all([
    fetch(`${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.D1_DATABASE_ID}`, {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    }).then((r) => r.json().then((body) => {
      if (!body.success) throw new Error(body.errors?.[0]?.message || "D1 size lookup failed.");
      return body;
    })),
    graphql(
      env,
      `query {
        viewer {
          accounts(filter: {accountTag: "${env.CLOUDFLARE_ACCOUNT_ID}"}) {
            d1AnalyticsAdaptiveGroups(
              limit: 10,
              filter: {datetime_geq: "${isoDaysAgo(30)}", datetime_leq: "${isoDaysAgo(0)}", databaseId: "${env.D1_DATABASE_ID}"}
            ) { sum { rowsRead rowsWritten } }
          }
        }
      }`,
    ),
  ]);

  const fileSizeBytes = sizeResult?.result?.file_size || 0;
  const sums = rowsData.viewer.accounts[0]?.d1AnalyticsAdaptiveGroups?.[0]?.sum;
  const storageLimitBytes = 5 * 1024 * 1024 * 1024;

  return {
    storage: {
      label: "Storage",
      used: Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100,
      limit: 5120,
      unit: "MB",
      period: "total",
      percent: pct(fileSizeBytes, storageLimitBytes),
    },
    rowsRead: {
      label: "Rows read (30d)",
      used: sums?.rowsRead || 0,
      limit: 25_000_000_000,
      unit: "rows",
      period: "per month",
      percent: pct(sums?.rowsRead || 0, 25_000_000_000),
    },
    rowsWritten: {
      label: "Rows written (30d)",
      used: sums?.rowsWritten || 0,
      limit: 50_000_000,
      unit: "rows",
      period: "per month",
      percent: pct(sums?.rowsWritten || 0, 50_000_000),
    },
  };
}

async function pagesUsage(env) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // Cloudflare caps this endpoint at 25 per page -- fine here since 500
  // builds/month is the free-tier ceiling this bar is measuring against;
  // a project regularly exceeding 25 deploys needs pagination added.
  const response = await fetch(
    `${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/power-log-command/deployments?per_page=25`,
    { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
  ).then((r) => r.json());
  if (!response.success) throw new Error(response.errors?.[0]?.message || "Pages deployment lookup failed.");

  const thisMonth = (response.result || []).filter((d) => new Date(d.created_on) >= monthStart).length;
  const limit = 500;
  return { label: "Builds this month", used: thisMonth, limit, unit: "builds", period: "per month", percent: pct(thisMonth, limit) };
}

async function r2Usage(env) {
  if (!env.PHOTOS) return { label: "Photo storage", used: 0, limit: 10240, unit: "MB", period: "total", percent: 0 };

  const data = await graphql(
    env,
    `query {
      viewer {
        accounts(filter: {accountTag: "${env.CLOUDFLARE_ACCOUNT_ID}"}) {
          r2StorageAdaptiveGroups(
            limit: 1,
            filter: {datetime_geq: "${isoDaysAgo(1)}", datetime_leq: "${isoDaysAgo(0)}", bucketName: "fhg-command-photos"}
          ) { max { payloadSize } }
        }
      }
    }`,
  );
  const bytes = data.viewer.accounts[0]?.r2StorageAdaptiveGroups?.[0]?.max?.payloadSize || 0;
  const limitBytes = 10 * 1024 * 1024 * 1024;
  return {
    label: "Photo storage",
    used: Math.round((bytes / (1024 * 1024)) * 100) / 100,
    limit: 10240,
    unit: "MB",
    period: "total",
    percent: pct(bytes, limitBytes),
  };
}

function pct(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 1000) / 10);
}

function jsonOk(data, headers) {
  return new Response(JSON.stringify(data), { status: 200, headers: withJsonHeaders(headers) });
}

function withJsonHeaders(headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return responseHeaders;
}
