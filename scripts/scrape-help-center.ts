/**
 * Scrape help.revibe.me articles into a single markdown source file.
 *
 * The help center is a Next.js app that ships article HTML in the page's
 * __NEXT_DATA__ payload. That's better than parsing the rendered DOM: the
 * payload is stable across renders and doesn't include chrome, navigation, or
 * related-article widgets.
 *
 * Output: sources/uae_help_center.md — market='uae' because the site is
 * UAE-scoped (title says "Revibe UAE EN Help Center", phone numbers are UAE).
 * When help.revibe.me spins up per-market variants, this script gets a
 * --market flag; for now, one file, UAE only.
 *
 *   npm run scrape:help
 *   npm run scrape:help -- --concurrency 3
 *   npm run scrape:help -- --limit 5      # smoke test
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SITEMAP = "https://help.revibe.me/sitemap.xml";
const OUTPUT = "sources/uae_help_center.md";
const USER_AGENT = "Mozilla/5.0 (compatible; RevibeKB/1.0; +internal)";

type Article = { url: string; title: string; description: string | null; markdown: string };

function parseArgs(argv: string[]) {
  let concurrency = 5;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency") concurrency = Number(argv[++i]) || concurrency;
    else if (argv[i] === "--limit") limit = Number(argv[++i]) || null;
  }
  return { concurrency, limit };
}

async function fetchText(url: string, attempts = 3): Promise<string> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function articleUrls(): Promise<string[]> {
  const xml = await fetchText(SITEMAP);
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = match[1];
    // Skip category pages (`/en-US/articles/...`) and non-article pages.
    if (!/\/en-US\/[^/]+-\d+$/.test(url)) continue;
    if (/\/en-US\/articles\//.test(url)) continue;
    if (/\/en-US\/contact$/.test(url)) continue;
    urls.push(url);
  }
  return [...new Set(urls)];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Turn the article HTML into readable markdown. Deliberately narrow: only tags
 * that meaningfully affect the read (headings, emphasis, lists, links, line
 * breaks) get preserved. Everything else is stripped, which keeps the output
 * embeddable without importing a full HTML→MD library for a scrape script.
 */
function htmlToMarkdown(html: string): string {
  let out = html;

  // Normalise self-closing and paired line-break tags.
  out = out.replace(/<br\s*\/?>/gi, "\n");

  // Headings — h3+ are demoted in-body so the article's own H2 remains the
  // section boundary and the markdown parser doesn't split each subsection out.
  out = out.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n### $1\n\n");
  out = out.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n### $1\n\n");
  out = out.replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, "\n\n**$1**\n\n");

  // Emphasis.
  out = out.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**");
  out = out.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  // Links — keep href when present.
  out = out.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  out = out.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1");

  // Lists.
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  out = out.replace(/<\/?(?:ul|ol)[^>]*>/gi, "\n");

  // Paragraphs and divs collapse to newlines.
  out = out.replace(/<\/(?:p|div|section)>/gi, "\n\n");
  out = out.replace(/<(?:p|div|section)[^>]*>/gi, "");

  // Kill anything remaining (spans, images, iframes, styles, scripts).
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<[^>]+>/g, "");

  out = decodeEntities(out);

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleFromUrl(url: string): string {
  const slug = url.split("/").pop() ?? "";
  return slug
    .replace(/-\d+$/, "")
    .split("-")
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ")
    .replace(/\bRevibe\b/gi, "Revibe");
}

async function scrapeArticle(url: string): Promise<Article | null> {
  const html = await fetchText(url);

  const dataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!dataMatch) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(dataMatch[1]);
  } catch {
    return null;
  }
  const pageProps = (payload as { props?: { pageProps?: Record<string, unknown> } }).props?.pageProps;
  if (!pageProps) return null;

  const htmlContent = typeof pageProps.htmlContent === "string" ? pageProps.htmlContent : "";
  if (!htmlContent || htmlContent.replace(/\s/g, "").length < 40) return null;

  const metas = pageProps.metas as { description?: string } | undefined;
  const description = metas?.description ?? null;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  let title = titleMatch ? decodeEntities(titleMatch[1]).trim() : titleFromUrl(url);
  // Some templates append " | Help Center" — drop it, ingest tags the file already.
  title = title.replace(/\s*[|·]\s*(?:Help Center|Revibe UAE EN Help Center).*$/i, "").trim();

  return { url, title, description, markdown: htmlToMarkdown(htmlContent) };
}

/** Simple worker pool. */
async function pool<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\nFetching sitemap from ${SITEMAP}…`);
  const urls = await articleUrls();
  const targets = args.limit ? urls.slice(0, args.limit) : urls;
  console.log(`Articles to scrape: ${targets.length}${args.limit ? " (limited)" : ""}`);
  console.log(`Concurrency: ${args.concurrency}\n`);

  let ok = 0;
  let fail = 0;
  const failures: { url: string; error: string }[] = [];

  const articles = (
    await pool(targets, args.concurrency, async (url, i) => {
      try {
        const article = await scrapeArticle(url);
        if (!article) throw new Error("no htmlContent in __NEXT_DATA__");
        ok++;
        const label = `[${String(i + 1).padStart(3)}/${targets.length}]`;
        console.log(`  ✓ ${label} ${article.title.slice(0, 70)}`);
        return article;
      } catch (error) {
        fail++;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ url, error: message });
        console.log(`  ✗ [${String(i + 1).padStart(3)}/${targets.length}] ${url}\n     ${message}`);
        return null;
      }
    })
  ).filter((article): article is Article => article !== null);

  if (articles.length === 0) {
    console.error("\nScraped nothing. Aborting.");
    process.exit(1);
  }

  // One file, article-per-section. h1 becomes the doc title, each h2 begins a
  // new section in the markdown parser — one article = one indexed section.
  const parts: string[] = [
    "# Revibe UAE Help Center",
    "",
    "Public FAQ and policy pages from help.revibe.me, scraped for the support",
    "team's knowledge base. Each article below was written for customers, so it",
    "carries the answer to a question customers actually ask.",
    "",
    `Source: ${SITEMAP.replace("/sitemap.xml", "")} — scraped ${targets.length}, kept ${articles.length}`,
    "",
    "---",
    "",
  ];

  for (const article of articles) {
    parts.push(`## ${article.title}`);
    parts.push("");
    if (article.description) {
      parts.push(`_Summary: ${article.description.replace(/\s+/g, " ").trim()}_`);
      parts.push("");
    }
    parts.push(article.markdown);
    parts.push("");
    parts.push(`Source: ${article.url}`);
    parts.push("");
    parts.push("---");
    parts.push("");
  }

  const outPath = resolve(OUTPUT);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, parts.join("\n"), "utf8");

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Written: ${outPath}`);
  console.log(`Kept: ${ok}  Failed: ${fail}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const failure of failures.slice(0, 10)) console.log(`  ${failure.url}\n    ${failure.error}`);
    if (failures.length > 10) console.log(`  … and ${failures.length - 10} more`);
  }
  console.log(`\nNext step:  npm run ingest -- --only uae_help_center\n`);
}

main().catch((error) => {
  console.error("\nScrape failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
