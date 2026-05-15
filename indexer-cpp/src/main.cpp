// main.cpp — Phase 2 entry point.
//
// Pipeline:
//   1. Batch pass: stream all documents through a Postgres cursor (no OOM),
//      tokenize, build the in-memory inverted index, and persist as JSONB.
//   2. PageRank pass: iterate over the `links` table to convergence
//      (damping=0.85, max 50 iters) and upsert into the `pagerank` table.
//   3. Live pass: subscribe to Redis "documents:new" and merge new docs
//      into the inverted index in real time as the crawler emits them.
//
// Flags:
//   --no-pubsub   skip the live subscriber and exit after the batch pass
//                 (useful for CI and one-shot reindex runs).

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>

#include "db.h"
#include "indexer.h"
#include "pagerank.h"
#include "publisher.h"
#include "serializer.h"
#include "tokenizer.h"

using surge::Db;
using surge::Indexer;
using surge::PageRank;
using surge::Publisher;
using surge::Serializer;
using surge::Tokenizer;

int main(int argc, char** argv) {
  bool run_pubsub = true;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--no-pubsub") == 0) run_pubsub = false;
  }

  try {
    Db db;
    Tokenizer tok;
    Indexer indexer(tok);
    Serializer serializer(db);

    std::cout << "[BATCH] streaming documents...\n";
    auto t0 = std::chrono::steady_clock::now();
    std::size_t n_docs = 0;
    db.stream_documents(500, [&](const surge::Document& d) {
      indexer.add_document(d);
      if (++n_docs % 500 == 0) {
        std::cout << "[BATCH] indexed " << n_docs << " docs, "
                  << indexer.term_count() << " unique terms\n";
      }
    });
    auto t1 = std::chrono::steady_clock::now();
    std::cout << "[BATCH] " << n_docs << " docs, "
              << indexer.term_count() << " unique terms in "
              << std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0)
                     .count()
              << " ms\n";

    std::cout << "[SERIALIZE] writing inverted_index to Postgres...\n";
    serializer.write(indexer.index());

    std::cout << "[PAGERANK] computing...\n";
    PageRank pr(db);
    auto scores = pr.compute();
    std::cout << "[PAGERANK] persisting " << scores.size() << " scores...\n";
    pr.persist(scores);

    if (!run_pubsub) {
      std::cout << "[DONE] batch + pagerank complete (pubsub skipped)\n";
      return 0;
    }

    std::cout << "[LIVE] entering pub/sub loop...\n";
    const char* rh = std::getenv("REDIS_HOST"); const char* rp = std::getenv("REDIS_PORT");
    Publisher publisher(db, tok, serializer,
                        rh && *rh ? rh : "localhost",
                        rp && *rp ? std::atoi(rp) : 6379);
    publisher.run();
  } catch (const std::exception& e) {
    std::cerr << "[FATAL] " << e.what() << "\n";
    return 1;
  }
  return 0;
}
