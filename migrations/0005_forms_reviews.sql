-- ---------------------------------------------------------------------------
-- 0005_forms_reviews.sql - submissions inbox + editable reviews
-- (cms-forms-reviews-spec.md sections 3, 6, 9).
--
-- Extends the existing `forms` / `submissions` tables in place (the spec file
-- calls this table form_submissions; in this database it is `submissions`).
-- Every change is additive, and the inline project testimonials are COPIED
-- into `reviews` (not moved), so the old columns keep rendering until the
-- frontend is switched.
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- --- Forms: field definitions + autoresponder ------------------------------
-- fields: JSON array of field definitions (base spec section 7):
-- [{ id, type, label, placeholder, required, options, validation }]

ALTER TABLE forms ADD COLUMN fields TEXT NOT NULL DEFAULT '[]';

-- JSON { enabled, subject, body } or NULL (spec section 5).
ALTER TABLE forms ADD COLUMN autoresponder TEXT;

-- --- Submissions: inbox triage columns --------------------------------------
-- notes already exists from 0001_init.sql.

ALTER TABLE submissions ADD COLUMN read_at TEXT;
ALTER TABLE submissions ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN search_text TEXT;
ALTER TABLE submissions ADD COLUMN context TEXT;
ALTER TABLE submissions ADD COLUMN notify_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE submissions ADD COLUMN notify_error TEXT;

CREATE INDEX idx_subs_status ON submissions(status, created_at DESC);
CREATE INDEX idx_subs_unread ON submissions(read_at, created_at DESC);

-- --- Simple D1-backed rate limiter (spec section 4 step 5) -------------------

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- --- Reviews (spec section 9) ------------------------------------------------

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  quote TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT,
  company TEXT,
  avatar TEXT,
  rating INTEGER,
  source TEXT,
  source_url TEXT,
  reviewed_at TEXT,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Projects point at the review they show. This replaces the inline
-- testimonial columns after one release.

ALTER TABLE projects ADD COLUMN review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL;

-- The audit found six hardcoded testimonials. They seed the table in their
-- current order. Quotes are stored WITHOUT the surrounding quote marks; the
-- frontend adds those when rendering.

INSERT INTO reviews (id, quote, author_name, company, is_visible, position, created_at, updated_at)
  SELECT 'rev_atem-eyong', 'Absolutely fantastic team to work with!', 'Atem Eyong', 'Hard Rock Cafe', 1, 10, datetime('now'), datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'rev_atem-eyong');

INSERT INTO reviews (id, quote, author_name, company, is_visible, position, created_at, updated_at)
  SELECT 'rev_joe-weagraff', 'If you are looking for a superb, competent, and fast creative partner, this is it.', 'Joe Weagraff', 'Hitachi', 1, 20, datetime('now'), datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'rev_joe-weagraff');

INSERT INTO reviews (id, quote, author_name, company, is_visible, position, created_at, updated_at)
  SELECT 'rev_abbie-booth', 'The quality was excellent, and communication throughout was clear and professional. I highly recommend Chuech Studio.', 'Abbie Booth', 'Istobal', 1, 30, datetime('now'), datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'rev_abbie-booth');

INSERT INTO reviews (id, quote, author_name, company, is_visible, position, created_at, updated_at)
  SELECT 'rev_mike-jackson', 'Chuech Studio helped us achieve the top position for ‘garden rooms’. I’m more than happy to recommend them and can provide a reference.', 'Mike Jackson', 'Modern Garden Rooms', 1, 40, datetime('now'), datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'rev_mike-jackson');

INSERT INTO reviews (id, quote, author_name, company, is_visible, position, created_at, updated_at)
  SELECT 'rev_adrian-lambert', 'We’ve worked with the team for 5 years. Their digital marketing expertise has consistently driven awareness, interest, and leads.', 'Adrian Lambert', 'Blackbird', 1, 50, datetime('now'), datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'rev_adrian-lambert');

INSERT INTO reviews (id, quote, author_name, company, is_visible, position, created_at, updated_at)
  SELECT 'rev_chris-cheadle', 'We’re thrilled with the SEO audit and implementations! It’s exciting to see our targeted keywords making their way to page one.', 'Chris Cheadle', 'Northern Dough Co', 1, 60, datetime('now'), datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'rev_chris-cheadle');

-- --- Migrate inline project testimonials into reviews (spec section 9) -------

INSERT INTO reviews (id, quote, author_name, company, is_visible, position, created_at, updated_at)
  SELECT
    'rev_project_' || p.slug,
    p.testimonial_quote,
    COALESCE(p.testimonial_author, 'Client'),
    p.testimonial_company,
    1,
    100 + ROW_NUMBER() OVER (ORDER BY p.position),
    datetime('now'),
    datetime('now')
  FROM projects p
  WHERE p.testimonial_quote IS NOT NULL AND p.testimonial_quote != ''
    AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.id = 'rev_project_' || p.slug);

UPDATE projects SET review_id = 'rev_project_' || slug
  WHERE testimonial_quote IS NOT NULL AND testimonial_quote != ''
    AND (review_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM reviews r WHERE r.id = projects.review_id));

-- --- Form field definitions (spec section 3 seed) -----------------------------
-- Field keys equal the name attributes the frontend already uses (see
-- docs/forms-inventory.md). Existing form rows keep their labels and gain
-- field definitions so the inbox can render labels.

UPDATE forms SET fields = '[{"id":"name","type":"text","label":"Name","required":true},{"id":"phone","type":"tel","label":"Phone","required":true},{"id":"email","type":"email","label":"Email","required":false}]'
  WHERE source = 'call-back' AND fields = '[]';

UPDATE forms SET fields = '[{"id":"name","type":"text","label":"Name","required":true},{"id":"email","type":"email","label":"Email","required":true},{"id":"phone","type":"tel","label":"Phone","required":false},{"id":"referral","type":"select","label":"How did you hear about us?","required":false,"options":["Google","Instagram","LinkedIn","Referral","Other"]},{"id":"message","type":"textarea","label":"Your project","required":true}]'
  WHERE source = 'contact' AND fields = '[]';

UPDATE forms SET fields = '[{"id":"name","type":"text","label":"Name","required":true},{"id":"email","type":"email","label":"Email","required":true},{"id":"phone","type":"tel","label":"Phone","required":false},{"id":"message","type":"textarea","label":"Message","required":false}]'
  WHERE source IN ('web-design-hero','branding-hero','seo-hero','ppc-hero') AND fields = '[]';

UPDATE forms SET fields = '[{"id":"name","type":"text","label":"Name","required":true},{"id":"phone","type":"tel","label":"Phone","required":true},{"id":"email","type":"email","label":"Email","required":false}]'
  WHERE source IN ('web-design-callback','branding-callback','seo-callback','ppc-callback') AND fields = '[]';
