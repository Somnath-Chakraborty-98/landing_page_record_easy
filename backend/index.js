import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import crypto from "crypto";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import prisma from "./lib/prisma.js";

dotenv.config();

/* --------------------------------------------------
   App & Prisma
-------------------------------------------------- */
const app = express();

// ✅ REQUIRED if behind proxy (Cloudflare, Render, Vercel, Nginx)
app.set("trust proxy", 1);

/* --------------------------------------------------
   Resolve __dirname (ESM safe)
-------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* --------------------------------------------------
   Global Middleware
-------------------------------------------------- */
app.use(cors());

/*
app.use(cors({
  origin: ["https://recordeasy.com"],
  methods: ["GET", "POST"]
}));

*/
app.use(express.json());

// ✅ ALWAYS use absolute path for static files
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.json({
      success: true,
      database: "connected"
    });
  } catch (err) {
    console.error("Health check failed:", err);

    return res.status(500).json({
      success: false,
      error: "Database connection failed"
    });
  }
});

/* --------------------------------------------------
   Mail Transporter (Zoho SMTP)
-------------------------------------------------- */
function getRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function getSmtpConfig() {
  const port = Number(process.env.SMTP_PORT || 465);

  if (!Number.isInteger(port)) {
    throw new Error("SMTP_PORT must be a valid integer");
  }

  return {
    host: getRequiredEnv("SMTP_HOST"),
    port,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE.trim().toLowerCase() === "true"
      : port === 465,
    auth: {
      user: getRequiredEnv("SMTP_USER"),
      pass: getRequiredEnv("SMTP_PASS")
    }
  };
}

function isSmtpAuthError(err) {
  return err?.code === "EAUTH" || String(err?.responseCode) === "535";
}

function logMailError(context, err) {
  if (isSmtpAuthError(err)) {
    console.error(`${context}:`, {
      code: err.code,
      responseCode: err.responseCode,
      response: err.response,
      command: err.command
    });
    return;
  }

  console.error(`${context}:`, err);
}

const transporter = nodemailer.createTransport({
  ...getSmtpConfig()
});

function fromAddress() {
  return `"${getRequiredEnv("SMTP_FROM_NAME")}" <${getRequiredEnv("SMTP_FROM_EMAIL")}>`;
}

/* --------------------------------------------------
   Helpers
-------------------------------------------------- */
function generateEmailToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  return { rawToken, tokenHash };
}

function getDonationAmountLimits() {
  return {
    min: Number(process.env.DONATION_MIN_AMOUNT_INR || 50),
    max: Number(process.env.DONATION_MAX_AMOUNT_INR || 50000)
  };
}

function getRazorpayCredentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }

  return { keyId, keySecret };
}

function createRazorpayOrder(payload) {
  return new Promise((resolve, reject) => {
    const { keyId, keySecret } = getRazorpayCredentials();
    const requestBody = JSON.stringify(payload);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const options = {
      hostname: "api.razorpay.com",
      path: "/v1/orders",
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody)
      }
    };

    const razorpayReq = https.request(options, (razorpayRes) => {
      let responseBody = "";

      razorpayRes.on("data", (chunk) => {
        responseBody += chunk;
      });

      razorpayRes.on("end", () => {
        let data = {};

        try {
          data = responseBody ? JSON.parse(responseBody) : {};
        } catch {
          return reject(new Error("Invalid response from Razorpay"));
        }

        if (razorpayRes.statusCode < 200 || razorpayRes.statusCode >= 300) {
          return reject(new Error(data.error?.description || "Razorpay order creation failed"));
        }

        return resolve(data);
      });
    });

    razorpayReq.on("error", reject);
    razorpayReq.write(requestBody);
    razorpayReq.end();
  });
}

function isValidRazorpaySignature(orderId, paymentId, signature) {
  const { keySecret } = getRazorpayCredentials();
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(signature || "");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/* --------------------------------------------------
   PUBLIC: Razorpay Donation Checkout
-------------------------------------------------- */
const donationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many donation attempts. Please try again after 15 minutes."
  }
});

app.post("/api/donations/order", donationLimiter, async (req, res) => {
  try {
    const { keyId } = getRazorpayCredentials();
    const { min, max } = getDonationAmountLimits();
    const amountInRupees = Number(req.body?.amount);

    if (!Number.isFinite(amountInRupees)) {
      return res.status(400).json({ error: "Donation amount is required" });
    }

    if (amountInRupees < min || amountInRupees > max) {
      return res.status(400).json({
        error: `Donation amount must be between INR ${min} and INR ${max}`
      });
    }

    const amountInPaise = Math.round(amountInRupees * 100);
    const order = await createRazorpayOrder({
      amount: amountInPaise,
      currency: "INR",
      receipt: `don_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      notes: {
        project: "RecordEasy",
        purpose: "Project support"
      }
    });

    return res.json({
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: "RecordEasy",
      description: "Support RecordEasy development"
    });
  } catch (err) {
    console.error("Donation order error:", err);
    const status = err.message.includes("credentials") ? 503 : 500;

    return res.status(status).json({
      error: status === 503
        ? "Razorpay is not configured yet."
        : "Unable to start Razorpay checkout. Please try again later."
    });
  }
});

app.post("/api/donations/verify", donationLimiter, async (req, res) => {
  try {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    } = req.body || {};

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: "Missing payment verification details" });
    }

    if (!isValidRazorpaySignature(orderId, paymentId, signature)) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    return res.json({
      success: true,
      message: "Payment verified. Thank you for supporting RecordEasy."
    });
  } catch (err) {
    console.error("Donation verification error:", err);
    return res.status(500).json({
      error: "Unable to verify payment. Please contact support if money was deducted."
    });
  }
});

/* --------------------------------------------------
   PUBLIC: Join Waitlist (Email Only)
-------------------------------------------------- */
const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,                  // 3 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many attempts. Please try again after 15 minutes."
  }
});

app.post("/api/waitlist", waitlistLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email }
    });

    // Already verified → no email needed
    if (user.is_verified) {
      return res.json({
        success: true,
        message: "Email already verified"
      });
    }

    const { rawToken, tokenHash } = generateEmailToken();

    await prisma.emailVerification.upsert({
      where: { user_id: user.id },
      update: {
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
      },
      create: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    const link = `${process.env.BASE_URL}/verify-email?token=${rawToken}`;

    await transporter.sendMail({
      from: fromAddress(),
      to: email,
      subject: "Verify your email for RecordEasy",
      text: `Click the link to verify your email:\n\n${link}`
    });

    return res.json({
      success: true,
      message: "Verification email sent"
    });
  } catch (err) {
    logMailError("Waitlist error", err);
    return res.status(500).json({
      error: "Something went wrong. Please try again later."
    });
  }
});

/* --------------------------------------------------
   PUBLIC: Verify Email → Add to Waitlist
-------------------------------------------------- */
app.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).sendFile(
        path.join(__dirname, "../frontend/error.html")
      );

    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const record = await prisma.emailVerification.findFirst({
      where: {
        token_hash: tokenHash,
        expires_at: { gt: new Date() }
      }
    });

    if (!record) {
      return res.status(400).sendFile(
        path.join(__dirname, "../frontend/error.html")
      );

    }

    const PRODUCT_ID = 1; // must exist in products table

    const countryCode =
      req.headers["cf-ipcountry"] &&
        req.headers["cf-ipcountry"] !== "XX"
        ? req.headers["cf-ipcountry"]
        : null;


    await prisma.$transaction(async (tx) => {

      await tx.user.update({
        where: { id: record.user_id },
        data: {
          is_verified: true,
          verified_at: new Date()
        }
      });

      await tx.userInfo.upsert({
        where: { user_id: record.user_id },
        update: {
          country: countryCode ?? undefined
        },
        create: {
          user_id: record.user_id,
          first_login_at: new Date(),
          country: countryCode
        }
      });

      await tx.waitlistEntry.upsert({
        where: {
          user_id_product_id: {
            user_id: record.user_id,
            product_id: PRODUCT_ID
          }
        },
        update: {},
        create: {
          user_id: record.user_id,
          product_id: PRODUCT_ID
        }
      });

      await tx.emailVerification.delete({
        where: { id: record.id }
      });
    });

    return res.redirect("/verified.html");
  } catch (err) {
    console.error("Verify email failed:", err);
    return res.status(400).sendFile(
      path.join(__dirname, "../frontend/error.html")
    );

  }
});

/* --------------------------------------------------
   Server
-------------------------------------------------- */
const PORT = process.env.PORT || 4000;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
  });
}

export default app;
