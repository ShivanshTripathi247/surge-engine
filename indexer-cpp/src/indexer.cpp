#include "indexer.h"

namespace surge {

// Tokenizes title+content and accumulates per-term frequencies for the doc.
void Indexer::add_document(const Document& doc) {
  // Title terms get implicit double weight by tokenizing it twice.
  auto title_tokens = tok_.tokenize(doc.title);
  auto body_tokens = tok_.tokenize(doc.content);

  for (auto& t : title_tokens) idx_[t][doc.id] += 2;
  for (auto& t : body_tokens) idx_[t][doc.id] += 1;
}

} // namespace surge
