import psycopg2
import config

REQUIRED_TABLES = ["documents", "links", "pagerank", "inverted_index", "query_log"]


def get_connection():
    return psycopg2.connect(
        host=config.DB_HOST,
        port=config.DB_PORT,
        dbname=config.DB_NAME,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
    )


def verify_tables():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                """
            )
            present = {row[0] for row in cur.fetchall()}
        missing = [t for t in REQUIRED_TABLES if t not in present]
        if missing:
            raise RuntimeError(f"Missing required tables: {missing}")
        return True
    finally:
        conn.close()


def count_documents():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM documents")
            return cur.fetchone()[0]
    finally:
        conn.close()


if __name__ == "__main__":
    verify_tables()
    print(f"All {len(REQUIRED_TABLES)} tables present.")
    print(f"documents count: {count_documents()}")
