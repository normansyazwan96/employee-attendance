-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "clockInAccuracy" DOUBLE PRECISION,
ADD COLUMN     "clockInLatitude" DOUBLE PRECISION,
ADD COLUMN     "clockInLongitude" DOUBLE PRECISION,
ADD COLUMN     "clockOutAccuracy" DOUBLE PRECISION,
ADD COLUMN     "clockOutLatitude" DOUBLE PRECISION,
ADD COLUMN     "clockOutLongitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Worksite" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worksite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Worksite_clientId_name_key" ON "Worksite"("clientId", "name");

-- AddForeignKey
ALTER TABLE "Worksite" ADD CONSTRAINT "Worksite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
