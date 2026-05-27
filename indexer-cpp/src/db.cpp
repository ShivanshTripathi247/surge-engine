#include "db.h"
#include <cstdlib>
#include <iostream>

namespace surge {

// Read DB_* env vars (with PG* legacy fallbacks) and default to the
// local wiki-scale dev database on port 5433.
std::string Db::default_conn() {
  const char* host = std::getenv("DB_HOST");
  if (!host || !*host) host = std::getenv("PGHOST");
  const char* port = std::getenv("DB_PORT");
  if (!port || !*port) port = std::getenv("PGPORT");
  const char* name = std::getenv("DB_NAME");
  if (!name || !*name) name = std::getenv("PGDATABASE");
  const char* user = std::getenv("DB_USER");
  if (!user || !*user) user = std::getenv("PGUSER");
  const char* pass = std::getenv("DB_PASSWORD");
  if (!pass || !*pass) pass = std::getenv("PGPASSWORD");

  return std::string("dbname=") + (name && *name ? name : "surge_wiki") +
         " user=" + (user && *user ? user : "surge_admin") +
         " password=" + (pass && *pass ? pass : "local_dev_pwd") +
         " host=" + (host && *host ? host : "localhost") +
         " port=" + (port && *port ? port : "5433");
}

// Constructs both connections eagerly so failures surface immediately.
// Two connections: one for the streaming cursor (read), one for the
// serializer (writes) — needed so a mid-stream flush can begin a write
// transaction without conflicting with the open read transaction.
Db::Db(const std::string& conn_str)
    : conn_(conn_str), writer_conn_(conn_str) {
  if (!conn_.is_open() || !writer_conn_.is_open()) {
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
