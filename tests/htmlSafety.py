from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import re

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

production_js = (root / 'js' / 'tournament.js').read_text(encoding='utf-8')
candidate_js = (root / 'candidate-app' / 'js' / 'tournament.js').read_text(encoding='utf-8')
production_version = re.search(r"APP_VERSION = '([^']+)'", production_js)
candidate_version = re.search(r"APP_VERSION = '([^']+)'", candidate_js)
assert production_version and candidate_version
assert production_version.group(1) == candidate_version.group(1) == '5.3.80'
assert 'V5.3.80' in source
assert source.index('js/categoryPersistenceAdapter.js') < source.index('js/storage.js')
assert source.index('js/categorySyncQueue.js') < source.index('js/storage.js')
assert (root / 'index.html').read_text(encoding='utf-8').count('js/categoryPersistenceAdapter.js') == 1
print(f'PASS: candidate HTML has {len(parser.ids)} IDs with no duplicates')
print('PASS: root and candidate app versions match V5.3.80')
print('PASS: persistence adapter and queue load before storage')
