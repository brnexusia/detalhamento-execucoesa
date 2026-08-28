from pathlib import Path

path = Path('scripts/apply-full-catalog-patch.py')
text = path.read_text()
old = "updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)"
new = "updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)"
if old not in text:
    raise SystemExit('linha do re.subn não encontrada')
path.write_text(text.replace(old, new, 1))
print('PATCHER_FIXED')
