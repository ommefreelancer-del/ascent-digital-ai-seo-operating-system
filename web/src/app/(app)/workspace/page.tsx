import { Topbar } from "@/components/layout/topbar";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export default function WorkspacePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Topbar title="AI Workspace" />
      <WorkspaceShell />
    </div>
  );
}
