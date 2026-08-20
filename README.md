# SalesforceSchoox

Schoox integration for Salesforce — a prototype that syncs each learner's
Schoox LMS course progress (courses completed, in progress, estimated time
remaining, learning history) into Salesforce so it's visible directly on the
learner's Contact record.

## Architecture

```
Schoox LMS API  --(scheduled pull)-->  AWS Lambda (sync-lambda)  --(PATCH)-->  Salesforce
   (source)          EventBridge rule       transform + auth          Contact.LMS_* fields
```

- **Salesforce** (`force-app/`): SFDX metadata adding `LMS_*` custom fields to
  the standard `Contact` object, plus a permission set granting read access
  to them.
- **AWS** (`aws/`): a SAM template provisioning a scheduled Lambda
  (`sync-lambda/`) that reads from Schoox, aggregates each learner's course
  data, and PATCHes the summary onto their Contact record via the Salesforce
  REST API.

### Data model — why Contact fields instead of a child object

The Salesforce org (`data-speed-169`, org type **Base Edition**, trial) has no
free custom-object slots — an initial `Learner_Course__c` child object (one
row per course enrollment) failed to deploy with `reached maximum number of
custom objects`. Instead, each learner's LMS data is stored as an **aggregate
summary directly on their Contact**:

| Field | Purpose |
|---|---|
| `LMS_Courses_Enrolled__c` | Total enrolled courses |
| `LMS_Courses_Completed__c` | Completed count |
| `LMS_Courses_In_Progress__c` | In-progress count |
| `LMS_Overall_Percent_Complete__c` | Average % complete across all courses |
| `LMS_Estimated_Hours_Remaining__c` | Summed estimated remaining hours |
| `LMS_Next_Due_Date__c` | Earliest due date among incomplete courses |
| `LMS_Learning_History__c` | Long-text, one line per course (name, status, %, due date) |
| `LMS_Last_Synced__c` | Timestamp of last successful sync |

Trade-off: you get a per-learner summary, not a reportable/sortable list of
individual course records. If the org is later upgraded past Base Edition (or
a Developer Edition org is used instead), this can be revisited as a proper
child object with a related list — the AWS Lambda's `transform.js` is the
only place that would need to change.

### Schoox API — verified request format

The Schoox API is at `https://api.schoox.com/v1`, not `www.schoox.com` (that
resolves to their marketing site and 404s). Every request needs:

- Header `X-Api-Key: <academy API key>`
- Query parameter `acadId=<numeric academy id>` — the **numeric** id (e.g.
  `2024692081` for AliSFTesting), not the academy slug used in portal URLs.

There is no single "get a user's transcript with progress" endpoint. Per-course
progress instead comes from `GET /v1/courses/{courseId}/students`, which
returns each enrolled learner's `time_enrolled`, `progress` (%), time spent,
and `certificates`. `schooxClient.js` iterates `GET /v1/courses` and pivots
each course's student roster into a per-learner transcript.

## Prerequisites (must happen before this can run for real)

1. **Schoox API access** — obtained. Academy API key + numeric academy id for
   `AliSFTesting`, used as described above.
2. **Salesforce External Client App** — created in `data-speed-169`,
   configured for OAuth 2.0 Client Credentials Flow, with **"Issue JSON Web
   Token (JWT)-based access tokens" disabled** (required for Metadata/SOAP
   API deploys) and a Run-As user assigned the `Learner_Course_Access`
   permission set (required for FLS visibility into the `LMS_*` fields — new
   fields are invisible to any user/integration until a permission set
   grants them). Put the Consumer Key/Secret into the `SalesforceAuthSecret`
   Secrets Manager entry — never in code or source control.
3. **AWS SSO session** — deploy using your own authenticated session
   (`aws sso login` or `aws configure sso`), not shared credentials.
4. **Learner matching** — the sync matches Schoox users to Salesforce
   Contacts by email (`findContactIdByEmail` in `salesforceClient.js`).
   Confirm that's the right match key for your data, or change it.

## Deploy — Salesforce

```bash
npm install --global @salesforce/cli

# Authenticate however you have access — interactively:
sf org login web --alias learner-prototype --instance-url https://data-speed-169.my.salesforce.com
# ...or non-interactively with a Client Credentials Flow access token:
#   SF_ACCESS_TOKEN=<token> sf org login access-token \
#     --instance-url https://data-speed-169.my.salesforce.com \
#     --alias learner-prototype --no-prompt

sf project deploy start --target-org learner-prototype
```

Then assign the `Learner_Course_Access` permission set to whoever (or
whichever integration user) needs to read the `LMS_*` fields:

```bash
sf org assign permset --name Learner_Course_Access --target-org learner-prototype
```

## Deploy — AWS

```bash
aws sso login --profile <your-profile>
cd aws
sam build
sam deploy --guided --profile <your-profile>
```

After the first deploy, populate the two Secrets Manager entries
(`schoox-salesforce-sync/schoox-api`, `schoox-salesforce-sync/salesforce-auth`)
with real values via the AWS Console or CLI — the template seeds them with
placeholders on purpose so nothing sensitive ever lives in this repo.

## Status

- [x] Connectivity to Salesforce, Schoox, and AWS confirmed reachable
- [x] Salesforce `LMS_*` fields deployed to `Contact` in `data-speed-169`
- [x] Permission set deployed and assigned to the integration (Run-As) user
- [x] Contact page layout updated with "Learning Progress" / "Learning History" sections
- [x] Schoox API credentials obtained and verified working (`X-Api-Key` + `acadId`)
- [x] `schooxClient.js` rewritten and confirmed against the live academy
- [x] **End-to-end sync run with real data** — Contacts for `caastha03@gmail.com`
      and `mamtha@umiuscreative.com` now carry live Schoox progress
- [ ] AWS Lambda deployed (`sam deploy`) with real Secrets Manager values —
      the sync above was run as a local script reusing the same Lambda
      modules, not via a deployed Lambda yet
- [ ] Remaining learners (`shankusha19@gmail.com`, `feroze@umiuscreative.com`,
      `a.zaheer@schoox.com`) have no matching Salesforce Contact (missing
      Email field, or no Contact at all) — sync will pick them up automatically
      once those Contacts exist with matching emails
