require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// ENV Variables
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DBNAME;
const PORT = process.env.PORT || 3000;

// Credit System
const FREE_CREDITS = 50;
const PAID_PACK = 500;  // $5 → 500 searches

// MongoDB Setup
let db, Users, Payments;

async function connectDB() {
  if (db) return db;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  Users = db.collection("users");
  Payments = db.collection("payments");
  console.log("✅ MongoDB Connected Successfully");
}
connectDB();

// Email System
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// Helper → send purchase email
async function sendPurchaseEmail(toEmail, credits) {
  const mailOptions = {
    from: `"BABY AI Credits" <${EMAIL_USER}>`,
    to: toEmail,
    subject: "Your BABY AI Credits are Added 🎉",
    html: `
      <h2>🎉 Purchase Successful!</h2>
      <p>You have received <b>${credits}</b> new AI searches.</p>
      <p>Open your BABY AI extension — the balance will auto update.</p>
      <br><p>BABY AI Team</p>
    `
  };
  await transporter.sendMail(mailOptions);
}

// ------------------------------------------------------------
// REGISTER USER → email + deviceId
// ------------------------------------------------------------
app.post("/api/register", async (req, res) => {
  await connectDB();

  const { email, deviceId } = req.body;
  if (!email || !deviceId) {
    return res.json({ success: false, message: "Missing email or deviceId" });
  }

  // Check if this device already used free credits
  const existingDevice = await Users.findOne({ deviceId });

  if (existingDevice) {
    return res.json({
      success: true,
      freeCredits: 0,
      paidCredits: existingDevice.paidCredits || 0,
      message: "Free trial already used on this device"
    });
  }

  // New Device → Give Free 50 Credits
  const newUser = {
    email,
    deviceId,
    freeCredits: FREE_CREDITS,
    paidCredits: 0,
    createdAt: new Date()
  };

  await Users.insertOne(newUser);

  return res.json({
    success: true,
    freeCredits: FREE_CREDITS,
    paidCredits: 0,
    message: "Free trial activated!"
  });
});

// ------------------------------------------------------------
// GET BALANCE
// ------------------------------------------------------------
app.post("/api/balance", async (req, res) => {
  await connectDB();
  const { email } = req.body;

  const user = await Users.findOne({ email });
  if (!user) {
    return res.json({ success: false, message: "User not found", free: 0, paid: 0 });
  }

  return res.json({
    success: true,
    free: user.freeCredits,
    paid: user.paidCredits
  });
});

// ------------------------------------------------------------
// OPENAI PROXY → Deduct Credits
// ------------------------------------------------------------
app.post("/api/openai", async (req, res) => {
  await connectDB();
  const { email, prompt, model = "gpt-4o-mini" } = req.body;

  const user = await Users.findOne({ email });
  if (!user) return res.json({ success: false, message: "User not registered" });

  // Deduct paid credits first
  if (user.paidCredits > 0) {
    await Users.updateOne({ email }, { $inc: { paidCredits: -1 } });
  }
  else if (user.freeCredits > 0) {
    await Users.updateOne({ email }, { $inc: { freeCredits: -1 } });
  }
  else {
    return res.json({
      success: false,
      message: "No searches left. Buy 500 searches for $5."
    });
  }

  // Call OpenAI
  try {
    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are BABY AI." },
          { role: "user", content: prompt }
        ],
        max_tokens: 350,
        temperature: 0.7
      })
    });

    const data = await ai.json();

    if (data.error) {
      return res.json({ success: false, message: data.error.message });
    }

    return res.json({
      success: true,
      response: data.choices[0].message.content
    });

  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
});

// ------------------------------------------------------------
// PAYPAL WEBHOOK → Add 500 Credits
// ------------------------------------------------------------
app.post("/webhook/paypal", async (req, res) => {
  await connectDB();

  const payerEmail = req.body?.resource?.payer?.email_address;
  if (!payerEmail) return res.status(200).send("ignored");

  // Add credits
  await Users.updateOne(
    { email: payerEmail },
    { $inc: { paidCredits: PAID_PACK } },
    { upsert: true }
  );

  // Save to payment logs
  await Payments.insertOne({
    email: payerEmail,
    creditsAdded: PAID_PACK,
    amount: 5,
    date: new Date()
  });

  // Notify user by email
  await sendPurchaseEmail(payerEmail, PAID_PACK);

  return res.status(200).send("OK");
});

// ------------------------------------------------------------
// ADMIN → View Payments
// ------------------------------------------------------------
app.get("/api/admin/payments", async (req, res) => {
  await connectDB();
  const logs = await Payments.find().sort({ date: -1 }).toArray();
  res.json(logs);
});

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════
   🍼 BABY AI BACKEND LIVE ON PORT ${PORT}
   ✔ MongoDB Connected
   ✔ Free 50 Searches Per Device
   ✔ Paid 500 Searches Pack Ready
   ✔ OpenAI Proxy Ready
   ✔ PayPal Webhook Ready
═══════════════════════════════════════
`);
});
