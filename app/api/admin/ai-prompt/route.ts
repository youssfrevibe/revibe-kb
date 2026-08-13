import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { DEFAULT_PROMPT_BODY } from "@/lib/prompt";
import { clearPromptBodyCache } from "@/lib/ai-prompt-config";

export const runtime = "nodejs";

/**
 * The live-editable master prompt body (Admin ▸ KB AI Brain).
 *
 * GET  admin+owner : current body (custom or default), plus the code default
 *                    for diff/restore, plus recent version history.
 * PUT  owner only  : save a new body. Upserts the singleton and appends a
 *                    version row for audit + rollback. Guardrails, persona, and
 *                    market/date context are NOT stored here — they live in
 *                    lib/prompt.ts and wrap this body at request time.
 */

const MAX_BODY_LEN = 20_000;

type VersionRow = {
  id: number;
  body: string;
  updated_by: string | null;
  note: string | null;
  created_at: string;
};

// GET /api/admin/ai-prompt
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();

  const { data: current, error } = await supabase
    .from("ai_prompt_config")
    .select("body, updated_by, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: versions } = await supabase
    .from("ai_prompt_versions")
    .select("id, body, updated_by, note, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const isCustom = typeof current?.body === "string" && current.body.trim().length > 0;

  return Response.json({
    body: isCustom ? current!.body : DEFAULT_PROMPT_BODY,
    isCustom,
    default: DEFAULT_PROMPT_BODY,
    updatedBy: current?.updated_by ?? null,
    updatedAt: current?.updated_at ?? null,
    canEdit: user.role === "owner",
    versions: (versions ?? []) as VersionRow[],
  });
}

// PUT /api/admin/ai-prompt
// body: { body: string; note?: string }
export async function PUT(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  // Editing the brain is owner-only — higher bar than the rest of the dashboard.
  if (user.role !== "owner") {
    return Response.json({ error: "Only the Owner can edit the master prompt" }, { status: 403 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  let payload: { body?: unknown; note?: unknown };
  try {
    payload = (await request.json()) as { body?: unknown; note?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 200) : null;

  if (!body) return Response.json({ error: "body is required" }, { status: 400 });
  if (body.length > MAX_BODY_LEN) {
    return Response.json({ error: `body is too long (${MAX_BODY_LEN} char limit)` }, { status: 400 });
  }

  const supabase = db();
  const now = new Date().toISOString();

  const { error: upsertError } = await supabase
    .from("ai_prompt_config")
    .upsert({ id: 1, body, updated_by: user.email, updated_at: now }, { onConflict: "id" });
  if (upsertError) return Response.json({ error: upsertError.message }, { status: 500 });

  // Append a version row for audit + rollback. Non-fatal if it fails.
  const { error: versionError } = await supabase
    .from("ai_prompt_versions")
    .insert({ body, updated_by: user.email, note });
  if (versionError) console.error("failed to record prompt version:", versionError.message);

  clearPromptBodyCache();

  return Response.json({ ok: true, updatedAt: now, updatedBy: user.email });
}
