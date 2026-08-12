import { NextRequest } from "next/server";
import { currentUser, setTeam, TEAMS, type Team } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Set the current user's team.
 *
 * Called once during onboarding, after the team MCQ. The user record already
 * exists (created by the sign-in exchange) — this only fills in the team
 * slot. Doesn't allow overwriting a team that's already set; teams are meant
 * to be stable, and the Owner can change them if needed via user management.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { team?: unknown };
  try {
    body = (await request.json()) as { team?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const team = body.team as Team;
  if (typeof team !== "string" || !TEAMS.includes(team)) {
    return Response.json({ error: `team must be one of: ${TEAMS.join(", ")}` }, { status: 400 });
  }

  if (user.team && user.team !== team) {
    return Response.json(
      { error: "Team is already set. Ask the Owner if you need it changed." },
      { status: 409 },
    );
  }

  await setTeam(user.uid, team);
  return Response.json({ ok: true, team });
}
