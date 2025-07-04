/*
  Warnings:

  - You are about to drop the column `usuarioId` on the `Log` table. All the data in the column will be lost.
  - You are about to drop the `Usuario` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Log" DROP CONSTRAINT "Log_usuarioId_fkey";

-- AlterTable
ALTER TABLE "Aluno" ADD COLUMN     "bloqueado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "codigoAtivacao" TEXT,
ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "nivelAcesso" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "perguntaSeguranca" TEXT,
ADD COLUMN     "respostaSeguranca" TEXT,
ADD COLUMN     "senha" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'INATIVO',
ADD COLUMN     "tentativasLogin" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimoLogin" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Emprestimo" ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Livro" ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Log" DROP COLUMN "usuarioId",
ADD COLUMN     "alunoId" INTEGER;

-- DropTable
DROP TABLE "Usuario";

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
