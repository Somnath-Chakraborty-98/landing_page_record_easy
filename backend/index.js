import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

import loadUser from "./middleware/loadUser.js";
import requireVerifiedUser from "./middleware/requireVerifiedUser.js";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

/* --------------------------------------------------
   Global Middleware
-------------------------------------------------- */
app.use(cors());
app.use(express.json());
app.use(express.static("../frontend"));
app.use(loadUser);

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
   PUBLIC: Signup / Waitlist
-------------------------------------------------- */
app.post("/api/waitlist", async (req, res) => {
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

    // 🔒 IMPORTANT: Block verified users
    if (user.is_verified) {
      return res.status(200).json({
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
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/* --------------------------------------------------
   PUBLIC: Resend Verification Email
-------------------------------------------------- */
app.post("/api/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: "Email already verified" });
    }

    const existing = await prisma.emailVerification.findUnique({
      where: { user_id: user.id }
    });

    if (existing) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (existing.created_at > fiveMinutesAgo) {
        return res.status(429).json({
          error: "Please wait before requesting another email"
        });
      }
    }

    const { rawToken, tokenHash } = generateEmailToken();

    await prisma.emailVerification.upsert({
      where: { user_id: user.id },
      update: {
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        created_at: new Date()
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

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

/* --------------------------------------------------
   PUBLIC: Verify Email
-------------------------------------------------- */
app.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).send("Invalid link");
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
      return res.status(400).send("Link expired or invalid");
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.user_id },
        data: {
          is_verified: true,
          verified_at: new Date()
        }
      }),
      prisma.emailVerification.delete({
        where: { id: record.id }
      })
    ]);

    return res.redirect("/verified.html");
  } catch (err) {
    console.error(err);
    return res.status(500).send("Internal error");
  }
});

/* --------------------------------------------------
   PROTECTED: Verified Users Only
-------------------------------------------------- */
app.get(
  "/api/protected",
  requireVerifiedUser,
  (req, res) => {
    return res.json({
      message: "Access granted. User is verified.",
      user: {
        id: req.user.id,
        email: req.user.email
      }
    });
  }
);

/* --------------------------------------------------
   Server
-------------------------------------------------- */
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
