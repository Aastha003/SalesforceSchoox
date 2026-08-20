/**
 * Schoox API client — verified against the live AliSFTesting academy.
 *
 * Auth: header `X-Api-Key: <key>` plus `acadId=<numeric academy id>` as a
 * query string parameter on every request (NOT a Bearer token, and NOT the
 * academy slug — the numeric id, e.g. 2024692081 for AliSFTesting).
 *
 * There is no single "get a user's transcript" endpoint that returns
 * progress. Per-course, per-student progress instead comes from
 * GET /v1/courses/{courseId}/students, so the sync iterates courses and
 * pivots the results into a per-user shape.
 */

const SCHOOX_API_BASE = process.env.SCHOOX_API_BASE || "https://api.schoox.com/v1";
const SCHOOX_ACADEMY_ID = process.env.SCHOOX_ACADEMY_ID; // numeric academy id, e.g. 2024692081

async function schooxRequest(apiKey, path, extraParams = {}) {
  const params = new URLSearchParams({ acadId: SCHOOX_ACADEMY_ID, ...extraParams });
  const res = await fetch(`${SCHOOX_API_BASE}${path}?${params}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Schoox API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** List active learners in the academy. */
async function listUsers(apiKey) {
  return schooxRequest(apiKey, "/users");
}

/** List courses in the academy (id, title, duration, etc). */
async function listCourses(apiKey) {
  return schooxRequest(apiKey, "/courses");
}

/** Per-student enrollment/progress/certificate data for one course. */
async function getCourseStudents(apiKey, courseId) {
  return schooxRequest(apiKey, `/courses/${courseId}/students`);
}

/**
 * Build every learner's full course-progress list by iterating the academy's
 * courses and pivoting each course's student roster into a per-user map.
 * Returns: Map<schooxUserId, Array<{ course_name, course_duration_minutes,
 *   completion_percentage, enrolled_at, completed_at, due_date }>>
 */
async function buildLearnerTranscripts(apiKey) {
  const courses = await listCourses(apiKey);
  const transcripts = new Map();

  for (const course of courses) {
    const students = await getCourseStudents(apiKey, course.id);
    for (const student of students) {
      const completedAt = student.certificates?.[0]?.time_certified || null;
      const entry = {
        course_name: course.title,
        course_duration_minutes: Number(course.course_duration || 0) * 60,
        completion_percentage: student.progress ?? 0,
        enrolled_at: student.time_enrolled || null,
        completed_at: completedAt,
        due_date: null, // Schoox academy-level courses in this org have no due date; job-training assignments would carry one separately.
      };
      if (!transcripts.has(student.id)) transcripts.set(student.id, []);
      transcripts.get(student.id).push(entry);
    }
  }

  return transcripts;
}

module.exports = { listUsers, listCourses, getCourseStudents, buildLearnerTranscripts };
