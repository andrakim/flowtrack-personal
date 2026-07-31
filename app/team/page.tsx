import { chatGPTSignOutPath, requireChatGPTUser } from "@/app/chatgpt-auth";
import TeamWorkspaceApp from "./team-workspace-app";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const currentUser = await requireChatGPTUser("/team");

  return (
    <TeamWorkspaceApp
      currentUser={currentUser}
      signOutHref={chatGPTSignOutPath("/team")}
    />
  );
}
