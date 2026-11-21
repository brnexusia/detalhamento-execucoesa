
import assert from 'node:assert/strict'
import pg from 'pg'
import { installProductCategorySchema } from '../server/product-category-schema.mjs'
import { categoryKey,categoryMatches,categoryLabel } from '../src/product-category-utils.ts'

// Only a disposable database may be used by this migration test.
const url=process.env.DATABASE_URL||''
if(!/127\.0\.0\.1|localhost/.test(url)||!url.endsWith('/category_test'))throw Error('Disposable local category_test required')
assert.equal(categoryKey('  CÓLAR  '),'colar')
assert.equal(categoryLabel('  COLAR  '),'Colar')
assert.equal(categoryMatches(['Colar','Brincos'],'Cólar').exact,'Colar')
assert.deepEqual(categoryMatches(['Colar','Brincos'],'Colarr').similar,['Colar'])
const pool=new pg.Pool({connectionString:url})
try {
 await pool.query(`CREATE TABLE stores(id text PRIMARY KEY);
 CREATE TABLE products(id text PRIMARY KEY,store_id text NOT NULL REFERENCES stores(id),category text NOT NULL DEFAULT 'Geral');
 INSERT INTO stores VALUES('a'),('b');
 INSERT INTO products VALUES ('1','a','colar'),('2','a','Colar'),('3','a','COLAR'),('4','a','Cólar'),('5','a','  colar  '),('6','b','Cólar'),('7','a','Anéis');`)
 await installProductCategorySchema(pool)
 for(const id of ['1','2','3','4','5'])assert.equal((await pool.query('SELECT category FROM products WHERE id=$1',[id])).rows[0].category,'Colar')
 assert.equal((await pool.query("SELECT category FROM products WHERE id='6'")).rows[0].category,'Cólar','Different stores keep independent names')
 await pool.query("INSERT INTO products VALUES ('8','a',' cóLAR '),('9','a','ANEIS')")
 assert.equal((await pool.query("SELECT category FROM products WHERE id='8'")).rows[0].category,'Colar')
 assert.equal((await pool.query("SELECT category FROM products WHERE id='9'")).rows[0].category,'Anéis')
 await pool.query("UPDATE products SET category='cólar' WHERE id='7'")
 assert.equal((await pool.query("SELECT category FROM products WHERE id='7'")).rows[0].category,'Colar')
 await Promise.all([pool.query("INSERT INTO products VALUES ('10','a','Pulseiras')"),pool.query("INSERT INTO products VALUES ('11','a','PULSEIRAS')")])
 assert.equal((await pool.query("SELECT count(DISTINCT category)::int AS n FROM products WHERE id IN ('10','11')")).rows[0].n,1)
 await installProductCategorySchema(pool)
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n,11)
 console.log('CATEGORY_NORMALIZATION_AND_MIGRATION_PASS')
}finally{await pool.end()}
