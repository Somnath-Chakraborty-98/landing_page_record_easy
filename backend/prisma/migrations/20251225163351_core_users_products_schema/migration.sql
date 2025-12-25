/*
  Warnings:

  - Added the required column `product_id` to the `early_support` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "early_support" ADD COLUMN     "product_id" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "early_support_product_id_idx" ON "early_support"("product_id");

-- AddForeignKey
ALTER TABLE "early_support" ADD CONSTRAINT "early_support_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
