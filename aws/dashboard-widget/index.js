/**
 * CloudWatch custom widget for the schoox-salesforce-sync dashboard.
 *
 * CloudWatch invokes this Lambda to render the widget's content. On a
 * "describe" invocation it returns documentation markdown; otherwise it
 * queries Salesforce directly (same OAuth Client Credentials Flow as the
 * sync Lambda) and returns an HTML table of every synced learner, their
 * Schoox active/inactive status, and a clickable link to each of their
 * courses in Schoox.
 */

const { getSecretJSON } = require("./secrets");

const SALESFORCE_SECRET_ID = process.env.SALESFORCE_SECRET_ID;

const DOCS = `## Schoox Learner Progress
Live list of every learner synced from Schoox into Salesforce: name, email,
active/inactive status in Schoox, course counts, and a direct link to each
enrolled course. Sourced directly from Salesforce Contact records
(\`LMS_*\` fields) at render time — always current, no separate report needed.`;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** Parse "Course Name — Status (85%, due 2026-09-01) — https://..." lines into {name, status, url}. */
function parseCourseLinks(historyText) {
  if (!historyText) return [];
  return historyText.split("\n").filter(Boolean).map((line) => {
    const urlMatch = line.match(/(https?:\/\/\S+)$/);
    const url = urlMatch ? urlMatch[1] : null;
    const withoutUrl = url ? line.slice(0, line.lastIndexOf(url)).replace(/—\s*$/, "").trim() : line;
    const [namePart, ...rest] = withoutUrl.split("—");
    return { name: (namePart || withoutUrl).trim(), detail: rest.join("—").trim(), url };
  });
}

async function getSalesforceToken(creds) {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(`${creds.loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) throw new Error(`Salesforce auth failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchLearners(creds) {
  const { access_token, instance_url } = await getSalesforceToken(creds);
  const soql =
    "SELECT Name, Email, LMS_Active__c, LMS_Courses_Enrolled__c, LMS_Courses_Completed__c, " +
    "LMS_Courses_In_Progress__c, LMS_Overall_Percent_Complete__c, LMS_Estimated_Hours_Remaining__c, " +
    "LMS_Next_Due_Date__c, LMS_Last_Completed_Date__c, LMS_Learning_History__c, LMS_Last_Synced__c " +
    "FROM Contact WHERE LMS_Last_Synced__c != null ORDER BY Name";
  const url = `${instance_url}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!res.ok) throw new Error(`Salesforce query failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.records;
}

function renderHtml(learners) {
  const rows = learners.map((c) => {
    const courses = parseCourseLinks(c.LMS_Learning_History__c);
    const courseLinks = courses
      .map((course) =>
        course.url
          ? `<a href="${escapeHtml(course.url)}" target="_blank">${escapeHtml(course.name)}</a> (${escapeHtml(course.detail)})`
          : `${escapeHtml(course.name)} (${escapeHtml(course.detail)})`
      )
      .join("<br/>");

    const activeBadge = c.LMS_Active__c
      ? `<span style="color:#0a0;font-weight:bold;">Active</span>`
      : `<span style="color:#c00;font-weight:bold;">Inactive</span>`;

    return `<tr>
      <td>${escapeHtml(c.Name)}</td>
      <td>${escapeHtml(c.Email)}</td>
      <td>${activeBadge}</td>
      <td>${c.LMS_Courses_Completed__c ?? 0} / ${c.LMS_Courses_Enrolled__c ?? 0}</td>
      <td>${c.LMS_Courses_In_Progress__c ?? 0}</td>
      <td>${c.LMS_Overall_Percent_Complete__c ?? 0}%</td>
      <td>${c.LMS_Estimated_Hours_Remaining__c ?? 0}</td>
      <td>${escapeHtml(c.LMS_Next_Due_Date__c) || "—"}</td>
      <td>${escapeHtml(c.LMS_Last_Completed_Date__c) || "—"}</td>
      <td>${escapeHtml(c.LMS_Last_Synced__c) || "—"}</td>
      <td>${courseLinks || "—"}</td>
    </tr>`;
  }).join("");

  return `
    <style>
      table.schoox-widget { width: 100%; border-collapse: collapse; font-size: 13px; }
      table.schoox-widget th { text-align: left; background: #232f3e; color: #fff; padding: 6px 8px; white-space: nowrap; }
      table.schoox-widget td { padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
      table.schoox-widget tr:nth-child(even) { background: #f7f7f7; }
    </style>
    <table class="schoox-widget">
      <thead>
        <tr>
          <th>Learner</th><th>Email</th><th>Schoox Status</th>
          <th>Completed</th><th>In Progress</th><th>% Complete</th>
          <th>Hrs Remaining</th><th>Next Due</th><th>Last Completed</th><th>Last Synced</th>
          <th>Courses (Schoox link)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

exports.handler = async (event) => {
  if (event.describe) return DOCS;

  try {
    const sfCreds = await getSecretJSON(SALESFORCE_SECRET_ID);
    const learners = await fetchLearners(sfCreds);
    return renderHtml(learners);
  } catch (err) {
    return `<p style="color:#c00;">Failed to load Schoox learner data: ${escapeHtml(err.message)}</p>`;
  }
};
