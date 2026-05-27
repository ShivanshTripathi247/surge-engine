// tokenizer.h — lowercase, punctuation-stripping tokenizer with stop-words.
// Engineering goal: a small, allocation-aware tokenizer that produces clean
// terms for the inverted index without pulling a heavyweight NLP library.
#pragma once

#include <string>
#include <unordered_set>
#include <vector>

namespace surge {

class Tokenizer {
public:
  // Build a tokenizer pre-loaded with a small English stop-word set.
  Tokenizer();

  // Tokenize text into normalized terms (returns by value, small alloc).
  std::vector<std::string> tokenize(const std::string& text) const;

  // True if the term is in the stop-word set.
  bool is_stop_word(const std::string& term) const;

private:
  std::unordered_set<std::string> stop_words_;
};

} // namespace surge
