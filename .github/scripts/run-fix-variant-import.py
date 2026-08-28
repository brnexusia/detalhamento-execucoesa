from pathlib import Path
path = Path('.github/scripts/fix-variant-import.py')
source = path.read_text().replace('run: node server/scanner-module5.integration.mjs', 'run: npm run test:scanner:module5')
exec(compile(source, str(path), 'exec'))
