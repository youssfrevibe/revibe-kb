# sources/

Source material for the knowledge base. **Everything here except this file is
gitignored** — the guidelines and training decks are company IP and shouldn't
land in the repo.

## How market is decided

`lib/markets.ts` reads the market from the filename, so naming matters:

| Filename | Market | Notes |
| --- | --- | --- |
| `uae_guidelines.md` | `uae` | prefix before `_` must be a known market code |
| `ksa_guidelines.md` | `ksa` | |
| `guidelines.md` | `master` | the template with `{{PLACEHOLDER}}` tokens |
| `Revibe - Inbound.pdf` | `global` | anything with no recognised prefix |

Market is a **hard filter** on retrieval, not a ranking hint. The compiled
country files are near-identical apart from interpolated SLAs, fees, and phone
numbers, so similarity search cannot tell them apart and is never asked to. Get
the prefix wrong and answers will quote the wrong market's numbers.

`master` is excluded from customer-facing answers — its uninterpolated
`{{SHIPPING_SLA}}` tokens would leak into replies. It's reachable only by
explicitly choosing "Master (internal)".

## threads/

Put conversation exports here. Anything under `threads/` is parsed by the adapter
registry in `lib/parsers/threads/index.ts` rather than as a document, because a
conversation chunks by question-and-answer exchange, not by heading.

Two adapters ship today:

- **canonical-json** — the documented shape, see
  `lib/parsers/threads/canonical-json.ts`. Convert anything into this and it
  works.
- **chat-log** — `Speaker: message` lines, including WhatsApp's bracketed and
  dashed timestamp formats.

For a format neither handles, add one file implementing `ThreadAdapter` and
register it. Nothing else in the pipeline changes.

Note that `chat-log` guesses who is staff from the speaker name. Check it with
`npm run ingest -- --dry-run --only threads` on a real export before trusting it.

## After adding files

```bash
npm run ingest -- --dry-run
```

Read the output before writing anything: check chunk counts look sane, no table
got split, and nothing produced zero chunks. Then:

```bash
npm run ingest
```
