# Wiring Plan — KB Tier Migration

> **Goal**: Replace old source-tag system (SRC/ALH/MSTR/NEW) with new tier taxonomy (TR1/TR2/NEWP/NEWL/MSTR) across DB, RPC, retrieval, prompt, UI, and ingest — in one coordinated pass.

---

## Current State

| Layer | File | Old Behavior |
|-------|------|-------------|
| **DB constraint** | `supabase/migrations/0010_new_source_pool.sql` | `source_tag IN ('SRC','ALH','MSTR','NEW')` on `threads` table |
| **RPC** | `match_threads` (in 0010) | Vector + BM25 fused via RRF. NEW gets +0.005 boost. SRC/ALH/MSTR are base. |
| **TypeScript types** | `lib/source-tags.ts:16` | `SourceTag = "SRC" \| "ALH" \| "MSTR" \| "NEW"` |
| **Retrieval modes** | `lib/source-tags.ts:21` | `SourceMode = "SRC" \| "SRC+ALH"` — UI toggle |
| **Tag classifier** | `lib/source-tags.ts:52` | `sourceTagFor()` — PDFs→SRC, help_center→SRC, guidelines.md→MSTR, other .md→ALH |
| **System prompt** | `lib/prompt.ts:25` | `systemPrompt()` — no tier hierarchy, no conflict resolution rules |
| **Teach prompt** | `app/api/admin/teach/route.ts:30` | `TEACH_SYSTEM_PROMPT` — searches SRC+ALH mode, k=10 |
| **Chat route** | `app/api/chat/route.ts:137` | `hybridSearch(query, markets, mode)` — passes mode through |
| **Seed scripts** | `scripts/seed-references.ts`, `scripts/seed-threads.ts` | Seed from `sources/` using old tag logic |
| **Existing data** | `threads` + `messages` tables | SRC/ALH rows = old training + help center. NEW rows = learnt corrections + policy changes. MSTR = master template. |

## Target State

| Tag | Meaning | Retrieval Priority | Source |
|-----|---------|-------------------|--------|
| **TR1** | Master ground truth from operational DB | Highest | `sources/tr1/*.md` (12 files) |
| **TR2** | Reference material (Phase 1 = Slack FAQ procedures, Phase 2 = corrected training) | Base | `sources/tr2/*.md` (22 files) + `sources/tr2/phase2/*.md` (6 files) |
| **NEWP** | New policy changes (admin-taught) | High | Existing NEW rows that are policy changes + future admin teaches tagged as policy |
| **NEWL** | Newly learnt from feedback corrections | Medium-High | Existing NEW rows that are learnt corrections + future feedback-driven teaches |
| **MSTR** | Master template (retrieval-excluded) | Excluded | Unchanged |

**Retrieval priority order**: TR1 > NEWP > NEWL > TR2 (Phase 1 > Phase 2 within TR2 via ref_number ordering)

---

## Complete File Inventory

Every file that references old tags (SRC/ALH/NEW/SourceMode) and must be updated:

| # | File | What References Old Tags | Step |
|---|------|--------------------------|------|
| 1 | `supabase/migrations/0010_new_source_pool.sql` | Constraint + RPC definition (superseded by new migration) | 1 |
| 2 | `lib/source-tags.ts` | `SourceTag`, `SourceMode`, `SOURCE_MODES`, `SOURCE_MODE_LABEL`, `tagsForMode()`, `sourceTagFor()`, `isSourceMode()` | 2 |
| 3 | `lib/retrieve.ts` | `hybridSearch()` takes `mode: SourceMode`, calls `tagsForMode()` | 3 |
| 4 | `lib/prompt.ts` | `systemPrompt()` — no tier hierarchy | 4 |
| 5 | `app/api/chat/route.ts` | Parses `mode` from body, passes to `hybridSearch` | 5 |
| 6 | `app/api/admin/teach/route.ts` | Hardcodes `"SRC+ALH"` mode, `TEACH_SYSTEM_PROMPT` | 6 |
| 7 | `app/api/admin/new-source/route.ts` | Hardcodes `source_tag: "NEW"` on create; GET filters `.eq("source_tag", "NEW")` | 7 |
| 8 | `app/api/admin/reviews/[id]/route.ts` | Mints `"ALH"` reference on approve/correct (line 118: `.eq("source_tag", "ALH")`, line 129: `source_tag: "ALH"`) | 8 |
| 9 | `app/api/admin/reviews/[id]/align/route.ts` | Calls `hybridSearch` with `"SRC+ALH"`, casts `sourceTag as SourceTag` using old types | 8 |
| 10 | `app/api/threads/[slug]/messages/[id]/feedback/route.ts` | Auto-mints `"ALH"` ref on good rating (line 183: `.eq("source_tag", "ALH")`, line 194: `source_tag: "ALH"`); comments reference "ALH" | 8 |
| 11 | `app/api/threads/[slug]/messages/[id]/route.ts` | References `source_tag` in thread queries | 8 |
| 12 | `app/api/admin/users/[uid]/threads/route.ts` | References `source_tag` in thread queries | 8 |
| 13 | `app/sources/page.tsx` | Filters `.in("source_tag", ["SRC", "ALH"])` — would HIDE all new TR1/TR2 content | 9 |
| 14 | `app/t/[slug]/page.tsx` | Imports `SourceTag`, comments say "SRC / ALH / MSTR", passes `sourceTag` to components | 9 |
| 15 | `app/admin/page.tsx` | Filters `.is("source_tag", null)` (only tangential, but verify) | 9 |
| 16 | `components/Chat.tsx` | Imports `SOURCE_MODES`, `SOURCE_MODE_LABEL`, `SourceMode`; renders SRC vs SRC+ALH toggle; passes `mode` to API | 10 |
| 17 | `components/SourcesBrowser.tsx` | Description says "SRC & ALH"; has dynamic tag filter | 10 |
| 18 | `components/NewSourcePanel.tsx` | Creates NEW entries; UI labels reference "NEW" | 10 |
| 19 | `components/TeachChat.tsx` | Teach UI — no tag selector (needs NEWP/NEWL picker) | 10 |
| 20 | `components/AdminDashboard.tsx` | References "source mode (SRC or SRC+ALH)" in UI text | 10 |
| 21 | `components/AlignmentPicker.tsx` | Casts `sourceTag` as old `SourceTag` type | 10 |
| 22 | `components/FeedbackReviewList.tsx` | References `sourceTag` | 10 |
| 23 | `components/ReferenceEditor.tsx` | References `sourceTag` | 10 |
| 24 | `components/SourcesBlock.tsx` | Has regex stripping `SRC-\|ALH-\|MSTR-` from titles; uses `sourceTag` property | 10 |
| 25 | `scripts/seed-references.ts` | `tagOrder` map: `[["SRC", 0], ["ALH", 1], ["MSTR", 2]]` | 11 |
| 26 | `scripts/query.ts` | Defaults to `"SRC+ALH"` mode | 11 |
| 27 | `scripts/eval.ts` | Hardcodes `"SRC+ALH"` mode | 11 |

---

## Migration Steps

### Step 1 — DB Migration (`supabase/migrations/0011_tier_taxonomy.sql`)

```sql
-- 1a. Drop old constraint, add new one
ALTER TABLE threads
  DROP CONSTRAINT IF EXISTS threads_source_tag_check;

ALTER TABLE threads
  ADD CONSTRAINT threads_source_tag_check
  CHECK (source_tag IN ('TR1','TR2','NEWP','NEWL','MSTR','SRC','ALH','NEW'));
  -- Keep old tags temporarily for safe rollback. Remove after data migration confirmed.

-- 1b. Migrate existing data
-- SRC rows → TR2 (these are old reference material, lowest tier)
UPDATE threads SET source_tag = 'TR2' WHERE source_tag = 'SRC';

-- ALH rows → TR2 (same — old help/guidelines material)  
UPDATE threads SET source_tag = 'TR2' WHERE source_tag = 'ALH';

-- NEW rows → NEWL by default (most are learnt corrections from feedback)
-- Any that are policy changes should be manually re-tagged NEWP after migration
UPDATE threads SET source_tag = 'NEWL' WHERE source_tag = 'NEW';

-- MSTR stays MSTR (unchanged)

-- 1c. Replace match_threads RPC with tiered scoring
CREATE OR REPLACE FUNCTION match_threads(
  query_embedding vector(1536),
  query_text      text,
  filter_markets  text[]     DEFAULT '{}',
  filter_tags     text[]     DEFAULT '{}',
  match_count     int        DEFAULT 6,
  candidate_pool  int        DEFAULT 30
)
RETURNS TABLE(
  thread_id   bigint,
  message_id  bigint,
  thread_slug text,
  ref_number  text,
  source_tag  text,
  title       text,
  market      text,
  content     text,
  score       double precision
)
LANGUAGE plpgsql AS $$
DECLARE
  half_pool int := candidate_pool / 2;
BEGIN
  RETURN QUERY
  WITH vector_candidates AS (
    SELECT
      t.id AS t_id,
      m.id AS m_id,
      t.slug,
      t.ref_number,
      t.source_tag,
      t.title,
      t.market,
      m.content,
      ROW_NUMBER() OVER (ORDER BY m.embedding <=> query_embedding) AS rn
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE t.source_tag <> 'MSTR'
      AND (array_length(filter_markets, 1) IS NULL OR t.market = ANY(filter_markets) OR t.market IS NULL)
      AND (array_length(filter_tags, 1) IS NULL OR t.source_tag = ANY(filter_tags))
    ORDER BY m.embedding <=> query_embedding
    LIMIT half_pool
  ),
  keyword_candidates AS (
    SELECT
      t.id AS t_id,
      m.id AS m_id,
      t.slug,
      t.ref_number,
      t.source_tag,
      t.title,
      t.market,
      m.content,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(m.fts, plainto_tsquery('english', query_text)) DESC) AS rn
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE t.source_tag <> 'MSTR'
      AND m.fts @@ plainto_tsquery('english', query_text)
      AND (array_length(filter_markets, 1) IS NULL OR t.market = ANY(filter_markets) OR t.market IS NULL)
      AND (array_length(filter_tags, 1) IS NULL OR t.source_tag = ANY(filter_tags))
    ORDER BY ts_rank_cd(m.fts, plainto_tsquery('english', query_text)) DESC
    LIMIT half_pool
  ),
  fused AS (
    SELECT
      COALESCE(v.t_id, k.t_id) AS t_id,
      COALESCE(v.m_id, k.m_id) AS m_id,
      COALESCE(v.slug, k.slug) AS slug,
      COALESCE(v.ref_number, k.ref_number) AS ref_number,
      COALESCE(v.source_tag, k.source_tag) AS source_tag,
      COALESCE(v.title, k.title) AS title,
      COALESCE(v.market, k.market) AS market,
      COALESCE(v.content, k.content) AS content,
      -- RRF fusion
      COALESCE(1.0 / (60.0 + v.rn), 0.0)
      + COALESCE(1.0 / (60.0 + k.rn), 0.0)
      -- Tier boosts
      + CASE COALESCE(v.source_tag, k.source_tag)
          WHEN 'TR1'  THEN 0.020
          WHEN 'NEWP' THEN 0.010
          WHEN 'NEWL' THEN 0.008
          WHEN 'TR2'  THEN 0.000
          ELSE 0.000
        END
      AS score
    FROM vector_candidates v
    FULL OUTER JOIN keyword_candidates k
      ON v.t_id = k.t_id AND v.m_id = k.m_id
  )
  SELECT
    f.t_id,
    f.m_id,
    f.slug,
    f.ref_number,
    f.source_tag,
    f.title,
    f.market,
    f.content,
    f.score
  FROM fused f
  ORDER BY f.score DESC
  LIMIT match_count;
END;
$$;

-- 1d. After confirming migration, tighten constraint (run manually later)
-- ALTER TABLE threads DROP CONSTRAINT threads_source_tag_check;
-- ALTER TABLE threads ADD CONSTRAINT threads_source_tag_check
--   CHECK (source_tag IN ('TR1','TR2','NEWP','NEWL','MSTR'));
```

**Boost rationale**: RRF base scores are typically 0.008–0.033. A +0.020 boost for TR1 ensures it outranks a TR2 hit even when TR2 scores slightly higher on raw relevance. NEWP/NEWL sit between.

---

### Step 2 — TypeScript Types (`lib/source-tags.ts`)

Replace the entire file:

```typescript
export type SourceTag = 'TR1' | 'TR2' | 'NEWP' | 'NEWL' | 'MSTR';

export function sourceTagFor(filePath: string): SourceTag {
  const p = filePath.replace(/\\/g, '/').toLowerCase();
  if (p.includes('/tr1/'))           return 'TR1';
  if (p.includes('/tr2/'))           return 'TR2';
  if (p.includes('guidelines.md'))   return 'MSTR';
  return 'TR2';
}
```

**Removed exports** (no longer needed — any file importing these will break at compile time, which is intentional to catch all call sites):
- `SourceMode` type
- `SOURCE_MODES` array
- `SOURCE_MODE_LABEL` record
- `tagsForMode()` function
- `isSourceMode()` function

---

### Step 3 — Retrieval (`lib/retrieve.ts`)

```diff
- export async function hybridSearch(query: string, markets: string[], mode: SourceMode, k = 6)
+ export async function hybridSearch(query: string, markets: string[], k = 6)
```

- Remove `tagsForMode(mode)` call.
- Pass empty `filter_tags: []` to RPC (searches everything, tier boosts handle priority).
- Update `RetrievedRef` type: `sourceTag` is now `SourceTag` (new type).
- Remove the `SourceMode` import.

---

### Step 4 — System Prompt (`lib/prompt.ts`)

Rewrite `systemPrompt()` to include:

```
## Knowledge Hierarchy

You have access to a tiered knowledge base. When answering, respect this priority:

1. **TR1** (Tier 1) — Operational ground truth extracted from the live database.
   These are facts: market configurations, claim workflows, shipping carriers,
   refund formulas, cancellation policies. ALWAYS prefer TR1 over any other source.

2. **NEWP** — New policy changes. Recent policy updates taught by admins.
   These override TR1 only when explicitly stated (e.g., "effective [date],
   the old policy X is replaced by Y").

3. **NEWL** — Newly learnt corrections from feedback. Corrections to previous
   AI answers validated by admins. Trust these for the specific scenario they address.

4. **TR2** (Tier 2) — Reference material. Procedural guides, training material,
   and FAQ resolutions. Use for "how to" and soft-skill guidance. If TR2 conflicts
   with TR1 on a factual claim (a rate, a formula, a market), TR1 wins.

## Conflict Resolution

- If two retrieved passages disagree, the higher-tier passage wins.
- Within the same tier, prefer the passage with a more specific ref_number
  (e.g., TR1-006 about refund formulas beats TR2-P2-001 about general policies).
- Never invent policy. If no passage covers the question, say so.
- Cite your sources: include the ref_number (e.g., TR1-006, TR2-015) when stating facts.
```

Keep the existing market-detection logic and date injection unchanged.

---

### Step 5 — Chat Route (`app/api/chat/route.ts`)

- Remove `mode` from the request body parsing (or ignore it for backward compat).
- Update `hybridSearch` call: drop the `mode` argument.
- Everything else (streaming, message saving, tag generation) stays the same.

---

### Step 6 — Teach Route (`app/api/admin/teach/route.ts`)

- Update `hybridSearch` call: drop `mode`.
- Add a `tag` field to the teach request body: `"NEWP"` or `"NEWL"` (default `"NEWL"`).
- When saving the taught thread, use the provided tag instead of hardcoded `"NEW"`.
- Update `TEACH_SYSTEM_PROMPT` to reference the new hierarchy.

---

### Step 7 — New Source Route (`app/api/admin/new-source/route.ts`)

- **POST handler**: Change `source_tag: "NEW"` → accept a `tag` field from the body (`"NEWP"` or `"NEWL"`, default `"NEWP"` since admin-created sources are typically policy).
- **GET handler**: Change `.eq("source_tag", "NEW")` → `.in("source_tag", ["NEWP", "NEWL"])` to show both new-policy and new-learnt items in the admin panel.

---

### Step 8 — Feedback & Review API Routes

**`app/api/admin/reviews/[id]/route.ts`** — Approve/correct flow:
- Line 118: Change `.eq("source_tag", "ALH")` → `.eq("source_tag", "NEWL")` (approved corrections are learnt knowledge).
- Line 129: Change `source_tag: "ALH"` → `source_tag: "NEWL"`.
- Update all comments that say "ALH reference" → "NEWL reference".

**`app/api/admin/reviews/[id]/align/route.ts`** — Alignment comparison:
- Remove hardcoded `"SRC+ALH"` mode from `hybridSearch` call (now modeless).
- Remove old `SourceTag` type cast — the new type already covers the response.

**`app/api/threads/[slug]/messages/[id]/feedback/route.ts`** — Auto-mint on good rating:
- Line 183: Change `.eq("source_tag", "ALH")` → `.eq("source_tag", "NEWL")`.
- Line 194: Change `source_tag: "ALH"` → `source_tag: "NEWL"`.
- Line 13 comment: Change "auto-creates an ALH reference" → "auto-creates a NEWL reference".
- Line 163 comment: Change "auto-minting an ALH reference thread" → "auto-minting a NEWL reference thread".

**`app/api/threads/[slug]/messages/[id]/route.ts`** — Thread message queries:
- Update any `source_tag` type references to use new `SourceTag`.

**`app/api/admin/users/[uid]/threads/route.ts`** — User thread queries:
- Update any `source_tag` type references to use new `SourceTag`.

---

### Step 9 — Page-Level Components (Server)

**`app/sources/page.tsx`**:
- Change `.in("source_tag", ["SRC", "ALH"])` → `.in("source_tag", ["TR1", "TR2", "NEWP", "NEWL"])` (show all non-MSTR content).
- Or simplify to `.neq("source_tag", "MSTR")` since we want everything except the master template.

**`app/t/[slug]/page.tsx`**:
- Update `import type { SourceTag }` — no code change needed since the import name is the same, just the type definition changed.
- Remove comments that say "SRC / ALH / MSTR" → update to "TR1 / TR2 / NEWP / NEWL / MSTR".

**`app/admin/page.tsx`**:
- Verify the `.is("source_tag", null)` filter still makes sense (it filters for conversation threads, not reference threads). No change expected — just verify.

---

### Step 10 — Frontend Components

**`components/Chat.tsx`** — The biggest UI change:
- **Remove** the SRC vs SRC+ALH toggle entirely. No more mode selection.
- Remove imports: `SOURCE_MODES`, `SOURCE_MODE_LABEL`, `SourceMode`, `isSourceMode`.
- Remove `mode` state variable and the toggle UI that renders it.
- Remove `mode` from the API request body sent to `/api/chat`.
- The chat just works — retrieval handles priority via tier boosts.

**`components/SourcesBrowser.tsx`**:
- Change description text from "SRC & ALH" to reflect all tiers.
- Update the dynamic tag filter to show `TR1 | TR2 | NEWP | NEWL` options instead of `SRC | ALH`.

**`components/NewSourcePanel.tsx`**:
- Change UI labels from "NEW" to "New Policy (NEWP)" / "New Learnt (NEWL)".
- Add a tag selector (NEWP vs NEWL) that gets passed to the API.
- Update API call to pass the chosen tag.

**`components/TeachChat.tsx`**:
- Add a NEWP/NEWL tag picker to the teach UI.
- Pass the selected tag in the teach API request body.

**`components/AdminDashboard.tsx`**:
- Remove text that says "source mode (SRC or SRC+ALH)".
- Update any dashboard labels to reflect new tag names.

**`components/AlignmentPicker.tsx`**:
- Remove old `SourceTag` type cast — the new `SourceTag` type already matches.
- If it imports `SourceTag` from `lib/source-tags`, no import change needed.

**`components/FeedbackReviewList.tsx`**:
- Update any UI display of `sourceTag` values — ensure new tag names render correctly.
- No logic changes expected, just display.

**`components/ReferenceEditor.tsx`**:
- Update any UI display or dropdowns that show source tag values.
- If it has a tag picker, update options to TR1/TR2/NEWP/NEWL/MSTR.

**`components/SourcesBlock.tsx`**:
- Line 22: Change regex `SRC|ALH|MSTR` → `TR1|TR2|NEWP|NEWL|MSTR` in title-stripping logic.
- Update `sourceTag` property type reference.

---

### Step 11 — Scripts

**`scripts/seed-references.ts`**:
- Replace `tagOrder` map `[["SRC", 0], ["ALH", 1], ["MSTR", 2]]` → `[["TR1", 0], ["TR2", 1], ["NEWP", 2], ["NEWL", 3], ["MSTR", 4]]`.
- Use `sourceTagFor(filePath)` from updated `lib/source-tags.ts`.
- Add seeding pass for `sources/tr1/` and `sources/tr2/` (including `sources/tr2/phase2/`).
- Each `.md` file becomes one thread. The file's H1 title → `threads.title`, body → `messages.content`.
- `ref_number` = filename prefix (e.g., `TR1-001`, `TR2-015`, `TR2-P2-003`).
- `market` = parse from file content (look for "Applies to" header) or NULL for global.

**`scripts/seed-threads.ts`**:
- Same `sourceTagFor()` update.

**`scripts/ingest.ts`** (if exists):
- Update tagging logic to use new `sourceTagFor()`.
- Embedding model stays Gemini `embedding-001` (1536-dim).

**`scripts/query.ts`**:
- Remove `mode` parameter (default was `"SRC+ALH"`).
- Update `hybridSearch` call to new 3-arg signature (no mode).

**`scripts/eval.ts`**:
- Remove hardcoded `"SRC+ALH"` mode.
- Update `hybridSearch` call to new 3-arg signature (no mode).

---

## Execution Order

```
 1. Write migration SQL (0011_tier_taxonomy.sql)           — Step 1: DB layer
 2. Update lib/source-tags.ts                              — Step 2: Types (compile will flag all broken imports)
 3. Update lib/retrieve.ts                                 — Step 3: Remove mode param
 4. Update lib/prompt.ts                                   — Step 4: New hierarchy prompt
 5. Update app/api/chat/route.ts                           — Step 5: Drop mode
 6. Update app/api/admin/teach/route.ts                    — Step 6: Add NEWP/NEWL tag choice
 7. Update app/api/admin/new-source/route.ts               — Step 7: NEW → NEWP/NEWL
 8. Update feedback + review API routes (4 files)          — Step 8: ALH → NEWL
 9. Update page-level components (3 files)                 — Step 9: Source filters
10. Update frontend components (9 files)                   — Step 10: Remove mode toggle, update UI
11. Update scripts (5 files)                               — Step 11: Tag maps + mode removal
12. Run migration against Supabase                         — Deploy DB changes
13. Run seed for sources/tr1/ and sources/tr2/             — Populate new content
14. Test: verify retrieval returns TR1 hits boosted        — Validation
15. Tighten DB constraint (remove old SRC/ALH/NEW)        — Cleanup
```

Steps 2–11 can be done in a single commit before running the migration (step 12), since the old code still works until the migration runs. After TypeScript compilation passes with the new types (step 2), every broken import is a guaranteed catch — no silent failures.

---

## Data Migration Summary

| Old Tag | New Tag | Count (approx) | Rationale |
|---------|---------|-----------------|-----------|
| SRC | TR2 | ~bulk of threads | Old PDFs + help center = reference material |
| ALH | TR2 | ~subset | Old guidelines = reference material |
| NEW | NEWL | ~all NEW rows | Default to "learnt" — admin can re-tag specific ones as NEWP |
| MSTR | MSTR | 1 | Unchanged, retrieval-excluded |
| _(new)_ | TR1 | 12 files → threads | Seeded from `sources/tr1/` |
| _(new)_ | TR2 | 28 files → threads | Seeded from `sources/tr2/` + `sources/tr2/phase2/` |

---

## Validation Checklist

- [ ] `match_threads` RPC returns TR1 hits with higher scores than TR2 for the same query
- [ ] System prompt includes tier hierarchy and conflict resolution rules
- [ ] Teach endpoint accepts `tag: "NEWP"` or `tag: "NEWL"` and saves correctly
- [ ] Chat endpoint works without `mode` parameter — no mode toggle in UI
- [ ] New-source admin panel shows NEWP/NEWL picker and saves correct tag
- [ ] Feedback auto-mint creates NEWL refs (not ALH)
- [ ] Review approve/correct creates NEWL refs (not ALH)
- [ ] Sources browser shows all tiers (TR1/TR2/NEWP/NEWL), not just old SRC/ALH
- [ ] SourcesBlock title regex strips new tag prefixes correctly
- [ ] All 12 TR1 files + 28 TR2 files are seeded as threads with correct tags
- [ ] Existing NEWL data (migrated from NEW) still retrieves correctly
- [ ] MSTR thread is excluded from retrieval results
- [ ] Old SRC/ALH tags no longer exist in the threads table after cleanup
- [ ] `scripts/query.ts` and `scripts/eval.ts` run without mode errors
- [ ] TypeScript compiles cleanly — no references to SourceMode or old tag literals

---

## Risks & Rollback

- **Rollback**: If anything breaks, the migration keeps old tag values valid in the constraint. Re-run `UPDATE threads SET source_tag = 'SRC' WHERE source_tag = 'TR2'` etc. to revert.
- **Embedding compatibility**: New TR1/TR2 files use the same Gemini embedding-001 model — no vector incompatibility.
- **NEW → NEWL default**: Some NEW rows may be policy changes (should be NEWP). After migration, review and re-tag manually via SQL or admin UI.
- **ALH auto-mint**: The feedback and review routes currently auto-create ALH refs. After migration these create NEWL refs. This is correct behavior — learnt corrections should be NEWL. No rollback concern.
- **Compile-time safety**: Removing `SourceMode` from `lib/source-tags.ts` will cause compile errors in every file that imports it. This is intentional — it guarantees no call site is missed.
