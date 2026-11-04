-- ---------------------------------------------------------------------------
-- 0004_projects.sql — case studies (cms-projects-spec.md §3).
--
-- The generic `entries` projects collection is superseded by these tables. The
-- old rows are copied across below (as drafts, with their media references
-- intact) so nothing an owner already entered disappears; the legacy rows stay
-- in `entries` only for the old /api/public/work-page compatibility endpoint.
--
-- Conventions are unchanged: ULID ids from code, prepared statements only,
-- timestamps as UTC strings, JSON columns hold JSON text.
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

-- Responsive image variants: JSON [{ "w": 768, "key": "cms/projects/…/768.webp" }]
ALTER TABLE media ADD COLUMN variants TEXT;

CREATE TABLE project_categories (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_featured INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,

  card_image TEXT,

  hero_type TEXT NOT NULL DEFAULT 'image',
  hero_image TEXT,
  hero_image_mobile TEXT,
  hero_video_url TEXT,
  hero_lead TEXT,
  hero_body TEXT,

  intro_html TEXT,

  feature_heading TEXT,
  feature_text TEXT,
  feature_image TEXT,

  gallery TEXT NOT NULL DEFAULT '[]',

  testimonial_quote TEXT,
  testimonial_author TEXT,
  testimonial_company TEXT,

  related_mode TEXT NOT NULL DEFAULT 'auto',
  related_ids TEXT NOT NULL DEFAULT '[]',

  seo_title TEXT,
  seo_description TEXT,
  og_image TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_list ON projects(status, position);
CREATE INDEX idx_projects_featured ON projects(is_featured, status, position);

CREATE TABLE project_category_map (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES project_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, category_id)
);
CREATE INDEX idx_project_category_map_category ON project_category_map(category_id);

-- Old URLs keep working after a slug is renamed.
CREATE TABLE project_slug_history (
  slug TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

-- Which entities use which media, so the library can block deleting used files.
CREATE TABLE media_usage (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (media_id, entity, entity_id)
);
CREATE INDEX idx_media_usage_entity ON media_usage(entity, entity_id);

-- --- Categories --------------------------------------------------------------

INSERT OR IGNORE INTO project_categories (id, slug, label, position, created_at, updated_at) VALUES
  ('pcat_branding',  'branding',   'Branding',   0, datetime('now'), datetime('now')),
  ('pcat_web-design','web-design', 'Web Design', 1, datetime('now'), datetime('now')),
  ('pcat_seo',       'seo',        'SEO',        2, datetime('now'), datetime('now')),
  ('pcat_ppc',       'ppc',        'PPC',        3, datetime('now'), datetime('now')),
  ('pcat_video',     'video',      'Video',      4, datetime('now'), datetime('now'));

-- The project page's "Request a Call Back" card posts here (§8).
INSERT OR IGNORE INTO forms (source, label, enabled, notify_emails, success_message, auto_registered) VALUES
  ('call-back', 'Request a Call Back', 1, '[]', 'Thanks — we will call you back shortly.', 0);

-- --- Convert the legacy projects collection ---------------------------------

INSERT OR IGNORE INTO projects (
  id, slug, title, client_name, status, is_featured, position, published_at,
  card_image, hero_type, hero_image, hero_lead, hero_body, gallery,
  related_mode, related_ids, created_at, updated_at
)
SELECT
  e.id,
  e.slug,
  COALESCE(NULLIF(json_extract(e.data, '$.title'), ''), e.slug),
  'Imported from the legacy projects collection',
  CASE WHEN e.status = 'published' AND e.published_data IS NOT NULL THEN 'published' ELSE 'draft' END,
  CASE WHEN COALESCE(json_extract(e.data, '$.featured'), 0) IN (1, 'true') THEN 1 ELSE 0 END,
  e.sort,
  e.published_at,
  json_extract(e.data, '$.image'),
  'image',
  COALESCE(json_extract(e.data, '$.wideImage'), json_extract(e.data, '$.image')),
  COALESCE(NULLIF(json_extract(e.data, '$.summary'), ''), json_extract(e.data, '$.title')),
  NULL,
  COALESCE(json_extract(e.data, '$.gallery'), '[]'),
  'auto',
  '[]',
  e.created_at,
  e.updated_at
FROM entries e
WHERE e.collection = 'projects' AND e.slug IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.slug = e.slug);

-- Legacy projects tagged themselves with service titles, which match the seed
-- category labels; map those so the filters keep working.
INSERT OR IGNORE INTO project_category_map (project_id, category_id)
SELECT DISTINCT p.id, c.id
FROM projects p
JOIN entries e ON e.id = p.id AND e.collection = 'projects'
JOIN json_each(COALESCE(json_extract(e.data, '$.services'), '[]')) AS svc
JOIN project_categories c
  ON c.label = TRIM(CAST(svc.value AS TEXT)) COLLATE NOCASE
  OR c.slug = lower(replace(TRIM(CAST(svc.value AS TEXT)), ' ', '-'));
