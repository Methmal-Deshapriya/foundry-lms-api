-- Stage 2/3 of the dynamic-service-content plan: adds the remaining public
-- Level-2 page content — a short card blurb (`summary`, distinct from the
-- fuller `description` now used as the hero paragraph), two bespoke hero
-- tags, a second R2-backed image for the home page card (distinct from the
-- existing hero image), and the "how it works" steps + FAQ as JSON arrays
-- (same pattern as Course.skills/prerequisites — always read as one whole
-- blob per service, never queried into individually).
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'SERVICE_CARD';

ALTER TABLE "learning_services" ADD COLUMN "summary" TEXT;
ALTER TABLE "learning_services" ADD COLUMN "hero_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "learning_services" ADD COLUMN "card_image_object_id" TEXT;
ALTER TABLE "learning_services" ADD COLUMN "process_steps" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "learning_services" ADD COLUMN "faq_items" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "learning_services_card_image_object_id_idx" ON "learning_services"("card_image_object_id");

ALTER TABLE "learning_services" ADD CONSTRAINT "learning_services_card_image_object_id_fkey" FOREIGN KEY ("card_image_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the 3 existing real services with their current hardcoded frontend
-- content (data/publicServices/*.ts), so switching ServiceLanding.tsx over
-- to always read from the API doesn't blank out or reshuffle copy that's
-- already live. `summary` takes over the old `description` value (the card
-- blurb), and `description` becomes the fuller marketing paragraph that used
-- to live only in the hardcoded hero config. Card/hero images are left null
-- here — they need to be re-uploaded through the new admin UI to satisfy the
-- new fixed pixel dimensions (1672x941 card, 1374x1145 hero); the frontend
-- keeps a local-asset fallback for these 3 slugs until that happens.
UPDATE "learning_services" SET
  "summary" = 'Paid professional programs delivered through seasonal course intakes.',
  "description" = 'Explore structured learning pathways designed to help you understand core concepts, practise relevant skills, and build real projects.',
  "hero_headline" = 'Build practical skills for the technology industry',
  "hero_tags" = ARRAY['Practical learning', 'Beginner-friendly pathways'],
  "process_steps" = $steps$[
    {"title": "Choose a path", "description": "Select a field based on what you want to learn or create."},
    {"title": "Learn the foundations", "description": "Build a clear understanding of the important concepts."},
    {"title": "Practise", "description": "Apply what you learn through guided activities and exercises."},
    {"title": "Build", "description": "Use your knowledge in practical tasks and projects."}
  ]$steps$::jsonb,
  "faq_items" = $faq$[
    {"question": "Do I need previous experience?", "answer": "Some courses are designed for complete beginners, while others require foundational knowledge. Each course page clearly shows its level and prerequisites."},
    {"question": "How do I choose the correct learning track?", "answer": "Start with what you want to create or understand. Software Engineering focuses on building applications, Machine Learning focuses on systems that learn from data, Artificial Intelligence covers broader intelligent systems, and DevOps focuses on software delivery and operations."},
    {"question": "Are the bootcamps practical?", "answer": "Yes. The pathways combine conceptual learning with guided exercises, practical activities, and project-focused work."},
    {"question": "Can I follow more than one track?", "answer": "Yes. The tracks are connected, and learners may continue into another pathway after building the necessary foundations."},
    {"question": "How long does a course take?", "answer": "Course duration varies. The expected duration and learning level are shown on each individual course page."}
  ]$faq$::jsonb
WHERE "key" = 'BOOTCAMPS';

UPDATE "learning_services" SET
  "summary" = 'Paid preparation programs delivered through seasonal course intakes.',
  "description" = 'Structured preparation in the core subjects every BICT, BBST and BET student needs — built to make your first year feel familiar, not overwhelming.',
  "hero_headline" = 'Build a strong foundation before university starts',
  "hero_tags" = ARRAY['Exam-style practice', 'Foundation-level pacing'],
  "process_steps" = $steps$[
    {"title": "Assess your foundation", "description": "See where you stand before your first semester begins."},
    {"title": "Learn core theory", "description": "Build a clear understanding of the key concepts in each subject."},
    {"title": "Practise questions", "description": "Work through exam-style problems to build confidence."},
    {"title": "Prepare for university modules", "description": "Enter your first year with the foundations already in place."}
  ]$steps$::jsonb,
  "faq_items" = $faq$[
    {"question": "Do I need to have studied these subjects before?", "answer": "Some subjects assume no prior background, while others build on general secondary-level knowledge. Each subject page shows what's expected before you start."},
    {"question": "Which subject should I start with?", "answer": "Most students begin with Mathematics and Physics, since they underpin the other subjects, but you can start wherever you feel least confident."},
    {"question": "Is this the same as my university's syllabus?", "answer": "PreTech covers the core foundations shared across BICT, BBST and BET rather than one specific university's syllabus, so it transfers well regardless of where you enrol."},
    {"question": "Can I study more than one subject at a time?", "answer": "Yes. Many students work through two subjects in parallel, especially Mathematics alongside Physics or Statistics."},
    {"question": "How is this different from the IT bootcamps?", "answer": "PreTech is aimed at preparing you before university starts, while the IT bootcamps are industry-facing tracks for building job-ready skills."}
  ]$faq$::jsonb
WHERE "key" = 'PRETECH';

UPDATE "learning_services" SET
  "summary" = 'Self-paced courses available through free enrollment.',
  "description" = 'Free, open sessions covering the basics every tech career rests on — no application, no cost, just a place to start.',
  "hero_headline" = 'Open sessions for anyone who wants to start learning',
  "hero_tags" = ARRAY['Open to everyone', 'No cost to join'],
  "process_steps" = $steps$[
    {"title": "Choose an open resource", "description": "Pick the learning area that interests you most."},
    {"title": "Join or access it", "description": "Get in touch and we'll share how to join the session."},
    {"title": "Learn", "description": "Take part in the session at your own pace."},
    {"title": "Continue independently", "description": "Keep building on what you've learned after the session ends."}
  ]$steps$::jsonb,
  "faq_items" = $faq$[
    {"question": "Do I need to pay for these sessions?", "answer": "No. Public Contributions sessions are completely free and open to anyone who wants to join."},
    {"question": "Do I need any prior experience?", "answer": "No. These sessions are designed as an open starting point, with no prerequisites to join."},
    {"question": "How do I join a session?", "answer": "Select a learning area, choose a session, and get in touch — we'll share the details for joining or accessing it."},
    {"question": "Can I attend more than one learning area?", "answer": "Yes. You're welcome to join as many sessions as you'd like, in any order."},
    {"question": "Is this connected to the paid bootcamps?", "answer": "Free Learning is separate from the paid bootcamp tracks, though many learners use it as a first step before enrolling in one."}
  ]$faq$::jsonb
WHERE "key" = 'FREE_LEARNING';
