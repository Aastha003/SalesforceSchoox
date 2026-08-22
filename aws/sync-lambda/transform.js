/**
 * Reduce a learner's Schoox transcript entries into the aggregate LMS_*
 * summary fields stored on their Salesforce Contact. There is one Contact
 * update per learner (not one record per course) because this org's edition
 * has no free custom-object slots for a proper per-course child object —
 * see README.md "Data model" for the trade-off.
 */
function buildContactLmsSummary(transcriptEntries, isActive = true) {
  let completed = 0;
  let inProgress = 0;
  let percentSum = 0;
  let hoursRemaining = 0;
  let nextDueDate = null;
  let lastCompletedDate = null;
  const historyLines = [];

  for (const entry of transcriptEntries) {
    const percentComplete = entry.completion_percentage ?? entry.progress ?? 0;
    const totalMinutes = entry.course_duration_minutes ?? 0;
    const completedMinutes = Math.round((percentComplete / 100) * totalMinutes);
    const remainingHours = Math.max(0, (totalMinutes - completedMinutes) / 60);

    let status = "Not Started";
    if (entry.completed_at) {
      status = "Completed";
      completed++;
      if (!lastCompletedDate || new Date(entry.completed_at) > new Date(lastCompletedDate)) {
        lastCompletedDate = entry.completed_at;
      }
    } else {
      if (percentComplete > 0) {
        status = "In Progress";
        inProgress++;
      }
      if (entry.due_date && new Date(entry.due_date) < new Date()) {
        status = "Overdue";
      }
      hoursRemaining += remainingHours;
      if (entry.due_date && (!nextDueDate || new Date(entry.due_date) < new Date(nextDueDate))) {
        nextDueDate = entry.due_date;
      }
    }

    percentSum += percentComplete;
    const dueStr = entry.due_date ? `due ${entry.due_date.slice(0, 10)}` : "no due date";
    historyLines.push(`${entry.course_name} — ${status} (${percentComplete}%, ${dueStr})`);
  }

  const count = transcriptEntries.length;

  return {
    LMS_Courses_Enrolled__c: count,
    LMS_Courses_Completed__c: completed,
    LMS_Courses_In_Progress__c: inProgress,
    LMS_Overall_Percent_Complete__c: count ? Number((percentSum / count).toFixed(2)) : 0,
    LMS_Estimated_Hours_Remaining__c: Number(hoursRemaining.toFixed(1)),
    LMS_Next_Due_Date__c: nextDueDate ? nextDueDate.slice(0, 10) : null,
    LMS_Last_Completed_Date__c: lastCompletedDate ? lastCompletedDate.slice(0, 10) : null,
    LMS_Active__c: isActive,
    LMS_Learning_History__c: historyLines.join("\n").slice(0, 32768),
    LMS_Last_Synced__c: new Date().toISOString(),
  };
}

module.exports = { buildContactLmsSummary };
