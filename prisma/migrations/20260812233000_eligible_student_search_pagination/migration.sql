-- The picker filters by role/verification and sorts by email + id for stable
-- keyset pagination. This index also handles the no-search browsing path.
CREATE INDEX "users_role_email_verified_email_id_idx"
ON "users"("role", "email_verified", "email", "id");

-- Case-insensitive contains search cannot use a normal B-tree index. Trigram
-- indexes keep name/email lookup responsive while remaining small by indexing
-- only the verified student population eligible for paid enrollment.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "users_eligible_email_trgm_idx"
ON "users" USING GIN ("email" gin_trgm_ops)
WHERE "role" = 'STUDENT' AND "email_verified" IS TRUE;

CREATE INDEX "users_eligible_first_name_trgm_idx"
ON "users" USING GIN ("first_name" gin_trgm_ops)
WHERE "role" = 'STUDENT' AND "email_verified" IS TRUE;

CREATE INDEX "users_eligible_last_name_trgm_idx"
ON "users" USING GIN ("last_name" gin_trgm_ops)
WHERE "role" = 'STUDENT' AND "email_verified" IS TRUE;
