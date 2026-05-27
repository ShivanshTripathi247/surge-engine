#include "serializer.h"
#include <iostream>
#include <sstream>

namespace surge {

// Builds a JSON object string from a postings map without external deps.
static std::string postings_to_json(const Postings& p) {
  std::ostringstream os;
  os << '{';
  bool first = true;
  for (const auto& [doc_id, tf] : p) {
    if (!first) os << ',';
    first = false;
    os << '"' << doc_id << "\":" << tf;
  }
  os << '}';
  return os.str();
}

namespace {
// Commit every N upserts so Postgres can release locks, ship WAL, and let
// the buffer flusher drain dirty pages between batches. A 2-4M-op
// transaction otherwise builds up multi-GB of dirty buffers + WAL queue
// and OOMs the host on the indexer machine.
constexpr std::size_t kBatchCommitSize = 50000;
} // namespace

// Writes the entire inverted index, committing every kBatchCommitSize rows.
void Serializer::write(const InvertedIndex& idx) {
  std::size_t n = 0;
  auto it = idx.begin();
  while (it != idx.end()) {
    pqxx::work tx(db_.writer());
    std::size_t in_batch = 0;
    while (it != idx.end() && in_batch < kBatchCommitSize) {
      tx.exec_params(
          "INSERT INTO inverted_index(term, postings) VALUES($1, $2::jsonb) "
          "ON CONFLICT (term) DO UPDATE SET postings=EXCLUDED.postings",
          it->first, postings_to_json(it->second));
      ++it;
      ++in_batch;
      if (++n % 5000 == 0) {
        std::cout << "[SERIALIZE] wrote " << n << " terms\n";
      }
    }
    tx.commit();
  }
  std::cout << "[SERIALIZE] total terms written: " << n << "\n";
}

// Like write() but merges with existing postings via JSONB concat. Used by
// the partial-flush path so an early flush does not overwrite postings
// produced by a later in-memory chunk for the same term. Same batching
// strategy as write() — caps transaction duration.
void Serializer::write_merged(const InvertedIndex& idx) {
  std::size_t n = 0;
  auto it = idx.begin();
  while (it != idx.end()) {
    pqxx::work tx(db_.writer());
    std::size_t in_batch = 0;
    while (it != idx.end() && in_batch < kBatchCommitSize) {
      tx.exec_params(
          "INSERT INTO inverted_index(term, postings) VALUES($1, $2::jsonb) "
          "ON CONFLICT (term) DO UPDATE SET postings = "
          "  inverted_index.postings || EXCLUDED.postings",
          it->first, postings_to_json(it->second));
      ++it;
      ++in_batch;
      if (++n % 5000 == 0) {
        std::cout << "[FLUSH] merged " << n << " terms\n";
      }
    }
    tx.commit();
  }
  std::cout << "[FLUSH] total terms merged: " << n << "\n";
}

// Merges a single term's postings into the table (live update path).
void Serializer::write_term(const std::string& term, const Postings& p) {
  pqxx::work tx(db_.writer());
  // Merge by reading existing JSONB and combining with the new postings.
  tx.exec_params(
      "INSERT INTO inverted_index(term, postings) VALUES($1, $2::jsonb) "
      "ON CONFLICT (term) DO UPDATE SET postings = "
      "  inverted_index.postings || EXCLUDED.postings",
      term, postings_to_json(p));
  tx.commit();
}

} // namespace surge
