from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
html_path = root / 'index.html'
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

production_js = (root / 'js' / 'tournament.js').read_text(encoding='utf-8')
production_version = re.search(r"APP_VERSION = '([^']+)'", production_js)
assert production_version and production_version.group(1) == '5.3.81'
assert 'V5.3.81' in source
assert source.index('js/categoryPersistenceAdapter.js') < source.index('js/storage.js')
assert source.index('js/categorySyncQueue.js') < source.index('js/storage.js')
assert source.count('js/categoryPersistenceAdapter.js') == 1
print(f'PASS: production HTML has {len(parser.ids)} IDs with no duplicates')
print('PASS: production app version is V5.3.81')
print('PASS: persistence adapter and queue load before storage')
