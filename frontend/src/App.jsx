import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Search from "./pages/Search.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<Search />} />
    </Routes>
  );
}
