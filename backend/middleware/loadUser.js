import prisma from "../lib/prisma.js";

export default async function loadUser(req, res, next) {
  const userId = req.header("x-user-id");

  if (!userId) {
    return next();
  }

  const user = await prisma.user.findUnique({
    where: { id: Number(userId) }
  });

  req.user = user || null;
  next();
}
