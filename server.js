const express = require("express");
const app = express();

app.use(express.json());

// Simple test route
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Server is working!" });
});

app.post("/api/register", (req, res) => {
  res.json({ success: true, freeCredits: 50, paidCredits: 0 });
});

app.post("/api/balance", (req, res) => {
  res.json({ success: true, free: 50, paid: 0 });
});

app.post("/api/openai", (req, res) => {
  res.json({ success: true, response: "Test response from BABY AI" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
