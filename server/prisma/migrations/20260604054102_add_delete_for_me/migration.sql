-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "isEdited" SET DEFAULT false;

-- CreateTable
CREATE TABLE "_deleted_for_user" (
    "A" TEXT NOT NULL,
    "B" VARCHAR(30) NOT NULL,

    CONSTRAINT "_deleted_for_user_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_deleted_for_user_B_index" ON "_deleted_for_user"("B");

-- AddForeignKey
ALTER TABLE "_deleted_for_user" ADD CONSTRAINT "_deleted_for_user_A_fkey" FOREIGN KEY ("A") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_deleted_for_user" ADD CONSTRAINT "_deleted_for_user_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
