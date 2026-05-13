cmake_minimum_required(VERSION 3.15)
project(SearchIndexer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_compile_options(-Wall -Wextra -Wpedantic)

find_package(PkgConfig REQUIRED)
pkg_check_modules(PQXX REQUIRED libpqxx)
pkg_check_modules(HIREDIS REQUIRED hiredis)

# nlohmann-json is header-only; provided by Fedora package nlohmann-json-devel
find_package(nlohmann_json 3.2.0 QUIET)

add_executable(indexer
  src/main.cpp
  src/db.cpp
  src/tokenizer.cpp
  src/indexer.cpp
  src/pagerank.cpp
  src/serializer.cpp
  src/publisher.cpp
)

target_include_directories(indexer PRIVATE
  ${PQXX_INCLUDE_DIRS}
  ${HIREDIS_INCLUDE_DIRS}
  src
)

target_link_libraries(indexer PRIVATE
  ${PQXX_LIBRARIES}
  ${HIREDIS_LIBRARIES}
)

if(nlohmann_json_FOUND)
  target_link_libraries(indexer PRIVATE nlohmann_json::nlohmann_json)
endif()

target_compile_options(indexer PRIVATE ${PQXX_CFLAGS_OTHER} ${HIREDIS_CFLAGS_OTHER})
target_link_directories(indexer PRIVATE ${PQXX_LIBRARY_DIRS} ${HIREDIS_LIBRARY_DIRS})
