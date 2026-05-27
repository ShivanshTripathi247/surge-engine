// main.cpp — Phase 2 entry point.
//
// Pipeline:
//   1. Batch pass: stream all documents through a Postgres cursor (no OOM),
//      tokenize, build the in-memory inverted index, and persist as JSONB.
//      A progress bar emits one line every 10k docs; RAM is sampled every
//      100k docs and an early flush kicks in if VmRSS exceeds 12 GiB.
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
#include <fstream>
#include <iomanip>
#include <iostream>
#include <malloc.h>
#include <sstream>
#include <string>

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

namespace {

// Format integer with thousands separators ("1234567" -> "1,234,567").
std::string commafy(std::size_t n) {
  std::string s = std::to_string(n);
  for (int i = static_cast<int>(s.size()) - 3; i > 0; i -= 3) s.insert(i, ",");
  return s;
}

// Format duration as HH:MM:SS.
std::string hms(std::chrono::seconds d) {
  long s = d.count();
  long h = s / 3600;
  long m = (s % 3600) / 60;
  long sec = s % 60;
  std::ostringstream os;
  os << std::setfill('0') << std::setw(2) << h << ':' << std::setw(2) << m
     << ':' << std::setw(2) << sec;
  return os.str();
}

// Format a coarse "Xh XXm XXs" string for the final summary.
std::string coarse_hms(std::chrono::seconds d) {
  long s = d.count();
  long h = s / 3600;
  long m = (s % 3600) / 60;
  long sec = s % 60;
  std::ostringstream os;
  os << h << "h " << std::setfill('0') << std::setw(2) << m << "m "
     << std::setw(2) << sec << "s";
  return os.str();
}

// Read VmRSS from /proc/self/status and return the value in KiB.
// Returns 0 if the file cannot be read (non-Linux dev hosts).
std::size_t vmrss_kib() {
  std::ifstream f("/proc/self/status");
  if (!f.is_open()) return 0;
  std::string line;
  while (std::getline(f, line)) {
    if (line.rfind("VmRSS:", 0) == 0) {
      std::istringstream is(line.substr(6));
      std::size_t kib = 0;
      is >> kib;
      return kib;
    }
  }
  return 0;
}

// "4.2 GB" style formatting from KiB.
std::string fmt_gb(std::size_t kib) {
  double gb = static_cast<double>(kib) / (1024.0 * 1024.0);
  std::ostringstream os;
  os << std::fixed << std::setprecision(1) << gb << " GB";
  return os.str();
}

// "892k" / "1,847k" style for the term-count column.
std::string fmt_terms_k(std::size_t terms) {
  std::size_t k = terms / 1000;
  return commafy(k) + "k";
}

// Indexer RSS ceiling before a flush is forced. Kept low (4 GiB) because the
// host has 14 GiB total: Postgres needs ~3 GiB during flush, plus desk apps,
// plus headroom. RAM is sampled every 100k docs so peak overshoots the
// threshold by ~1 GiB — at 4 GiB threshold the actual peak lands near 5 GiB.
constexpr std::size_t kRamFlushThresholdKib = 4ULL * 1024ULL * 1024ULL;

} // namespace

int main(int argc, char** argv) {
  bool run_pubsub = true;
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--no-pubsub") == 0) run_pubsub = false;
  }

  // Tracked at function scope so the crash handler can report it.
  int last_doc_id = -1;
  std::size_t n_docs = 0;

  try {
    Db db;
    Tokenizer tok;
    Indexer indexer(tok);
    Serializer serializer(db);

    // Total corpus size — needed for percentage + ETA on the progress bar.
    std::size_t total_docs = 0;
    {
      pqxx::work tx(db.raw());
      pqxx::row r = tx.exec1("SELECT COUNT(*) FROM documents");
      total_docs = r[0].as<std::size_t>();
      tx.commit();
    }

    const std::string bar(40, '-');
    const std::string heavy =
        "----------------------------------------";
    // Heavy unicode bar requested by spec (━).
    const std::string ubar =
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81"
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81"
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81"
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81"
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81"
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81"
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81"
        "\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81\xe2\x94\x81";
    (void)bar; (void)heavy;

    std::cout << ubar << "\n"
              << "  SURGE WIKI INDEXER\n"
              << "  Corpus: " << commafy(total_docs) << " documents\n"
              << ubar << std::endl;

    auto t0 = std::chrono::steady_clock::now();
    bool flushed_partial = false;

    db.stream_documents(500, [&](const surge::Document& d) {
      last_doc_id = d.id;
      indexer.add_document(d);
      ++n_docs;

      // Progress line every 10k docs — newline output (log-friendly).
      if (n_docs % 10000 == 0) {
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - t0);
        double pct = (total_docs > 0)
                         ? (100.0 * static_cast<double>(n_docs) /
                            static_cast<double>(total_docs))
                         : 0.0;

        // ETA: scale elapsed by remaining/processed.
        std::chrono::seconds eta(0);
        if (n_docs > 0 && total_docs > n_docs) {
          double per_doc = static_cast<double>(elapsed.count()) /
                           static_cast<double>(n_docs);
          eta = std::chrono::seconds(
              static_cast<long>(per_doc *
                                static_cast<double>(total_docs - n_docs)));
        }

        std::ostringstream line;
        line << "[" << std::setw(5) << std::fixed << std::setprecision(1)
             << pct << "%]  " << commafy(n_docs) << "/" << commafy(total_docs)
             << " docs | " << fmt_terms_k(indexer.term_count())
             << " terms | " << hms(elapsed) << " elapsed | eta ~"
             << hms(eta);

        // RAM sample every 100k docs.
        if (n_docs % 100000 == 0) {
          std::size_t rss = vmrss_kib();
          line << " [RAM: " << fmt_gb(rss) << "]";
          std::cout << line.str() << std::endl;

          // Safety valve: flush + clear before the index blows out RAM.
          if (rss > kRamFlushThresholdKib) {
            std::cout << "RAM flush triggered at " << commafy(n_docs)
                      << " docs — index partially written" << std::endl;
            serializer.write_merged(indexer.index());
            indexer.clear();
            // glibc holds freed pages by default; force them back to the OS
            // so RSS drops and the next flush isn't triggered prematurely.
            malloc_trim(0);
            flushed_partial = true;
            std::cout << "[FLUSH] cleared in-memory index, continuing ("
                      << "RAM: " << fmt_gb(vmrss_kib()) << ")" << std::endl;
          }
        } else {
          std::cout << line.str() << std::endl;
        }
      }
    });

    auto t1 = std::chrono::steady_clock::now();
    auto total_elapsed =
        std::chrono::duration_cast<std::chrono::seconds>(t1 - t0);

    std::cout << "[SERIALIZE] writing inverted_index to Postgres ("
              << (flushed_partial ? "merge mode" : "overwrite mode") << ")..."
              << std::endl;
    if (flushed_partial) {
      // Earlier partial flushes already populated some rows; merging keeps them.
      serializer.write_merged(indexer.index());
    } else {
      serializer.write(indexer.index());
    }

    // Final summary
    long total_sec = total_elapsed.count();
    double docs_per_sec =
        total_sec > 0 ? static_cast<double>(n_docs) / static_cast<double>(total_sec)
                      : 0.0;
    std::cout << ubar << "\n"
              << "  INDEXING COMPLETE\n"
              << "  Documents processed: " << commafy(n_docs) << "\n"
              << "  Unique terms:        " << commafy(indexer.term_count())
              << (flushed_partial ? "  (in-memory tail; total in DB is higher)"
                                  : "")
              << "\n"
              << "  Total time:          " << coarse_hms(total_elapsed) << "\n"
              << "  Avg speed:           " << static_cast<long>(docs_per_sec)
              << " docs/sec\n"
              << ubar << std::endl;

    std::cout << "[PAGERANK] computing..." << std::endl;
    PageRank pr(db);
    auto scores = pr.compute();
    std::cout << "[PAGERANK] persisting " << scores.size() << " scores..."
              << std::endl;
    pr.persist(scores);

    if (!run_pubsub) {
      std::cout << "[DONE] batch + pagerank complete (pubsub skipped)"
                << std::endl;
      return 0;
    }

    std::cout << "[LIVE] entering pub/sub loop..." << std::endl;
    const char* rh = std::getenv("REDIS_HOST");
    const char* rp = std::getenv("REDIS_PORT");
    Publisher publisher(db, tok, serializer,
                        rh && *rh ? rh : "localhost",
                        rp && *rp ? std::atoi(rp) : 6379);
    publisher.run();
  } catch (const std::exception& e) {
    std::cerr << "[FATAL] " << e.what() << "\n"
              << "[FATAL] last doc_id being processed: " << last_doc_id
              << " (after " << commafy(n_docs) << " docs)" << std::endl;
    return 1;
  }
  return 0;
}
