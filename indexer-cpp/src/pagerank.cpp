#include "pagerank.h"
#include <cmath>
#include <iostream>
#include <unordered_set>
#include <vector>

namespace surge {

// Runs the classic iterative PageRank algorithm to convergence.
std::unordered_map<std::string, double> PageRank::compute() {
  // Load entire link graph into memory; for 10k docs this is well-bounded.
  std::unordered_map<std::string, std::vector<std::string>> out_links;
  std::unordered_set<std::string> nodes;

  {
    pqxx::work tx(db_.raw());
    auto rows = tx.exec("SELECT source_url, target_url FROM links");
    for (const auto& r : rows) {
      auto src = r[0].as<std::string>();
      auto dst = r[1].as<std::string>();
      out_links[src].push_back(dst);
      nodes.insert(src);
      nodes.insert(dst);
    }
    // Also include documents with no outgoing edges so they get a baseline rank.
    auto doc_rows = tx.exec("SELECT url FROM documents");
    for (const auto& r : doc_rows) nodes.insert(r[0].as<std::string>());
    tx.commit();
  }

  const std::size_t N = nodes.size();
  if (N == 0) return {};

  std::unordered_map<std::string, double> rank;
  rank.reserve(N);
  const double init = 1.0 / static_cast<double>(N);
  for (const auto& u : nodes) rank[u] = init;

  // Pre-compute out-degree once per node.
  std::unordered_map<std::string, std::size_t> out_deg;
  out_deg.reserve(out_links.size());
  for (auto& [src, dsts] : out_links) out_deg[src] = dsts.size();

  // Build reverse adjacency: for each target, list of source nodes pointing in.
  std::unordered_map<std::string, std::vector<std::string>> in_links;
  for (auto& [src, dsts] : out_links) {
    for (auto& d : dsts) in_links[d].push_back(src);
  }

  const double d = cfg_.damping;
  const double teleport = (1.0 - d) / static_cast<double>(N);

  for (int it = 0; it < cfg_.max_iters; ++it) {
    // Handle dangling nodes: distribute their mass uniformly.
    double dangling_sum = 0.0;
    for (const auto& u : nodes) {
      if (out_deg.find(u) == out_deg.end() || out_deg[u] == 0) {
        dangling_sum += rank[u];
      }
    }
    const double dangling_share = d * dangling_sum / static_cast<double>(N);

    std::unordered_map<std::string, double> next;
    next.reserve(N);
    double delta = 0.0;
    for (const auto& u : nodes) {
      double s = 0.0;
      auto it_in = in_links.find(u);
      if (it_in != in_links.end()) {
        for (const auto& v : it_in->second) {
          auto od = out_deg.find(v);
          if (od != out_deg.end() && od->second > 0) {
            s += rank[v] / static_cast<double>(od->second);
          }
        }
      }
      double new_rank = teleport + dangling_share + d * s;
      next[u] = new_rank;
      delta += std::fabs(new_rank - rank[u]);
    }
    rank.swap(next);
    std::cout << "[PAGERANK] iter=" << it << " delta=" << delta << std::endl;
    if (delta < cfg_.epsilon) {
      std::cout << "[PAGERANK] converged at iter=" << it << std::endl;
      break;
    }
  }
  return rank;
}

// Upserts all computed scores into the pagerank table in one transaction.
void PageRank::persist(const std::unordered_map<std::string, double>& scores) {
  pqxx::work tx(db_.raw());
  for (const auto& [url, score] : scores) {
    tx.exec_params(
        "INSERT INTO pagerank(url, score, updated_at) VALUES($1,$2,NOW()) "
        "ON CONFLICT (url) DO UPDATE SET score=EXCLUDED.score, "
        "updated_at=NOW()",
        url, score);
  }
  tx.commit();
}

} // namespace surge
