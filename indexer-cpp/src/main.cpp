#include <iostream>
#include <pqxx/pqxx> 

using namespace std;

int main() {
    try {
        // 1. Establish the connection (Using the exact credentials from your Docker setup)
        // Notice we connect to localhost because the C++ script is running on your host machine
        pqxx::connection C("dbname=search_engine user=search_admin password=supersecretpassword host=localhost port=5432");

        if (C.is_open()) {
            cout << "🟢 C++ Successfully connected to database: " << C.dbname() << std::endl;
        } else {
            cout << "🔴 Failed to open database" << std::endl;
            return 1;
        }

        // 2. Create a transactional object
        pqxx::work W(C);

        // 3. Execute a query
        pqxx::result R = W.exec("SELECT COUNT(*) FROM documents;");

        // 4. Print the result
        cout << "Current documents in database: " << R[0][0].as<int>() << std::endl;

        // Note: W.commit() is usually called here for INSERT/UPDATE, but we only did a SELECT.
        
    } catch (const std::exception &e) {
        std::cerr << "Fatal Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}