// indexer.h — in-memory inverted index: term -> {doc_id -> term_frequency}.
// Engineering goal: O(1) average lookup using nested unordered_map, with a
// merge primitive so the same instance can absorb both batch and live updates.
#pragma once

#include <string>
#include <unordered_map>
#include "db.h"
#include "tokenizer.h"

namespace surge {

// Postings: doc_id -> term frequency in that document.
using Postings = std::unordered_map<int, int>;
// InvertedIndex: term -> postings map.
using InvertedIndex = std::unordered_map<std::string, Postings>;

class Indexer {
public:
  // Construct with a reference to a tokenizer used for every add_document call.
  explicit Indexer(const Tokenizer& tok) : tok_(tok) {}

  // Index a single document into the in-memory map.
  void add_document(const Document& doc);

  // Return immutable view of the underlying index.
  const InvertedIndex& index() const { return idx_; }

  // Report total unique terms held in memory.
  std::size_t term_count() const { return idx_.size(); }

  // Drop all in-memory postings (used after a partial flush to Postgres).
  void clear() { idx_.clear(); }

private:
  const Tokenizer& tok_;
  InvertedIndex idx_;
};

} // namespace surge
