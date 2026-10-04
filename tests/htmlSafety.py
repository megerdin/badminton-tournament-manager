from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).resolve().parents[1]
html_path = root / 'candidate-app' / 'index.html'
source = html_path.read_text(encoding='utf-8')

class IdParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])

parser = IdParser()
parser.feed(source)
counts = Counter(parser.ids)
duplicates = sorted(key for key, count in counts.items() if count > 1)
assert not duplicates, f'duplicate IDs: {duplicates}'
assert "APP_VERSION = '5.3.79'" in (root / 'candidate-app' / 'js' / 'tournament.js').read_text(encoding='utf-8')
assert 'V5.3.79' in source
assert source.index('js/categoryPersistenceAdapter.js') < source.index('js/storage.js')
assert source.index('js/categorySyncQueue.js') < source.index('js/storage.js')
print(f'PASS: candidate HTML has {len(parser.ids)} IDs with no duplicates')
print('PASS: app version and adapter script order are consistent')
