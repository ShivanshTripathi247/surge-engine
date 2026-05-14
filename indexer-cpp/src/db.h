// db.h — PostgreSQL connection + cursor-based streaming for the indexer.
// Engineering goal: stream 10k+ docs from Postgres without OOM by paging
// through a server-side cursor instead of loading the whole table.
#pragma once

#include <functional>
#include <string>
#include <pqxx/pqxx>

namespace surge {

struct Document {
  int id;
  std::string url;
  std::string title;
  std::string content;
};

class Db {
public:
  // Open connection using the project's Docker credentials.
  explicit Db(const std::string& conn_str = default_conn());

  // Return the project's default connection string.
  static std::string default_conn();

  // Stream all documents through a cursor; callback runs per row.
  void stream_documents(std::size_t page_size,
                        const std::function<void(const Document&)>& on_row);

  // Fetch a single document by URL (used by the live subscriber path).
  bool fetch_document_by_url(const std::string& url, Document& out);

  // Expose the raw connection for modules that need a transaction.
  pqxx::connection& raw() { return conn_; }

private:
  pqxx::connection conn_;
};

} // namespace surge
