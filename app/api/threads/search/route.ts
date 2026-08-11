import { NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { missingEnv, configErrorMessage } from "@/lib/config";

export const runtime = "nodejs";

export type ThreadHit = {
  slug: string;
  title: string | null;
  market: string;
  snippet: string | null;
  messageCount: number;
  updatedAt: string;
};

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const missing = missingEnv();
  if (missing.length > 0) {
    return Response.json({ error: configErrorMessage(missing) }, { status: 503 });
  }

  const supabase = db();

  // Empty search shows the archive newest-first rather than nothing, so the
  // Threads tab is browsable without knowing what to look for.
  if (!query) {
    const { data, error } = await supabase
      .from("threads")
      .select("slug, title, market, updated_at, messages(count)")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) return Response.json({ error: error.message }, { status: 500 });

    const hits: ThreadHit[] = (data ?? []).map((row) => {
      const counts = row.messages as unknown as { count: number }[] | null;
      return {
        slug: row.slug as string,
        title: row.title as string | null,
        market: row.market as string,
        snippet: null,
        messageCount: counts?.[0]?.count ?? 0,
        updatedAt: row.updated_at as string,
      };
    });
    return Response.json({ hits });
  }

  const { data, error } = await supabase.rpc("search_threads", { q: query });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const hits: ThreadHit[] = (
    (data ?? []) as {
      slug: string;
      title: string | null;
      market: string;
      snippet: string | null;
      message_count: number;
      updated_at: string;
    }[]
  ).map((row) => ({
    slug: row.slug,
    title: row.title,
    market: row.market,
    snippet: row.snippet,
    messageCount: Number(row.message_count),
    updatedAt: row.updated_at,
  }));

  return Response.json({ hits });
}
