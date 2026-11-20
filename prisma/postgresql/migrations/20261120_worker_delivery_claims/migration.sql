-- Fence concurrent sender attempts and recover interrupted recipients safely.
ALTER TABLE "EmailRecipient" ADD COLUMN "claimToken" TEXT;

-- Only one sender instance may own campaign delivery at a time.
CREATE TABLE "WorkerLease" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WorkerLease_pkey" PRIMARY KEY ("id")
);
