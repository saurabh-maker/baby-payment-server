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
const DB_NAME   = process.env.MONGODB_DBNAME;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!MONGO_URI) console.log("❌ MONGODB_URI missing");
if (!DB_NAME) console.log("❌ MONGODB_DBNAME missing");
if (!OPENAI_KEY) console.log("❌ OPENAI_API_KEY missing");

const FREE_CREDITS = 50;
const PAID_PACK = 500;

let db, Users;

// ----------------- CONNECT DB -----------------
async function connectDB() {
  if (db) return db;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  Users = db.collection("users");
  console.log("✅ MongoDB Connected");
}
connectDB();

// ----------------- REGISTER USER -----------------
app.post("/api/register", async (req, res) => {
  await connectDB();

  try {
    const { email, deviceId } = req.body;

    if (!email || !deviceId) {
      return res.json({ success: false, message: "Missing email or deviceId" });
    }

    let user = await Users.findOne({ deviceId });

    // Already used free credits on this device
    if (user) {
      return res.json({
        success: true,
        freeCredits: 0,
        paidCredits: user.paidCredits || 0,
        message: "Free trial already used on this device"
      });
    }

    // FIRST TIME → GIVE FREE 50
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
  await connectDB();
  const { email } = req.body;

  let user = await Users.findOne({ email });

  if (!user) {
    return res.json({ success: false, message: "User not found", free: 0, paid: 0 });
  }

  return res.json({
    success: true,
    free: user.freeCredits,
    paid: user.paidCredits
  });
});

// ----------------- OPENAI PROXY -----------------
app.post("/api/openai", async (req, res) => {
  await connectDB();
  const { email, prompt } = req.body;

  let user = await Users.findOne({ email });
  if (!user) return res.json({ success: false, message: "User not registered" });

  // Deduct credits
  if (user.paidCredits > 0) {
    await Users.updateOne({ email }, { $inc: { paidCredits: -1 } });
  } else if (user.freeCredits > 0) {
    await Users.updateOne({ email }, { $inc: { freeCredits: -1 } });
  } else {
    return res.json({ success: false, message: "No searches left" });
  }

  try {
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
    console.log("OpenAI error:", err);
    return res.json({ success: false, message: "AI Error" });
  }
});

// ----------------- START SERVER -----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍼 BABY AI Backend running on ${PORT}`);
});
