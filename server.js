// ==========================================================
// BABY AI - AUTOMATED PAYMENT + EMAIL BACKEND (FINAL VERSION)
// ==========================================================

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

// ==========================================================
// CONFIG AREA
// ==========================================================

// Gmail sender (your Gmail + app password)
const EMAIL_USER = "samallenmik@gmail.com";
const EMAIL_PASS = "ehfg lanz lnxu ivmf";

// Port for Railway
const PORT = process.env.PORT || 3000;

// Your token packages
const PACKAGES = {
  basic: { price: 5, tokens: 2000 },
  premium: { price: 10, tokens: 5000 }
};

// In-memory DB (replace later with Mongo/Postgres)
const users = {};
const payments = [];

// ==========================================================
// EMAIL SENDER (GMAIL SMTP)
// ==========================================================

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
      <p>Thank you for your payment.</p>
      <p>Your activation code is:</p>
      <h1 style="color:#0ea5e9;">${activationCode}</h1>
      <p>Paste this inside the BABY Chrome extension to activate your ${tokens} tokens.</p>
      <br>
      <p>Regards,<br>BABY AI Team</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("📧 Email sent →", toEmail);
  } catch (err) {
    console.error("❌ Email sending failed:", err.message);
  }
}

// ==========================================================
// HELPER — Generate Activation Code
// ==========================================================

function generateActivationCode(email, tokens) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  const userData = {
    email,
    tokens,
    purchaseDate: new Date().toISOString(),
    expiryDate: expiryDate.toISOString(),
    isActive: true
  };

  users[email] = userData;

  // Encode the activation object
  return Buffer.from(JSON.stringify(userData)).toString("base64");
}

// ==========================================================
// PAYPAL WEBHOOK HANDLER
// ==========================================================

app.post("/webhook/paypal", async (req, res) => {
  console.log("📥 PayPal webhook received");

  const body = req.body;

  // We trust webhook for now (no verification)
  if (body.event_type !== "PAYMENT.SALE.COMPLETED") {
    return res.status(200).send("Ignored");
  }

  const payerEmail = body.resource.payer.email_address;
  const amount = parseFloat(body.resource.amount.total);

  console.log(`💰 Payment: $${amount} from ${payerEmail}`);

  // Decide package
  let pkg = PACKAGES.basic;
  if (amount >= 10) pkg = PACKAGES.premium;

  // Generate activation code
  const activationCode = generateActivationCode(payerEmail, pkg.tokens);

  // Save payment
  payments.push({
    email: payerEmail,
    amount,
    tokens: pkg.tokens,
    activationCode,
    date: new Date().toISOString()
  });

  // Send email
  await sendActivationEmail(payerEmail, activationCode, pkg.tokens);

  res.status(200).send("OK");
});

// ==========================================================
// API — Activate Code (Extension uses this)
// ==========================================================

app.post("/api/activate", (req, res) => {
  try {
    const decoded = JSON.parse(
      Buffer.from(req.body.activationCode, "base64").toString()
    );

    if (!users[decoded.email] || !users[decoded.email].isActive) {
      return res.json({
        success: false,
        message: "Invalid activation code"
      });
    }

    return res.json({
      success: true,
      tokens: decoded.tokens,
      expiryDate: decoded.expiryDate,
      message: `${decoded.tokens} tokens activated!`
    });
  } catch (err) {
    return res.json({
      success: false,
      message: "Invalid activation code format"
    });
  }
});

// ==========================================================
// CHECK BALANCE / EXPIRY
// ==========================================================

app.post("/api/balance", (req, res) => {
  const { email, tokenBalance } = req.body;

  if (!users[email]) {
    return res.json({
      status: "no_subscription",
      message: "No active subscription found"
    });
  }

  const user = users[email];
  const now = new Date();
  const expiry = new Date(user.expiryDate);

  if (now > expiry) {
    return res.json({
      status: "expired",
      message: "Your tokens expired! Buy again."
    });
  }

  if (tokenBalance < 100) {
    return res.json({
      status: "low_tokens",
      message: "⚠️ Low tokens — buy more!"
    });
  }

  return res.json({
    status: "active",
    expiryDate: user.expiryDate,
    balance: tokenBalance
  });
});

// ==========================================================
// ADMIN — View all payments
// ==========================================================

app.get("/api/admin/payments", (req, res) => {
  res.json(payments);
});

// ==========================================================
// START SERVER
// ==========================================================

app.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════
   🍼 BABY AI BACKEND RUNNING ON PORT ${PORT}
   PAYPAL AUTO → ACTIVATION → EMAIL READY
═══════════════════════════════════════`);
});
