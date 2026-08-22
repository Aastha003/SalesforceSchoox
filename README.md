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

With the SAM CLI:

```bash
aws sso login --profile <your-profile>
cd aws
sam build
sam deploy --guided --profile <your-profile>
```

Without the SAM CLI (plain AWS CLI — CloudFormation supports the SAM
transform natively, this is what was actually used to deploy the live stack):

```bash
aws sso login --profile <your-profile>
export AWS_PROFILE=<your-profile>

aws s3api create-bucket --bucket <artifact-bucket> --region <region>

aws cloudformation package \
  --template-file aws/template.yaml \
  --s3-bucket <artifact-bucket> \
  --output-template-file /tmp/packaged-template.yaml \
  --region <region>

aws cloudformation deploy \
  --template-file /tmp/packaged-template.yaml \
  --stack-name schoox-salesforce-sync \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides SchooxAcademyId=<numeric academy id> \
  --region <region>
```

After the first deploy, populate the two Secrets Manager entries
(`schoox-salesforce-sync/schoox-api`, `schoox-salesforce-sync/salesforce-auth`)
with real values via the AWS Console or CLI — the template seeds them with
placeholders on purpose so nothing sensitive ever lives in this repo:

```bash
aws secretsmanager put-secret-value \
  --secret-id schoox-salesforce-sync/schoox-api \
  --secret-string '{"apiKey":"<real Schoox API key>"}'

aws secretsmanager put-secret-value \
  --secret-id schoox-salesforce-sync/salesforce-auth \
  --secret-string '{"loginUrl":"https://<org>.my.salesforce.com","clientId":"<consumer key>","clientSecret":"<consumer secret>"}'
```

Test it manually before waiting for the schedule:

```bash
aws lambda invoke --function-name <SyncFunctionName from stack outputs> /tmp/response.json
cat /tmp/response.json
```

## Status

- [x] Connectivity to Salesforce, Schoox, and AWS confirmed reachable
- [x] Salesforce `LMS_*` fields deployed to `Contact` in `data-speed-169`
- [x] Permission set deployed and assigned to the integration (Run-As) user
- [x] Contact page layout updated with "Learning Progress" / "Learning History" sections
- [x] Schoox API credentials obtained and verified working (`X-Api-Key` + `acadId`)
- [x] `schooxClient.js` rewritten and confirmed against the live academy
- [x] **End-to-end sync run with real data** — Contacts for `caastha03@gmail.com`
      and `mamtha@umiuscreative.com` now carry live Schoox progress
- [x] **AWS Lambda deployed and running on a schedule** — CloudFormation stack
      `schoox-salesforce-sync` in account `503561452191` (`us-east-1`), Lambda
      `schoox-salesforce-sync-SyncFunction-XhESqwiur5xc`, EventBridge rule
      `schoox-salesforce-sync-SyncFunctionScheduled-1SDThvAiwI1f` firing every
      6 hours. Manually invoked once to confirm — `{"synced":2,"skipped":3,"failed":0}`
      — and the `LMS_Last_Synced__c` timestamps on Salesforce match the
      Lambda's CloudWatch log timestamps exactly, confirming the sync is
      genuinely running from AWS, not a local script
- [ ] Remaining learners (`shankusha19@gmail.com`, `feroze@umiuscreative.com`,
      `a.zaheer@schoox.com`) have no matching Salesforce Contact (missing
      Email field, or no Contact at all) — sync will pick them up automatically
      once those Contacts exist with matching emails
- [ ] Real credentials (Schoox API key, Salesforce Consumer Key/Secret) were
      typed in chat during setup — rotate them once the prototype is no
      longer under active testing

## Feature request tracking

A feature list document was provided with items color-coded by status
(green = done, yellow = needs clarification, orange = needs feasibility
check, blue = needs to be built). Tracking against the **blue ("needs to be
built")** items specifically:

| Feature | Status |
|---|---|
| Completion Dates | ✅ Done — `LMS_Last_Completed_Date__c` field added |
| Full list of LMS Users with active/inactive status | ✅ Done — `LMS_Active__c` field added, synced from Schoox's per-user `active` flag |
| Up-to-date course enrollments & status sync | ✅ Done — confirmed via a live report showing current data, including a course-count change picked up automatically between syncs |
| Latest Course master list sync | ✅ Done — `schooxClient.js` re-fetches the course catalog on every run |
| Automatic syncs between Schoox and Salesforce can be scheduled | ✅ Done — EventBridge rule, `rate(6 hours)` |
| Reports & Dashboards module in Salesforce | 🟡 Partial — a real Report (`LMS Learner Progress`, folder `LMS Reports`) is deployed and verified returning live data via the Analytics API; a Dashboard on top of it is not yet built |
| Full Course master list with per-user assigned/completed/pending counts | ⛔ Needs a decision — a true course-level list needs its own object or list view; the org's Base Edition custom-object limit blocks a new object (see "Data model" above) |
| Manual "sync now" buttons in Salesforce | ⛔ Needs new infra — the Lambda currently has no HTTP endpoint; this needs API Gateway in front of it plus a Salesforce button/Quick Action to call it |
| Authorize specific Salesforce Users/Profiles to provision & enroll LMS users | ⛔ Needs new capability — the integration is currently **read-only** from Schoox; provisioning/enrollment would mean writing back to Schoox, which doesn't exist yet |
| Native SF UI/UX polish | ⏸ Deferred — explicitly follow-on work once functionality is complete |
| Learning Path enrollments/tracking | ⛔ Needs investigation — not yet explored against the Schoox API |
