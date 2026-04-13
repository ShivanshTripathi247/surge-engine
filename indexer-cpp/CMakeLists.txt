cmake_minimum_required(VERSION 3.15)
project(SearchIndexer)

# Require C++17 standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find the PostgreSQL C++ Library (libpqxx)
find_package(PkgConfig REQUIRED)
pkg_check_modules(PQXX REQUIRED libpqxx)

# Define the executable and its source files
add_executable(indexer src/main.cpp)

# Link the libraries to our executable
target_include_directories(indexer PRIVATE ${PQXX_INCLUDE_DIRS})
target_link_libraries(indexer PRIVATE ${PQXX_LIBRARIES})