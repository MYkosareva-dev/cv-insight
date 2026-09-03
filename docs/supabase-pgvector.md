Source: https://supabase.com/docs/guides/ai/vector-columns (see also https://supabase.com/docs/guides/ai/vector-indexes)
Retrieved: 2026-08-30 · Notes for CV Insight (documents table, vector(1536), text-embedding-3-small)

# Supabase pgvector — working notes

## Enabling
`pgvector` is a Postgres extension; enable it per project (Dashboard → Extensions, or
`create extension if not exists vector;` in a migration). It adds the `vector(n)` column
type and similarity operators.

## Vector columns
```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536) not null   -- dimension MUST match the embedding model output
);
```
The dimension is fixed at table creation and must equal the model's output size —
`openai/text-embedding-3-small` → **1536**. Changing the model or dimension without
dropping and re-embedding every row breaks retrieval silently (distances between vectors
from different models are meaningless). Docs note smaller-dimension embeddings generally
perform well — 1536 is our pinned choice, do not change.

## Inserting
Embeddings are inserted as plain number arrays through the normal client:
`await supabase.from('documents').insert({ content, embedding })`.

## Similarity operators
| Operator | Meaning |
|---|---|
| `<=>` | cosine distance (what we use; similarity = `1 - distance`) |
| `<->` | Euclidean distance |
| `<#>` | negative inner product (fastest for normalized vectors) |

## Search functions (the match_documents pattern)
PostgREST cannot express vector operators, so similarity search is wrapped in a SQL
function called via `.rpc()`:
```sql
create or replace function match_documents(query_embedding vector(1536), match_count int default 5)
returns table (id uuid, career_item_id uuid, content text, similarity float)
language sql stable as $$
  select d.id, d.career_item_id, d.content,
         1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.user_id = auth.uid()          -- explicit owner filter, indexable
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
```
Key points: `language sql stable`; ORDER BY the distance expression directly (preserves
index usage); default `security invoker` so the caller's RLS applies — never make it
`security definer` (that would bypass RLS and make the filter the whole access control).
Filtering (`where`) happens inside the function; a threshold can be applied in the
`where` clause or by the caller on the returned similarity.

## Indexing
Without an index every query is an exact scan — fine for small tables, slow as data
grows. Two index types:
- **HNSW** — Supabase's general recommendation: better recall, robust as data changes,
  no training step; `create index on documents using hnsw (embedding vector_cosine_ops);`
- **IVFFlat** — faster to build, needs `lists` tuning and benefits from being created
  AFTER data exists (it trains on existing rows).
The operator class must match the query operator: `vector_cosine_ops` for `<=>`.

## CV Insight specifics
- Table `documents`: one row per career-item chunk; `content` stores
  `title + "\n\n" + chunk` so items stay findable by name; RLS owner-scoped, no UPDATE
  policy (re-embedding is delete-then-insert).
> **ANNOTATION — delete-then-insert is the WRITE shape, not the call order.** Reading
> "delete-then-insert" as a sequence is how the destructive version gets written:
> delete the stale rows, then embed. If the paid embedding call then fails, the item
> has ZERO rows — it has dropped out of `match_documents` entirely, and every later
> scan reports its content as a `gap`, which is the app stating a finding about data
> it never searched. `reindexCareerItem` in `lib/retrieval.ts` therefore embeds FIRST
> and holds the vectors, and only then deletes and inserts; an embed failure changes
> nothing and the previous chunks stay searchable, which is what the "index will
> update on next edit" warning actually promises. The write is still
> delete-then-insert because there is no UPDATE policy — only the sequencing relative
> to the paid call matters.
> **ANNOTATION — chunks per item are capped at 2** (`MAX_CHUNKS_PER_ITEM` in
> `lib/chunking.ts`). Not a tuning choice: rule B9 caps 200 `career_items` AND 500
> `documents` as independent numbers, and 200 x 2 = 400 is what keeps the document
> ceiling unreachable through the item ceiling. Overflow is merged into the last
> chunk rather than dropped.
- `match_documents` filters by `auth.uid()` inside the body AND relies on RLS
  (security invoker) — both must stay true (defense in depth).
- Index: HNSW with `vector_cosine_ops` (chosen over IVFFlat — data grows row by row
  from day one, and HNSW needs no retraining).
