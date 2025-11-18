require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// REQUIRED ENV VARS
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DBNAME;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// DEBUG: Log port info
console.log("PORT from env:", process.env.PORT);

if (!MONGO_URI) console.log("❌ MONGODB_URI missing");
if (!DB_NAME) console.log("❌ MONGODB_DBNAME missing");
if (!OPENAI_KEY) console.log("❌ OPENAI_API_KEY missing");

const FREE_CREDITS = 50;
const PAID_PACK = 500;

let db, Users;

// ----------------- CONNECT DB -----------------
async function connectDB() {
  if (db) return db;
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    Users = db.collection("users");
    console.log("✅ MongoDB Connected");
    return db;
  } catch (err) {
    console.log("❌ MongoDB Connection Error:", err.message);
    throw err;
  }
}

connectDB().catch(err => {
  console.log("⚠️ Initial DB connection failed, will retry on requests");
});

// ----------------- HEALTH CHECK -----------------
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "BABY AI Server Running",
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ----------------- REGISTER USER -----------------
app.post("/api/register", async (req, res) => {
  try {
    await connectDB();
    const { email, deviceId } = req.body;
    
    if (!email || !deviceId) {
      return res.json({ success: false, message: "Missing email or deviceId" });
    }

    let user = await Users.findOne({ deviceId });

    if (user) {
      return res.json({
        success: true,
        freeCredits: 0,
        paidCredits: user.paidCredits || 0,
        message: "Free trial already used on this device"
      });
    }

    await Users.insertOne({
      email,
      deviceId,
      freeCredits: FREE_CREDITS,
      paidCredits: 0,
      createdAt: new Date()
    });

    return res.json({
      success: true,
      freeCredits: FREE_CREDITS,
      paidCredits: 0,
      message: "Free trial activated!"
    });

  } catch (err) {
    console.log("Register error:", err.message);
    return res.json({ success: false, message: "Server error" });
  }
});

// ----------------- GET BALANCE -----------------
app.post("/api/balance", async (req, res) => {
  try {
    await connectDB();
    const { email } = req.body;

    if (!email) {
      return res.json({ success: false, message: "Email required", free: 0, paid: 0 });
    }

    let user = await Users.findOne({ email });
    if (!user) {
      return res.json({ success: false, message: "User not found", free: 0, paid: 0 });
    }

    return res.json({
      success: true,
      free: user.freeCredits,
      paid: user.paidCredits
    });
  } catch (err) {
    console.log("Balance error:", err.message);
    return res.json({ success: false, message: "Server error", free: 0, paid: 0 });
  }
});

// ----------------- OPENAI PROXY -----------------
app.post("/api/openai", async (req, res) => {
  try {
    await connectDB();
    const { email, prompt } = req.body;

    let user = await Users.findOne({ email });
    if (!user) return res.json({ success: false, message: "User not registered" });

    if (user.paidCredits > 0) {
      await Users.updateOne({ email }, { $inc: { paidCredits: -1 } });
    } else if (user.freeCredits > 0) {
      await Users.updateOne({ email }, { $inc: { freeCredits: -1 } });
    } else {
      return res.json({ success: false, message: "No searches left" });
    }

    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are BABY AI." },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await ai.json();
    if (data.error) return res.json({ success: false, message: data.error.message });

    return res.json({
      success: true,
      response: data.choices[0].message.content
    });

  } catch (err) {
    console.log("OpenAI error:", err.message);
    return res.json({ success: false, message: "AI Error" });
  }
});

// ----------------- START SERVER -----------------
// Use PORT from environment, or 8080 as fallback (Railway default)
const PORT = parseInt(process.env.PORT, 10) || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🍼 BABY AI Backend running on port ${PORT}`);
});
