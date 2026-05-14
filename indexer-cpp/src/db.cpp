#include "db.h"
#include <cstdlib>
#include <iostream>

namespace surge {

// Read env var or fall back to default.
static std::string env_or(const char* k, const char* def) {
  const char* v = std::getenv(k);
  return (v && *v) ? std::string(v) : std::string(def);
}

// Build conn string from PG* env (Docker) or default to localhost (dev).
std::string Db::default_conn() {
  return "dbname=" + env_or("PGDATABASE", "search_engine") +
         " user=" + env_or("PGUSER", "search_admin") +
         " password=" + env_or("PGPASSWORD", "supersecretpassword") +
         " host=" + env_or("PGHOST", "localhost") +
         " port=" + env_or("PGPORT", "5432");
}

// Constructs the connection eagerly so failures surface immediately.
Db::Db(const std::string& conn_str) : conn_(conn_str) {
  if (!conn_.is_open()) {
    throw std::runtime_error("Failed to open PostgreSQL connection");
  }
}

// Streams documents in fixed-size pages via a server-side cursor.
void Db::stream_documents(std::size_t page_size,
                          const std::function<void(const Document&)>& on_row) {
  pqxx::work tx(conn_);
  // Server-side cursor keeps memory bounded regardless of row count.
  pqxx::stateless_cursor<pqxx::cursor_base::read_only,
                         pqxx::cursor_base::owned>
      cursor(tx,
             "SELECT id, url, COALESCE(title,''), COALESCE(content,'') "
             "FROM documents ORDER BY id",
             "doc_cursor", false);

  std::size_t offset = 0;
  while (true) {
    pqxx::result page = cursor.retrieve(offset, offset + page_size);
    if (page.empty()) break;
    for (const auto& row : page) {
      Document d{
          row[0].as<int>(),
          row[1].as<std::string>(),
          row[2].as<std::string>(),
          row[3].as<std::string>(),
      };
      on_row(d);
    }
    offset += page.size();
    if (page.size() < page_size) break;
  }
  tx.commit();
}

// Loads one document on demand for live pub/sub indexing.
bool Db::fetch_document_by_url(const std::string& url, Document& out) {
  pqxx::work tx(conn_);
  pqxx::result r = tx.exec_params(
      "SELECT id, url, COALESCE(title,''), COALESCE(content,'') "
      "FROM documents WHERE url=$1",
      url);
  tx.commit();
  if (r.empty()) return false;
  out = Document{r[0][0].as<int>(), r[0][1].as<std::string>(),
                 r[0][2].as<std::string>(), r[0][3].as<std::string>()};
  return true;
}

} // namespace surge
