const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const { hashToken } = require("../utils/crypto");

const prisma = new PrismaClient();
const PRODUCT_ID = 1; // change later if needed

async function requestWaitlist(email) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email }
  });

  const token = crypto.randomUUID();

  await prisma.emailVerification.upsert({
    where: { user_id: user.id },
    update: {
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 30 * 60 * 1000)
    },
    create: {
      user_id: user.id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 30 * 60 * 1000)
    }
  });

  return token;
}

async function verifyWaitlist(token) {
  const tokenHash = hashToken(token);

  await prisma.$transaction(async (tx) => {
    const record = await tx.emailVerification.findFirst({
      where: {
        token_hash: tokenHash,
        expires_at: { gt: new Date() }
      }
    });

    if (!record) throw new Error("INVALID_TOKEN");

    await tx.user.update({
      where: { id: record.user_id },
      data: {
        is_verified: true,
        verified_at: new Date()
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
      where: { user_id: record.user_id }
    });
  });
}

module.exports = {
  requestWaitlist,
  verifyWaitlist
};
