
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";

dotenv.config();
const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.post("/api/waitlist", async (req, res) => {
  const { email } = req.body;
  const token = uuid();

  await prisma.waitlist.create({
    data: { email, token }
  });

  const link = `${process.env.BASE_URL}/verify?token=${token}`;
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: "Verify your email",
    html: `<a href="${link}">Verify</a>`
  });

  res.json({ success: true });
});

app.get("/verify", async (req, res) => {
  const { token } = req.query;
  const entry = await prisma.waitlist.findFirst({ where: { token } });
  if (!entry) return res.send("Invalid link");

  await prisma.waitlist.update({
    where: { id: entry.id },
    data: { verified: true, verifiedAt: new Date() }
  });

  res.send("Email verified.");
});

app.listen(4000, () => console.log("Backend running"));
