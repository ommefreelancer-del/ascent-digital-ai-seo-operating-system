// Builds a real project status report -- per the spec's "Manage task and
// project status" responsibility. A direct passthrough of real,
// caller-supplied project updates; never invents a project or its status.

import type { ProjectStatusReportEntry, ProjectUpdateEntry } from "../types/admin-request.types.js";

export class ProjectStatusReportBuilder {
  build(projectUpdates: readonly ProjectUpdateEntry[]): ProjectStatusReportEntry[] {
    return projectUpdates.map((update) => ({
      projectName: update.projectName,
      status: update.status,
      note: update.note,
    }));
  }
}
