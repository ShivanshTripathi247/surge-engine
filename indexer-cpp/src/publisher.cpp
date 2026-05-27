#include "publisher.h"

#include <hiredis/hiredis.h>
#include <cstring>
#include <iostream>
#include <stdexcept>

namespace surge {

// Extracts a JSON string field naively (avoids pulling a full JSON parser).
static std::string extract_json_field(const std::string& payload,
                                      const std::string& key) {
  std::string needle = "\"" + key + "\":\"";
  auto pos = payload.find(needle);
  if (pos == std::string::npos) return {};
  pos += needle.size();
  std::string out;
  for (; pos < payload.size(); ++pos) {
    char c = payload[pos];
    if (c == '\\' && pos + 1 < payload.size()) {
      out.push_back(payload[++pos]);
      continue;
    }
    if (c == '"') break;
    out.push_back(c);
  }
  return out;
}

// Indexes one document delivered via pub/sub and writes its postings.
static void handle_message(Db& db, const Tokenizer& tok, Serializer& ser,
                           const std::string& payload) {
  auto url = extract_json_field(payload, "url");
  if (url.empty()) {
    std::cerr << "[PUBSUB] empty url in payload\n";
    return;
  }
  Document doc;
  if (!db.fetch_document_by_url(url, doc)) {
    std::cerr << "[PUBSUB] doc not found in DB: " << url << "\n";
    return;
  }
  Indexer local(tok);
  local.add_document(doc);
  for (const auto& [term, postings] : local.index()) {
    ser.write_term(term, postings);
  }
  std::cout << "[PUBSUB] indexed live doc id=" << doc.id
            << " terms=" << local.term_count() << " url=" << url << "\n";
}

// Subscribes to the channel and dispatches each message to handle_message.
void Publisher::run(const std::string& channel) {
  redisContext* ctx = redisConnect(host_.c_str(), port_);
  if (!ctx || ctx->err) {
    std::string err = ctx ? ctx->errstr : "alloc failed";
    if (ctx) redisFree(ctx);
    throw std::runtime_error("Redis connect failed: " + err);
  }

  redisReply* sub = static_cast<redisReply*>(
      redisCommand(ctx, "SUBSCRIBE %s", channel.c_str()));
  if (!sub) {
    redisFree(ctx);
    throw std::runtime_error("SUBSCRIBE failed");
  }
  freeReplyObject(sub);
  std::cout << "[PUBSUB] subscribed to " << channel << "\n";

  redisReply* reply = nullptr;
  while (redisGetReply(ctx, reinterpret_cast<void**>(&reply)) == REDIS_OK) {
    if (reply && reply->type == REDIS_REPLY_ARRAY && reply->elements >= 3) {
      const char* type = reply->element[0]->str;
      if (type && std::strcmp(type, "message") == 0) {
        std::string payload(reply->element[2]->str, reply->element[2]->len);
        try {
          handle_message(db_, tok_, ser_, payload);
        } catch (const std::exception& e) {
          std::cerr << "[PUBSUB] handler error: " << e.what() << "\n";
        }
      }
    }
    if (reply) freeReplyObject(reply);
    reply = nullptr;
  }
  redisFree(ctx);
}

} // namespace surge
