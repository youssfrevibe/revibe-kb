import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { currentUser } from "@/lib/auth";
import { missingEnv, configErrorMessage } from "@/lib/config";
import { embedDocuments } from "@/lib/gemini";
import { newSlug } from "@/lib/slug";
import { MARKET_CODES, isMarket } from "@/lib/markets";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The NEWP source pool — new processes / new policy implementations.
 *
 * POST admin+owner : create a NEWP-tagged reference thread that participates
 *                    in retrieval immediately (with a tier score boost).
 * GET  admin+owner : list the most recent NEWP refs so admins can see the
 *                    policy changes they have added.
 *
 * Each NEWP entry becomes a full reference thread the same way TR1/TR2/MSTR
 * refs do, so the existing thread page (/t/[slug]) and ReferenceEditor
 * work with zero changes.
 */

// GET /api/admin/new-source
export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  const supabase = db();
  const { data, error } = await supabase
    .from("threads")
    .select("id, slug, title, market, ref_number, updated_at, created_at")
    .eq("source_tag", "NEWP")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ entries: data ?? [] });
}

// POST /api/admin/new-source
// body: { title: string; content: string; market?: 'uae'|'ksa'|...|'global' }
export async function POST(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }

  const missing = missingEnv();
  if (missing.length > 0) return Response.json({ error: configErrorMessage(missing) }, { status: 503 });

  let body: { title?: unknown; content?: unknown; market?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; content?: unknown; market?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const marketRaw = typeof body.market === "string" ? body.market.trim().toLowerCase() : "global";
  const market = isMarket(marketRaw) ? marketRaw : "global";

  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  if (!content) return Response.json({ error: "content is required" }, { status: 400 });
  if (title.length > 200) return Response.json({ error: "title is too long (200 char limit)" }, { status: 400 });
  if (content.length > 10_000) return Response.json({ error: "content is too long (10,000 char limit)" }, { status: 400 });

  const supabase = db();
  const now = new Date().toISOString();

  // Structured body so the retrieved chunk carries its own label + provenance.
  const body_ = [
    `**NEW POLICY** · ${market.toUpperCase()} · added by ${user.email}`,
    `Topic: ${title}`,
    "",
    content,
  ].join("\n");

  // Next NEWP ref number. Same select-then-insert as the other seed paths.
  const { data: maxRows } = await supabase
    .from("threads")
    .select("ref_number")
    .eq("source_tag", "NEWP")
    .not("ref_number", "is", null)
    .order("ref_number", { ascending: false })
    .limit(1);
  const nextRefNumber = ((maxRows?.[0]?.ref_number as number) ?? 0) + 1;

  let embedding: number[];
  try {
    [embedding] = await embedDocuments([body_]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `Embedding failed: ${detail}` }, { status: 502 });
  }

  const slug = newSlug();
  const threadTitle = `NEWP · ${market.toUpperCase()} · ${title.slice(0, 60)}${title.length >= 60 ? "…" : ""}`;

  const { data: thread, error: threadError } = await supabase
    .from("threads")
    .insert({
      slug,
      title: threadTitle,
      market,
      source_tag: "NEWP",
      ref_number: nextRefNumber,
    })
    .select("id")
    .single();
  if (threadError) return Response.json({ error: threadError.message }, { status: 500 });

  const { error: messageError } = await supabase
    .from("messages")
    .insert({
      thread_id: thread.id,
      role: "assistant",
      content: body_,
      embedding,
      embedded_at: now,
    });
  if (messageError) return Response.json({ error: messageError.message }, { status: 500 });

  return Response.json({
    ok: true,
    slug,
    refNumber: nextRefNumber,
    market,
    availableMarkets: MARKET_CODES,
  });
}
