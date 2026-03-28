"""
Legal Argument Presentation — API Server
Serves static files + REST API under /api/
No external dependencies — uses only Python stdlib.
"""

import http.server
import json
import os
import re
import shutil
import tempfile

os.chdir(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.realpath(os.path.join(os.getcwd(), 'data'))
CASES_FILE = os.path.join(DATA_DIR, 'cases.json')
MAX_BODY_SIZE = 10 * 1024 * 1024  # 10 MB
SAFE_ID_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$')


def validate_id(value):
    """Validate that an ID is safe for use in file paths."""
    return bool(SAFE_ID_RE.match(value))


def safe_path(base, *parts):
    """Join path parts and verify the result stays within base directory."""
    joined = os.path.realpath(os.path.join(base, *parts))
    if not joined.startswith(base + os.sep) and joined != base:
        raise ValueError(f'Path traversal detected: {joined}')
    return joined


def read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data):
    dir_name = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        if os.path.exists(path):
            os.replace(tmp, path)
        else:
            os.rename(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def doc_path(case_id, doc_id):
    return safe_path(DATA_DIR, case_id, doc_id, 'document.json')


# Route patterns
RE_CASES = re.compile(r'^/api/cases/?$')
RE_CASE = re.compile(r'^/api/cases/([^/]+)/?$')
RE_DOCS = re.compile(r'^/api/cases/([^/]+)/docs/?$')
RE_DOC = re.compile(r'^/api/cases/([^/]+)/docs/([^/]+)/?$')
RE_DOC_META = re.compile(r'^/api/cases/([^/]+)/docs/([^/]+)/meta/?$')
RE_DOC_ENTITIES = re.compile(r'^/api/cases/([^/]+)/docs/([^/]+)/entities/?$')
RE_CHAPTERS = re.compile(r'^/api/cases/([^/]+)/docs/([^/]+)/chapters/?$')
RE_CHAPTERS_REORDER = re.compile(r'^/api/cases/([^/]+)/docs/([^/]+)/chapters/reorder/?$')
RE_CHAPTER = re.compile(r'^/api/cases/([^/]+)/docs/([^/]+)/chapters/([^/]+)/?$')


class APIHandler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', 'http://localhost:8080')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        if length > MAX_BODY_SIZE:
            raise ValueError('Payload too large')
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    def _json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._json_response({'error': message}, status)

    # ── Routing ──────────────────────────────────────────────

    def _is_api(self):
        return self.path.startswith('/api/')

    def do_GET(self):
        if not self._is_api():
            return super().do_GET()
        self._route('GET')

    def do_POST(self):
        if not self._is_api():
            return self._error(405, 'Method not allowed')
        self._route('POST')

    def do_PUT(self):
        if not self._is_api():
            return self._error(405, 'Method not allowed')
        self._route('PUT')

    def do_PATCH(self):
        if not self._is_api():
            return self._error(405, 'Method not allowed')
        self._route('PATCH')

    def do_DELETE(self):
        if not self._is_api():
            return self._error(405, 'Method not allowed')
        self._route('DELETE')

    def _route(self, method):
        path = self.path.split('?')[0]  # strip query string

        # Cases collection
        m = RE_CASES.match(path)
        if m:
            if method == 'GET':
                return self._get_cases()
            if method == 'POST':
                return self._add_case()
            return self._error(405, 'Method not allowed')

        # Single case
        m = RE_CASE.match(path)
        if m:
            case_id = m.group(1)
            if method == 'GET':
                return self._get_case(case_id)
            if method == 'PUT':
                return self._update_case(case_id)
            if method == 'DELETE':
                return self._delete_case(case_id)
            return self._error(405, 'Method not allowed')

        # Documents collection
        m = RE_DOCS.match(path)
        if m:
            case_id = m.group(1)
            if method == 'GET':
                return self._get_docs(case_id)
            if method == 'POST':
                return self._add_doc(case_id)
            return self._error(405, 'Method not allowed')

        # Chapters reorder (must be before RE_CHAPTER)
        m = RE_CHAPTERS_REORDER.match(path)
        if m:
            case_id, doc_id = m.group(1), m.group(2)
            if method == 'PATCH':
                return self._reorder_chapters(case_id, doc_id)
            return self._error(405, 'Method not allowed')

        # Document meta
        m = RE_DOC_META.match(path)
        if m:
            case_id, doc_id = m.group(1), m.group(2)
            if method == 'PATCH':
                return self._patch_doc_meta(case_id, doc_id)
            return self._error(405, 'Method not allowed')

        # Document entities
        m = RE_DOC_ENTITIES.match(path)
        if m:
            case_id, doc_id = m.group(1), m.group(2)
            if method == 'PATCH':
                return self._patch_doc_entities(case_id, doc_id)
            return self._error(405, 'Method not allowed')

        # Chapters collection
        m = RE_CHAPTERS.match(path)
        if m:
            case_id, doc_id = m.group(1), m.group(2)
            if method == 'GET':
                return self._get_chapters(case_id, doc_id)
            if method == 'POST':
                return self._add_chapter(case_id, doc_id)
            return self._error(405, 'Method not allowed')

        # Single chapter
        m = RE_CHAPTER.match(path)
        if m:
            case_id, doc_id, ch_id = m.group(1), m.group(2), m.group(3)
            if method == 'GET':
                return self._get_chapter(case_id, doc_id, ch_id)
            if method == 'PUT':
                return self._update_chapter(case_id, doc_id, ch_id)
            if method == 'DELETE':
                return self._delete_chapter(case_id, doc_id, ch_id)
            return self._error(405, 'Method not allowed')

        # Single document
        m = RE_DOC.match(path)
        if m:
            case_id, doc_id = m.group(1), m.group(2)
            if method == 'GET':
                return self._get_doc(case_id, doc_id)
            if method == 'PUT':
                return self._replace_doc(case_id, doc_id)
            if method == 'DELETE':
                return self._delete_doc(case_id, doc_id)
            return self._error(405, 'Method not allowed')

        self._error(404, 'Not found')

    # ── Cases ────────────────────────────────────────────────

    def _get_cases(self):
        data = read_json(CASES_FILE)
        self._json_response(data)

    def _get_case(self, case_id):
        data = read_json(CASES_FILE)
        case = next((c for c in data['cases'] if c['id'] == case_id), None)
        if not case:
            return self._error(404, f'Case {case_id} not found')
        self._json_response(case)

    def _add_case(self):
        body = self._read_body()
        if not body.get('id') or not body.get('title'):
            return self._error(400, 'id and title are required')
        if not validate_id(body['id']):
            return self._error(400, 'Invalid id format')
        data = read_json(CASES_FILE)
        if any(c['id'] == body['id'] for c in data['cases']):
            return self._error(409, 'Case already exists')
        new_case = {
            'id': body['id'],
            'title': body['title'],
            'subtitle': body.get('subtitle', ''),
            'icon': body.get('icon', 'fa-gavel'),
            'documents': body.get('documents', [])
        }
        data['cases'].append(new_case)
        write_json(CASES_FILE, data)
        self._json_response(new_case, 201)

    def _update_case(self, case_id):
        body = self._read_body()
        data = read_json(CASES_FILE)
        case = next((c for c in data['cases'] if c['id'] == case_id), None)
        if not case:
            return self._error(404, f'Case {case_id} not found')
        for key in ('title', 'subtitle', 'icon'):
            if key in body:
                case[key] = body[key]
        write_json(CASES_FILE, data)
        self._json_response(case)

    def _delete_case(self, case_id):
        if not validate_id(case_id):
            return self._error(400, 'Invalid id format')
        data = read_json(CASES_FILE)
        original_len = len(data['cases'])
        data['cases'] = [c for c in data['cases'] if c['id'] != case_id]
        if len(data['cases']) == original_len:
            return self._error(404, 'Case not found')
        write_json(CASES_FILE, data)
        try:
            case_dir = safe_path(DATA_DIR, case_id)
            if os.path.isdir(case_dir):
                shutil.rmtree(case_dir)
        except ValueError:
            pass
        self._json_response({'deleted': case_id})

    # ── Documents ────────────────────────────────────────────

    def _get_docs(self, case_id):
        data = read_json(CASES_FILE)
        case = next((c for c in data['cases'] if c['id'] == case_id), None)
        if not case:
            return self._error(404, f'Case {case_id} not found')
        self._json_response({'documents': case.get('documents', [])})

    def _add_doc(self, case_id):
        body = self._read_body()
        if not body.get('id') or not body.get('title'):
            return self._error(400, 'id and title are required')
        if not validate_id(body['id']):
            return self._error(400, 'Invalid id format')
        data = read_json(CASES_FILE)
        case = next((c for c in data['cases'] if c['id'] == case_id), None)
        if not case:
            return self._error(404, 'Case not found')
        if any(d['id'] == body['id'] for d in case.get('documents', [])):
            return self._error(409, 'Document already exists')
        new_doc = {
            'id': body['id'],
            'title': body['title'],
            'date': body.get('date', ''),
            'type': body.get('type', 'document')
        }
        case.setdefault('documents', []).append(new_doc)
        write_json(CASES_FILE, data)
        doc_dir = safe_path(DATA_DIR, case_id, body['id'])
        os.makedirs(doc_dir, exist_ok=True)
        empty_doc = {
            'meta': {'title': body['title']},
            'entities': {'people': [], 'organizations': [], 'evidence': [], 'cases': [], 'laws': []},
            'chapters': []
        }
        dp = doc_path(case_id, body['id'])
        if not os.path.exists(dp):
            write_json(dp, empty_doc)
        self._json_response(new_doc, 201)

    def _delete_doc(self, case_id, doc_id):
        if not validate_id(doc_id):
            return self._error(400, 'Invalid id format')
        data = read_json(CASES_FILE)
        case = next((c for c in data['cases'] if c['id'] == case_id), None)
        if not case:
            return self._error(404, 'Case not found')
        original_len = len(case.get('documents', []))
        case['documents'] = [d for d in case.get('documents', []) if d['id'] != doc_id]
        if len(case['documents']) == original_len:
            return self._error(404, 'Document not found')
        write_json(CASES_FILE, data)
        try:
            doc_dir = safe_path(DATA_DIR, case_id, doc_id)
            if os.path.isdir(doc_dir):
                shutil.rmtree(doc_dir)
        except ValueError:
            pass
        self._json_response({'deleted': doc_id})

    # ── Document Content ─────────────────────────────────────

    def _get_doc(self, case_id, doc_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        self._json_response(read_json(dp))

    def _replace_doc(self, case_id, doc_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        body = self._read_body()
        write_json(dp, body)
        self._json_response(body)

    def _patch_doc_meta(self, case_id, doc_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        body = self._read_body()
        doc = read_json(dp)
        doc.setdefault('meta', {}).update(body)
        write_json(dp, doc)
        self._json_response(doc['meta'])

    def _patch_doc_entities(self, case_id, doc_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        body = self._read_body()
        doc = read_json(dp)
        doc.setdefault('entities', {}).update(body)
        write_json(dp, doc)
        self._json_response(doc['entities'])

    # ── Chapters ─────────────────────────────────────────────

    def _find_chapter(self, chapters, ch_id):
        """Find chapter by id, including in subsections. Returns (list, index) or (None, -1)."""
        for i, ch in enumerate(chapters):
            if ch.get('id') == ch_id:
                return chapters, i
            for j, sub in enumerate(ch.get('subsections', [])):
                if sub.get('id') == ch_id:
                    return ch['subsections'], j
        return None, -1

    def _get_chapters(self, case_id, doc_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        doc = read_json(dp)
        self._json_response({'chapters': doc.get('chapters', [])})

    def _get_chapter(self, case_id, doc_id, ch_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        doc = read_json(dp)
        lst, idx = self._find_chapter(doc.get('chapters', []), ch_id)
        if lst is None:
            return self._error(404, f'Chapter {ch_id} not found')
        self._json_response(lst[idx])

    def _add_chapter(self, case_id, doc_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        body = self._read_body()
        if not body.get('id') or not body.get('title'):
            return self._error(400, 'id and title are required')
        if not validate_id(body['id']):
            return self._error(400, 'Invalid id format')
        doc = read_json(dp)
        chapters = doc.setdefault('chapters', [])

        new_chapter = {
            'id': body['id'],
            'title': body['title'],
            'icon': body.get('icon', 'fa-bookmark'),
            'content': body.get('content', ''),
            'subsections': body.get('subsections', [])
        }

        # Insert after a specific chapter if specified
        after = body.get('after')
        if after:
            _, idx = self._find_chapter(chapters, after)
            if idx >= 0:
                chapters.insert(idx + 1, new_chapter)
            else:
                chapters.append(new_chapter)
        else:
            chapters.append(new_chapter)

        write_json(dp, doc)
        self._json_response(new_chapter, 201)

    def _update_chapter(self, case_id, doc_id, ch_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        body = self._read_body()
        doc = read_json(dp)
        lst, idx = self._find_chapter(doc.get('chapters', []), ch_id)
        if lst is None:
            return self._error(404, f'Chapter {ch_id} not found')
        for key in ('title', 'icon', 'content', 'subsections'):
            if key in body:
                lst[idx][key] = body[key]
        write_json(dp, doc)
        self._json_response(lst[idx])

    def _delete_chapter(self, case_id, doc_id, ch_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        doc = read_json(dp)
        lst, idx = self._find_chapter(doc.get('chapters', []), ch_id)
        if lst is None:
            return self._error(404, f'Chapter {ch_id} not found')
        removed = lst.pop(idx)
        write_json(dp, doc)
        self._json_response({'deleted': removed['id']})

    def _reorder_chapters(self, case_id, doc_id):
        dp = doc_path(case_id, doc_id)
        if not os.path.exists(dp):
            return self._error(404, 'Document not found')
        body = self._read_body()
        order = body.get('order', [])
        if not order:
            return self._error(400, 'order array is required')
        doc = read_json(dp)
        chapters = doc.get('chapters', [])
        by_id = {ch['id']: ch for ch in chapters}
        reordered = []
        for cid in order:
            if cid in by_id:
                reordered.append(by_id.pop(cid))
        # Append any chapters not in the order list at the end
        for ch in chapters:
            if ch['id'] in by_id:
                reordered.append(ch)
        doc['chapters'] = reordered
        write_json(dp, doc)
        self._json_response({'chapters': [ch['id'] for ch in reordered]})

    def log_message(self, format, *args):
        # Cleaner logging
        method_path = args[0] if args else ''
        status = args[1] if len(args) > 1 else ''
        if '/api/' in str(method_path):
            print(f'  API  {method_path} => {status}')
        else:
            super().log_message(format, *args)


if __name__ == '__main__':
    print('Legal Argument Presentation Server')
    print('  Static files: http://localhost:8080/')
    print('  API endpoint: http://localhost:8080/api/')
    print()
    http.server.test(HandlerClass=APIHandler, port=8080, bind='127.0.0.1')
