import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  try {
    console.log('Applying migration: 20240205_create_contacts_table.sql');
    
    const migrationPath = join(__dirname, 'supabase/migrations/20240205_create_contacts_table.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      console.log('Executing:', statement.substring(0, 100) + '...');
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
      
      if (error) {
        console.error('Error executing statement:', error);
        console.log('Note: You may need to run this migration manually in Supabase SQL Editor');
      }
    }
    
    console.log('✓ Migration applied successfully!');
    console.log('\nIf you see errors above, please run the migration manually:');
    console.log('1. Go to your Supabase Dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Copy and paste the contents of supabase/migrations/20240205_create_contacts_table.sql');
    console.log('4. Click "Run"');
    
  } catch (error) {
    console.error('Migration failed:', error);
    console.log('\nPlease run the migration manually in Supabase SQL Editor');
  }
}

applyMigration();
