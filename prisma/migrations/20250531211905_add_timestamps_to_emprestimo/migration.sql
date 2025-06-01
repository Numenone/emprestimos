/*
  Warnings:

  - You are about to drop the column `createdAt` on the `emprestimo` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `emprestimo` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `emprestimo` DROP COLUMN `createdAt`,
    DROP COLUMN `updatedAt`,
    ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- RenameIndex
ALTER TABLE `emprestimo` RENAME INDEX `Emprestimo_alunoId_fkey` TO `Emprestimo_alunoId_idx`;

-- RenameIndex
ALTER TABLE `emprestimo` RENAME INDEX `Emprestimo_livroId_fkey` TO `Emprestimo_livroId_idx`;
