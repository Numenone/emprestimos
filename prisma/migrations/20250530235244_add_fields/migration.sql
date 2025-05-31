/*
  Warnings:

  - A unique constraint covering the columns `[matricula]` on the table `alunos` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `matricula` to the `alunos` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `alunos` ADD COLUMN `matricula` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `emprestimos` ADD COLUMN `devolvido` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX `alunos_matricula_key` ON `alunos`(`matricula`);
