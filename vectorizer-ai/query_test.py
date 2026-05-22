"""Sanity ANN query: embed a phrase and find top-5 nearest docs."""
import psycopg2
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer

DSN = "host=localhost port=5432 dbname=search_engine user=search_admin password=supersecretpassword"
QUERY = "artificial intelligence and machine learning"

model = SentenceTransformer("all-MiniLM-L6-v2")
vec = model.encode(QUERY, normalize_embeddings=True)

conn = psycopg2.connect(DSN); register_vector(conn)
with conn.cursor() as cur:
    cur.execute("SET enable_seqscan = off;")
    cur.execute(
        "SELECT title, vector <=> %s AS dist FROM documents "
        "WHERE vector IS NOT NULL ORDER BY vector <=> %s LIMIT 5",
        (vec, vec),
    )
    print(f"query: {QUERY!r}\n")
    for title, dist in cur.fetchall():
        print(f"  {dist:.4f}  {title}")

    cur.execute(
        "EXPLAIN (ANALYZE, BUFFERS) "
        "SELECT id FROM documents WHERE vector IS NOT NULL "
        "ORDER BY vector <=> %s LIMIT 5",
        (vec,),
    )
    print("\nplan:")
    for (line,) in cur.fetchall():
        print(" ", line)
