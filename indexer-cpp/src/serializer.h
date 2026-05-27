// serializer.h — write the in-memory inverted index to Postgres as JSONB.
// Engineering goal: emit `{"doc_id": tf, ...}` per term so any language
// (Node/Express, Python, etc.) can consume the postings without C++ headers.
#pragma once

#include "db.h"
#include "indexer.h"

namespace surge {

class Serializer {
public:
  // Construct against an open Db handle.
  explicit Serializer(Db& db) : db_(db) {}

  // Upsert every term's postings into the inverted_index table.
  void write(const InvertedIndex& idx);

  // Merge every term's postings into the table (used for partial RAM flushes
  // when the in-memory index grows too large; existing postings are preserved
  // and combined with the new ones via JSONB concat).
  void write_merged(const InvertedIndex& idx);

  // Upsert a single term — used by the live pub/sub path.
  void write_term(const std::string& term, const Postings& postings);

private:
  Db& db_;
};

} // namespace surge
