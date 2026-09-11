ALTER TABLE "users" ADD COLUMN "first_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '';

UPDATE "users" SET
  "first_name" = split_part("name", ' ', 1),
  "last_name" = CASE
    WHEN position(' ' in "name") > 0 THEN substring("name" from position(' ' in "name") + 1)
    ELSE ''
  END;

ALTER TABLE "users" DROP COLUMN "name";
