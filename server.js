require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");
const fetch = (...args) => import("node-fetch").then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// CONFIG
const EMAIL_USER   = process.env.EMAIL_USER;
const EMAIL_PASS   = process.env.EMAIL_PASS;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const PORT         = process.env.PORT || 3000;

// Token packages
const PACKAGES = {
  basic:   { price: 5,  tokens: 2000 },
  premium: { price: 10, tokens: 5000 }
};

// Temp DB
const users = {};
const payments = [];

// EMAIL SYSTEM
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

async function sendActivationEmail(toEmail, activationCode, tokens) {
  const mailOptions = {
    from: `"BABY AI Tokens" <${EMAIL_USER}>`,
    to: toEmail,
    subject: "🎉 Your BABY AI Activation Code",
    html: `
      <h2>🎉 Your BABY AI Activation Code</h2>
      <p>Your activation code:</p>
      <h1 style="color:#0ea5e9;">${activationCode}</h1>
      <p>Use this inside the BABY Chrome Extension.</p>
      <p>Tokens Added: <b>${tokens}</b></p>
      <p>BABY AI Team</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("📧 Email sent →", toEmail);
  } catch (err) {
    console.error("❌ Email Failed:", err.message);
  }
}

// GENERATE CODE
function generateActivationCode(email, tokens) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);

  const data = {
    email,
    tokens,
    purchaseDate: new Date().toISOString(),
    expiryDate: expiry.toISOString(),
    isActive: true
  };

  users[email] = data;

  return Buffer.from(JSON.stringify(data)).toString("base64");
}

// PAYPAL WEBHOOK
app.post("/webhook/paypal", async (req, res) => {
  console.log("📥 PayPal Webhook");

  const payerEmail = req.body.resource.payer.email_address;
  const amount     = parseFloat(req.body.resource.amount.total);

  let pkg = PACKAGES.basic;
  if (amount >= 10) pkg = PACKAGES.premium;

  const activationCode = generateActivationCode(payerEmail, pkg.tokens);

  payments.push({
    email: payerEmail,
    amount,
    tokens: pkg.tokens,
    activationCode,
    date: new Date().toISOString()
  });

  await sendActivationEmail(payerEmail, activationCode, pkg.tokens);

  res.status(200).send("OK");
});

// ACTIVATE TOKENS
app.post("/api/activate", (req, res) => {
  try {
    const decoded = JSON.parse(Buffer.from(req.body.activationCode, "base64").toString());
    const user    = users[decoded.email];

    if (!user || !user.isActive) {
      return res.json({ success: false, message: "Invalid activation code" });
    }

    return res.json({
      success: true,
      tokens: user.tokens,
      expiryDate: user.expiryDate,
      message: `${user.tokens} tokens activated!`
    });

  } catch (err) {
    return res.json({ success: false, message: "Invalid code format" });
  }
});

// TOKEN BALANCE
app.post("/api/balance", (req, res) => {
  const user = users[req.body.email];
  if (!user) return res.json({ status: "no_subscription" });

  const now     = new Date();
  const expires = new Date(user.expiryDate);

  if (now > expires) return res.json({ status: "expired" });

  return res.json({
    status: "active",
    expiryDate: user.expiryDate,
    balance: req.body.tokenBalance
  });
});

// OPENAI PROXY (SAFE)
app.post("/api/openai", async (req, res) => {
  try {
    const { prompt, model = "gpt-4o-mini" } = req.body;

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

// ADMIN
app.get("/api/admin/payments", (req, res) => {
  res.json(payments);
});

// START
app.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════
   🍼 BABY AI BACKEND RUNNING ON PORT ${PORT}
   ✔ PAYPAL READY
   ✔ EMAIL READY
   ✔ OPENAI PROXY READY
═══════════════════════════════════════`);
});
