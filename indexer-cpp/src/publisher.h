// publisher.h — Redis Pub/Sub subscriber to "documents:new".
// Engineering goal: keep the indexer hot. When the Node crawler publishes a
// new doc, fetch it, tokenize, and merge the postings without restarting.
#pragma once

#include <string>
#include "db.h"
#include "indexer.h"
#include "serializer.h"
#include "tokenizer.h"

namespace surge {

class Publisher {
public:
  // Construct with collaborators required to index one doc end-to-end.
  Publisher(Db& db, const Tokenizer& tok, Serializer& ser,
            std::string host = "localhost", int port = 6379)
      : db_(db), tok_(tok), ser_(ser),
        host_(std::move(host)), port_(port) {}

  // Block forever processing messages from the "documents:new" channel.
  void run(const std::string& channel = "documents:new");

private:
  Db& db_;
  const Tokenizer& tok_;
  Serializer& ser_;
  std::string host_;
  int port_;
};

} // namespace surge
