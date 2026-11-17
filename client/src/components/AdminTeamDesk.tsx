import { AdminChat } from "@/components/AdminChat";

/**
 * The Team desk: Alex's chat with a few safe tools behind it (look people up, read an account, make a private login link,
 * draft an email, file a request). For the team member who onboards podcasters. Nothing sends until they press Send.
 */
export function AdminTeamDesk() {
  return (
    <div className="flex flex-col gap-3" data-testid="team-desk">
      <div>
        <h2 className="text-lg font-semibold">Team desk</h2>
        <p className="text-sm text-muted-foreground">Ask about a podcaster, make a private login link, or have an email drafted. It can't send, change an account, or see finances.</p>
      </div>
      <AdminChat
        eventId={null}
        endpoint="/api/admin/team-desk"
        title="Team desk"
        subtitle="Looks things up and drafts; you press Send."
        greeting={'Hi. Ask me about a podcaster ("is Frank\'s Zoom connected?"), have me make a private login link, or draft an email. I can look up accounts, but I can\'t send, change anything, or see finances.'}
        placeholder='Is Frank Zaccari’s Zoom connected?'
        froms={["team", "alex"]}
      />
    </div>
  );
}
