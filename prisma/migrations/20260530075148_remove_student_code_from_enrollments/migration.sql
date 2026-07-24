/*
  Warnings:

  - You are about to drop the column `student_code` on the `enrollments` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "enrollments_student_code_key";

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "student_code";
