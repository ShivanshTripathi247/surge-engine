#include "tokenizer.h"
#include <cctype>

namespace surge {

namespace {
constexpr const char* kStopWords[] = {
    "a","an","and","are","as","at","be","but","by","for","from","has","have",
    "he","her","his","i","in","is","it","its","of","on","or","she","that",
    "the","their","them","they","this","to","was","were","will","with","you",
    "your","we","our","us","not","no","do","does","did","been","being","am",
    "if","then","than","so","such","into","over","under","about","up","down",
    "out","off","also","can","could","should","would","may","might","must",
    "one","two","there","these","those","who","whom","which","what","when",
    "where","why","how"};
} // namespace

// Loads the static stop-word list into the hash set.
Tokenizer::Tokenizer() {
  for (auto* w : kStopWords) stop_words_.emplace(w);
}

// Returns true if the term is filtered as a stop-word.
bool Tokenizer::is_stop_word(const std::string& term) const {
  return stop_words_.find(term) != stop_words_.end();
}

// Splits text on non-alphanumerics, lowercases, drops stop-words/short tokens.
std::vector<std::string> Tokenizer::tokenize(const std::string& text) const {
  std::vector<std::string> out;
  out.reserve(text.size() / 8);

  std::string buf;
  buf.reserve(32);

  auto flush = [&]() {
    if (buf.size() >= 2 && !is_stop_word(buf)) {
      out.emplace_back(std::move(buf));
    }
    buf.clear();
  };

  for (unsigned char ch : text) {
    if (std::isalnum(ch)) {
      buf.push_back(static_cast<char>(std::tolower(ch)));
    } else {
      if (!buf.empty()) flush();
    }
  }
  if (!buf.empty()) flush();
  return out;
}

} // namespace surge
