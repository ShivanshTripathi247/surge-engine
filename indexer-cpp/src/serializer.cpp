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

// Writes the entire inverted index in batches inside one transaction.
void Serializer::write(const InvertedIndex& idx) {
  pqxx::work tx(db_.raw());
  std::size_t n = 0;
  for (const auto& [term, postings] : idx) {
    tx.exec_params(
        "INSERT INTO inverted_index(term, postings) VALUES($1, $2::jsonb) "
        "ON CONFLICT (term) DO UPDATE SET postings=EXCLUDED.postings",
        term, postings_to_json(postings));
    if (++n % 5000 == 0) {
      std::cout << "[SERIALIZE] wrote " << n << " terms\n";
    }
  }
  tx.commit();
  std::cout << "[SERIALIZE] total terms written: " << n << "\n";
}

// Merges a single term's postings into the table (live update path).
void Serializer::write_term(const std::string& term, const Postings& p) {
  pqxx::work tx(db_.raw());
  // Merge by reading existing JSONB and combining with the new postings.
  tx.exec_params(
      "INSERT INTO inverted_index(term, postings) VALUES($1, $2::jsonb) "
      "ON CONFLICT (term) DO UPDATE SET postings = "
      "  inverted_index.postings || EXCLUDED.postings",
      term, postings_to_json(p));
  tx.commit();
}

} // namespace surge
