// pagerank.h — iterative PageRank over the `links` table.
// Engineering goal: converge with damping=0.85, max 50 iters, early-exit on
// L1 delta below epsilon; persist into the `pagerank` table for Phase 4.
#pragma once

#include <string>
#include <unordered_map>
#include "db.h"

namespace surge {

struct PageRankConfig {
  double damping = 0.85;
  int max_iters = 50;
  double epsilon = 1e-6;
};

class PageRank {
public:
  // Construct with a Db reference and an optional config override.
  explicit PageRank(Db& db, PageRankConfig cfg = {}) : db_(db), cfg_(cfg) {}

  // Run iterative PageRank to convergence and return the score map.
  std::unordered_map<std::string, double> compute();

  // Persist the score map into the `pagerank` table.
  void persist(const std::unordered_map<std::string, double>& scores);

private:
  Db& db_;
  PageRankConfig cfg_;
};

} // namespace surge
