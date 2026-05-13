FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config libpqxx-dev libhiredis-dev nlohmann-json3-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src
RUN cmake -S . -B build && cmake --build build -j

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpqxx-6.4 libhiredis0.14 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/indexer /usr/local/bin/indexer
CMD ["indexer"]
