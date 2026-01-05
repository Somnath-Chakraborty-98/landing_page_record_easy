import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import rateLimit from "express-rate-limit";

dotenv.config();

/* --------------------------------------------------
   App & Prisma
-------------------------------------------------- */
const app = express();
const prisma = new PrismaClient();

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

/* --------------------------------------------------
   Mail Transporter (Zoho SMTP)
-------------------------------------------------- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

function fromAddress() {
  return `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`;
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
    console.error("Waitlist error:", err);
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

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
