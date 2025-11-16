// ============================================
// BABY - AUTOMATED PAYMENT BACKEND SERVER
// ============================================
// This handles PayPal webhooks and auto-activates tokens

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// ============================================
// CONFIG - CHANGE THESE AFTER SETUP!
// ============================================
const PORT = process.env.PORT || 3000; // Railway sets this automatically
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || "TEMP_ID"; // Add in Railway after PayPal setup
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || ""; // Add in Railway after SendGrid setup

// Token packages
const PACKAGES = {
  basic: { price: 5, tokens: 2000, name: "Basic Package" },
  premium: { price: 10, tokens: 5000, name: "Premium Package" }
};

// Simple in-memory database (use MongoDB/PostgreSQL in production)
const users = {};
const payments = [];

// ============================================
// HELPER: Generate activation code for user
// ============================================
function generateActivationCode(email, tokens) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30); // 30 days from now
  
  const userData = {
    email: email,
    tokens: tokens,
    purchaseDate: new Date().toISOString(),
    expiryDate: expiryDate.toISOString(),
    isActive: true
  };
  
  users[email] = userData;
  
  // Generate code that extension can use
  const activationCode = Buffer.from(JSON.stringify(userData)).toString('base64');
  
  return activationCode;
}

// ============================================
// ENDPOINT: PayPal Webhook (Auto-activation!)
// ============================================
app.post('/webhook/paypal', async (req, res) => {
  console.log('📥 PayPal webhook received!');
  
  const payment = req.body;
  
  // Verify webhook signature (security!)
  const webhookId = req.headers['paypal-transmission-id'];
  const timestamp = req.headers['paypal-transmission-time'];
  const signature = req.headers['paypal-transmission-sig'];
  
  // TODO: Verify signature with PayPal API
  // For now, we'll trust it (add verification in production!)
  
  // Check if payment is completed
  if (payment.event_type === 'PAYMENT.SALE.COMPLETED') {
    const payerEmail = payment.resource.payer.email_address;
    const amount = parseFloat(payment.resource.amount.total);
    const paymentId = payment.resource.id;
    
    console.log(`✅ Payment received: ${amount} from ${payerEmail}`);
    
    // Determine package based on amount
    let packageType = 'basic';
    if (amount >= 10) packageType = 'premium';
    
    const pkg = PACKAGES[packageType];
    
    // Generate activation code
    const activationCode = generateActivationCode(payerEmail, pkg.tokens);
    
    // Store payment record
    payments.push({
      paymentId: paymentId,
      email: payerEmail,
      amount: amount,
      tokens: pkg.tokens,
      date: new Date().toISOString(),
      activationCode: activationCode
    });
    
    // Send email with activation code
    if (SENDGRID_API_KEY) {
      await sendActivationEmail(payerEmail, activationCode, pkg.tokens);
    } else {
      console.log(`📧 EMAIL NOT CONFIGURED - Manual code for ${payerEmail}:`);
      console.log(`   Code: ${activationCode}`);
      console.log(`   Tokens: ${pkg.tokens}`);
    }
    
    res.status(200).send('OK');
  } else {
    res.status(200).send('Event ignored');
  }
});

// ============================================
// HELPER: Send activation email
// ============================================
async function sendActivationEmail(email, code, tokens) {
  if (!SENDGRID_API_KEY) {
    console.log('SendGrid not configured, skipping email');
    return;
  }
  
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(SENDGRID_API_KEY);
    
    const msg = {
      to: email,
      from: 'support@yourdomain.com', // CHANGE THIS to your verified sender email
      subject: '🎉 Your BABY Activation Code - 2000 Tokens!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
            .container { background: white; max-width: 600px; margin: 0 auto; padding: 40px; border-radius: 10px; }
            .header { text-align: center; color: #00eaff; font-size: 32px; margin-bottom: 20px; }
            .code-box { background: #0c0f1c; color: #00eaff; padding: 20px; border-radius: 10px; font-size: 24px; text-align: center; margin: 20px 0; font-family: monospace; letter-spacing: 2px; }
            .steps { background: #f9f9f9; padding: 20px; border-radius: 10px; margin: 20px 0; }
            .step { margin: 10px 0; padding-left: 30px; position: relative; }
            .step:before { content: "✓"; position: absolute; left: 0; color: #00eaff; font-weight: bold; font-size: 20px; }
            .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">🍼 BABY AI Assistant</div>
            
            <h2>🎉 Welcome to BABY Premium!</h2>
            <p>Thank you for your purchase! You now have <strong>${tokens} tokens</strong> ready to use.</p>
            
            <h3>Your Activation Code:</h3>
            <div class="code-box">${code}</div>
            
            <div class="steps">
              <h3>How to Activate:</h3>
              <div class="step">Open your BABY extension in Chrome</div>
              <div class="step">Click the button "📝 Have Activation Code?"</div>
              <div class="step">Paste the code above</div>
              <div class="step">Click "ACTIVATE TOKENS"</div>
              <div class="step">Start using your ${tokens} tokens!</div>
            </div>
            
            <p><strong>Token Details:</strong></p>
            <ul>
              <li>Tokens: ${tokens}</li>
              <li>Valid for: 30 days from activation</li>
              <li>Select 10/15/25/50 tokens per search</li>
            </ul>
            
            <p><strong>Need Help?</strong><br>
            Reply to this email or contact support.</p>
            
            <div class="footer">
              <p>Thank you for using BABY AI Assistant!<br>
              "Your Best AI Bot You'll Ever Need"</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    await sgMail.send(msg);
    console.log(`✅ Activation email sent to ${email}`);
  } catch (error) {
    console.error(`❌ Email send failed:`, error.message);
  }
});

// ============================================
// ENDPOINT: Activate tokens (Extension calls this!)
// ============================================
app.post('/api/activate', (req, res) => {
  const { activationCode } = req.body;
  
  try {
    const userData = JSON.parse(Buffer.from(activationCode, 'base64').toString());
    
    // Check if code is valid
    if (users[userData.email] && users[userData.email].isActive) {
      res.json({
        success: true,
        tokens: userData.tokens,
        expiryDate: userData.expiryDate,
        message: `${userData.tokens} tokens activated! Valid until ${new Date(userData.expiryDate).toLocaleDateString()}`
      });
    } else {
      res.json({
        success: false,
        message: 'Invalid or expired activation code'
      });
    }
  } catch (error) {
    res.json({
      success: false,
      message: 'Invalid activation code format'
    });
  }
});

// ============================================
// ENDPOINT: Check if user needs renewal
// ============================================
app.post('/api/check-expiry', (req, res) => {
  const { email } = req.body;
  
  if (!users[email]) {
    res.json({
      needsRenewal: false,
      message: 'User not found'
    });
    return;
  }
  
  const user = users[email];
  const expiryDate = new Date(user.expiryDate);
  const now = new Date();
  const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
  
  if (daysLeft <= 0) {
    res.json({
      needsRenewal: true,
      message: `Your tokens expired! Purchase again to continue.`,
      daysLeft: 0
    });
  } else if (daysLeft <= 7) {
    res.json({
      needsRenewal: false,
      showReminder: true,
      message: `${daysLeft} days left! Renew soon.`,
      daysLeft: daysLeft
    });
  } else {
    res.json({
      needsRenewal: false,
      showReminder: false,
      daysLeft: daysLeft
    });
  }
});

// ============================================
// ENDPOINT: Check token balance
// ============================================
app.post('/api/balance', (req, res) => {
  const { email, tokenBalance } = req.body;
  
  if (!users[email]) {
    res.json({
      status: 'no_subscription',
      message: 'No active subscription'
    });
    return;
  }
  
  const user = users[email];
  const expiryDate = new Date(user.expiryDate);
  const now = new Date();
  
  // Check if expired
  if (now > expiryDate) {
    res.json({
      status: 'expired',
      message: '30 days expired! Buy tokens again.',
      showPaymentLink: true
    });
    return;
  }
  
  // Check if tokens low
  if (tokenBalance < 100) {
    res.json({
      status: 'low_tokens',
      message: `Only ${tokenBalance} tokens left! Buy more?`,
      showPaymentLink: true
    });
    return;
  }
  
  // All good!
  res.json({
    status: 'active',
    balance: tokenBalance,
    expiryDate: user.expiryDate
  });
});

// ============================================
// ENDPOINT: Manual activation (for testing)
// ============================================
app.post('/api/manual-activate', (req, res) => {
  const { email, tokens } = req.body;
  
  const code = generateActivationCode(email, tokens || 2000);
  
  res.json({
    success: true,
    activationCode: code,
    message: `Use this code in extension: ${code}`
  });
});

// ============================================
// ENDPOINT: Get all payments (admin)
// ============================================
app.get('/api/admin/payments', (req, res) => {
  res.json({
    total: payments.length,
    payments: payments
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  🍼 BABY PAYMENT SERVER RUNNING!      ║
╚════════════════════════════════════════╝

Server: http://localhost:${PORT}
PayPal Webhook: http://localhost:${PORT}/webhook/paypal

📋 Endpoints:
- POST /webhook/paypal      → PayPal sends payment notification
- POST /api/activate        → Extension activates tokens
- POST /api/check-expiry    → Check if renewal needed
- POST /api/balance         → Check token status
- POST /api/manual-activate → Generate code manually
- GET  /api/admin/payments  → View all payments

✅ Ready to receive payments!
  `);
});
