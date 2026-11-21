// A category belongs to a store, not to an individual catalog.
// Canonicalize even direct imports and concurrent product writes at database level.
export const categorySchema = String.raw`
SELECT pg_advisory_xact_lock(746210316);
CREATE OR REPLACE FUNCTION shopvax_category_label(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(left(btrim(regexp_replace(normalize(COALESCE(raw,''), NFC), '[[:space:]]+', ' ', 'g')),80),''),'Geral')
$$;
CREATE OR REPLACE FUNCTION shopvax_category_key(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(normalize(lower(shopvax_category_label(raw)), NFD), U&'[\0300-\036f]', '', 'g')
$$;
CREATE OR REPLACE FUNCTION shopvax_category_display(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN label=lower(label) OR label=upper(label)
    THEN upper(left(label,1)) || lower(substr(label,2))
    ELSE label END
  FROM (SELECT shopvax_category_label(raw) AS label) s
$$;
CREATE TABLE IF NOT EXISTS product_category_registry (
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  display_name text NOT NULL,
  PRIMARY KEY(store_id,category_key)
);
CREATE OR REPLACE FUNCTION shopvax_canonicalize_product_category() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  wanted_key text;
  canonical_name text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.category IS NOT DISTINCT FROM OLD.category AND NEW.store_id=OLD.store_id THEN RETURN NEW; END IF;
  END IF;
  wanted_key := shopvax_category_key(NEW.category);
  SELECT display_name INTO canonical_name FROM product_category_registry
    WHERE store_id=NEW.store_id AND category_key=wanted_key;
  IF NOT FOUND THEN
    INSERT INTO product_category_registry(store_id,category_key,display_name)
      VALUES(NEW.store_id,wanted_key,shopvax_category_display(NEW.category))
      ON CONFLICT(store_id,category_key) DO NOTHING
      RETURNING display_name INTO canonical_name;
    IF NOT FOUND THEN
      SELECT display_name INTO canonical_name FROM product_category_registry
        WHERE store_id=NEW.store_id AND category_key=wanted_key;
    END IF;
  END IF;
  NEW.category := canonical_name;
  RETURN NEW;
END
$$;
DO $migration$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='products'::regclass AND tgname='shopvax_canonical_category' AND NOT tgisinternal) THEN
    -- Lock writes only for this one-time migration; readers remain available.
    LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE;
    INSERT INTO product_category_registry(store_id,category_key,display_name)
      SELECT DISTINCT ON(store_id,category_key) store_id,category_key,display_name
      FROM (
        SELECT store_id,shopvax_category_key(category) AS category_key,
          shopvax_category_display(category) AS display_name,count(*) AS usage_count
        FROM products GROUP BY 1,2,3
      ) names
      ORDER BY store_id,category_key,usage_count DESC,display_name COLLATE "C"
      ON CONFLICT(store_id,category_key) DO NOTHING;
    UPDATE products p SET category=c.display_name
      FROM product_category_registry c
      WHERE p.store_id=c.store_id AND shopvax_category_key(p.category)=c.category_key
        AND p.category IS DISTINCT FROM c.display_name;
    CREATE TRIGGER shopvax_canonical_category
      BEFORE INSERT OR UPDATE OF category,store_id ON products
      FOR EACH ROW EXECUTE FUNCTION shopvax_canonicalize_product_category();
  END IF;
END
$migration$;
`
export async function installProductCategorySchema(pool) {
  await pool.query(categorySchema)
}
